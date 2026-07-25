#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { checkGenerated } from './generate-adapters.mjs';
import { OPERATIONS, SUPPORT_FILES } from './lib/catalog.mjs';
import {
  assertNoUnownedContent,
  buildDesiredInstall,
  desiredCollisions,
  INSTALL_MANIFEST_NAME,
  readInstallManifest,
  verifyOwnedFiles,
} from './lib/manifest.mjs';
import {
  inspectLegacyClaude,
  legacyAffectedPaths,
  loadLegacyIdentity,
} from './lib/legacy-v016.mjs';
import {
  assertSafeTarget,
  InstallError,
  fail,
  resolveInstallPaths,
} from './lib/paths.mjs';
import {
  atomicWrite,
  beginTransaction,
  commitTransaction,
  inspectTransactions,
  recoverPrepared,
  replaceFromStage,
  restorePreimages,
  rollbackTransaction,
} from './lib/transaction.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BUNDLE_ROOT = resolve(SCRIPT_DIR, '..');

async function maybeLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function takeOnce(state, name) {
  if (state.seen.has(name)) fail('INVALID_ARGUMENT', `${name} may be provided only once`);
  state.seen.add(name);
}

export function parseArguments(argv) {
  const state = {
    host: null,
    scope: null,
    projectPath: undefined,
    dryRun: false,
    yes: false,
    operation: 'install',
    rollback: null,
    help: false,
    seen: new Set(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--host') {
      takeOnce(state, '--host');
      state.host = argv[index += 1];
      if (!state.host || !['claude', 'codex'].includes(state.host)) {
        fail('INVALID_ARGUMENT', '--host requires claude or codex');
      }
    } else if (argument === '--user') {
      takeOnce(state, '--user');
      if (state.scope) fail('INVALID_ARGUMENT', 'choose exactly one of --user or --project');
      state.scope = 'user';
    } else if (argument === '--project') {
      takeOnce(state, '--project');
      if (state.scope) fail('INVALID_ARGUMENT', 'choose exactly one of --user or --project');
      state.scope = 'project';
      if (argv[index + 1] && !argv[index + 1].startsWith('-')) {
        state.projectPath = argv[index += 1];
      }
    } else if (argument === '--dry-run') {
      takeOnce(state, '--dry-run');
      state.dryRun = true;
    } else if (argument === '--yes' || argument === '-y') {
      takeOnce(state, '--yes');
      state.yes = true;
    } else if (argument === '--uninstall') {
      takeOnce(state, '--uninstall');
      if (state.operation !== 'install') {
        fail('INVALID_ARGUMENT', '--uninstall and --rollback are mutually exclusive');
      }
      state.operation = 'uninstall';
    } else if (argument === '--rollback') {
      takeOnce(state, '--rollback');
      if (state.operation !== 'install') {
        fail('INVALID_ARGUMENT', '--uninstall and --rollback are mutually exclusive');
      }
      const selector = argv[index += 1];
      if (!selector || selector.startsWith('-')) {
        fail('INVALID_ARGUMENT', '--rollback requires latest or a transaction id');
      }
      state.operation = 'rollback';
      state.rollback = selector;
    } else if (argument === '--help' || argument === '-h') {
      state.help = true;
    } else {
      fail('INVALID_ARGUMENT', `unknown argument ${argument}`);
    }
  }
  if (state.help) return state;
  if (!state.host) fail('INVALID_ARGUMENT', 'the host wrapper did not identify its host');
  if (!state.scope) fail('INVALID_ARGUMENT', 'choose exactly one of --user or --project');
  return state;
}

export function usage(host = '<host>') {
  return [
    `Usage: install-${host}.sh --user|--project [PATH] [--dry-run] [-y|--yes]`,
    `       install-${host}.sh --user|--project [PATH] --uninstall [--dry-run] [-y|--yes]`,
    `       install-${host}.sh --user|--project [PATH] --rollback latest|ID [--dry-run] [-y|--yes]`,
  ].join('\n');
}

function allowedAffectedPaths(paths, legacyManifest) {
  const base = [
    paths.supportRoot,
    ...OPERATIONS.map(({ name }) => join(paths.launcherRoot, name)),
  ];
  if (paths.host === 'claude' && paths.scope === 'user') {
    base.push(...legacyAffectedPaths(paths, legacyManifest));
  }
  return [...new Set(base)];
}

function within(boundary, target) {
  const suffix = relative(boundary, target);
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix));
}

async function validateAffectedTargets(paths, affectedPaths) {
  for (const path of affectedPaths) {
    const boundary = within(paths.supportBase, path)
      ? paths.supportBase
      : paths.launcherBase;
    await assertSafeTarget(path, boundary, 'managed transaction target');
  }
}

function parentPaths(path) {
  const result = [];
  let current = dirname(path).replaceAll('\\', '/');
  while (current !== '.' && current !== '') {
    result.push(current);
    current = dirname(current).replaceAll('\\', '/');
  }
  return result;
}

async function createdDirectories(paths, priorManifest) {
  const candidates = new Map();
  candidates.set('support:', { root: 'support', path: '', absolute: paths.supportRoot });
  for (const file of SUPPORT_FILES) {
    for (const parent of parentPaths(file)) {
      candidates.set(`support:${parent}`, {
        root: 'support',
        path: parent,
        absolute: join(paths.supportRoot, parent),
      });
    }
  }
  candidates.set('launcher:', { root: 'launcher', path: '', absolute: paths.launcherRoot });
  for (const { name } of OPERATIONS) {
    candidates.set(`launcher:${name}`, {
      root: 'launcher',
      path: name,
      absolute: join(paths.launcherRoot, name),
    });
  }
  const created = new Map(
    (priorManifest?.created_directories ?? [])
      .map((entry) => [`${entry.root}:${entry.path}`, entry])
      .filter(([identity]) => candidates.has(identity)),
  );
  for (const [identity, candidate] of candidates) {
    if (!(await maybeLstat(candidate.absolute))) {
      created.set(identity, { root: candidate.root, path: candidate.path });
    }
  }
  return [...created.values()].sort((left, right) => (
    Buffer.from(`${left.root}:${left.path}`).compare(Buffer.from(`${right.root}:${right.path}`))
  ));
}

async function loadGeneratedManifest(bundleRoot) {
  try {
    return await checkGenerated({
      bundleRoot,
      outputRoot: join(bundleRoot, 'adapters', 'generated'),
    });
  } catch (error) {
    fail('PACKAGE_MISMATCH', 'generated package does not match source and catalog', error);
  }
}

async function writeContent(path, bytes, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  await writeFile(path, bytes, { mode });
  await chmod(path, mode);
}

async function prepareStage({ desired, paths }) {
  const suffix = `${process.pid}-${randomBytes(6).toString('hex')}`;
  const support = join(paths.supportBase, `.baton-stage-${suffix}-support`);
  const launcher = join(paths.launcherBase, `.baton-stage-${suffix}-launchers`);
  await mkdir(paths.supportBase, { recursive: true, mode: 0o755 });
  await mkdir(paths.launcherBase, { recursive: true, mode: 0o755 });
  if (await maybeLstat(support) || await maybeLstat(launcher)) {
    fail('UNOWNED_COLLISION', 'private staging path already exists');
  }
  await mkdir(support, { recursive: false, mode: 0o700 });
  await mkdir(launcher, { recursive: false, mode: 0o700 });
  try {
    for (const [identity, bytes] of desired.content) {
      const separator = identity.indexOf(':');
      const root = identity.slice(0, separator);
      const path = identity.slice(separator + 1);
      await writeContent(join(root === 'support' ? support : launcher, path), bytes);
    }
    await writeContent(join(support, `${INSTALL_MANIFEST_NAME}.staged`), desired.manifestBytes);
    return { support, launcher };
  } catch (error) {
    await rm(support, { recursive: true, force: true });
    await rm(launcher, { recursive: true, force: true });
    throw error;
  }
}

async function cleanupStage(stage) {
  if (!stage) return;
  await rm(stage.support, { recursive: true, force: true });
  await rm(stage.launcher, { recursive: true, force: true });
}

function installActions(paths, legacy) {
  const actions = [];
  if (legacy.state === 'exact') actions.push('archive exact Claude v0.16 installation');
  actions.push(`replace support package: ${paths.supportRoot}`);
  for (const { name } of OPERATIONS) {
    actions.push(`replace launcher: ${join(paths.launcherRoot, name, 'SKILL.md')}`);
  }
  if (legacy.state === 'exact') {
    for (const commandPath of legacy.commandPaths) {
      actions.push(`remove exact legacy command: ${commandPath}`);
    }
    actions.push(`remove exact legacy instruction block: ${paths.instructionPath}`);
  }
  actions.push(`write install manifest last: ${join(paths.supportRoot, INSTALL_MANIFEST_NAME)}`);
  return actions;
}

function uninstallActions(paths, manifest) {
  const actions = [
    ...OPERATIONS.map(({ name }) => (
      `remove owned launcher: ${join(paths.launcherRoot, name, 'SKILL.md')}`
    )),
    `remove owned support package: ${paths.supportRoot}`,
  ];
  if (manifest.created_directories.some(({ root, path }) => root === 'launcher' && path === '')) {
    actions.push(`remove created launcher root if empty: ${paths.launcherRoot}`);
  }
  return actions;
}

async function checkpoint(options, name) {
  if (options.checkpoint) await options.checkpoint(name);
}

async function performInstall({
  paths,
  bundleRoot,
  generatedManifest,
  prior,
  legacy,
  desired,
  actions,
  options,
}) {
  const stage = await prepareStage({ desired, paths });
  const affected = [
    paths.supportRoot,
    ...OPERATIONS.map(({ name }) => join(paths.launcherRoot, name)),
    ...(legacy.state === 'exact' ? [...legacy.commandPaths, paths.instructionPath] : []),
  ];
  let transaction;
  try {
    transaction = await beginTransaction({
      stateRoot: paths.stateRoot,
      operation: legacy.state === 'exact' ? 'migrate-v0.16-and-install' : 'install',
      affectedPaths: affected,
      actions,
    });
    await checkpoint(options, 'prepared');
    if (prior) {
      await verifyOwnedFiles(prior.value, paths, generatedManifest);
      await assertNoUnownedContent(prior.value, paths, generatedManifest);
    }
    if (legacy.state === 'exact') {
      const currentLegacy = await inspectLegacyClaude({ bundleRoot, paths });
      if (
        currentLegacy.state !== 'exact'
        || !currentLegacy.prefix.equals(legacy.prefix)
      ) {
        fail('LEGACY_FINGERPRINT_MISMATCH', 'legacy installation changed before replacement');
      }
    }

    await rm(join(stage.support, `${INSTALL_MANIFEST_NAME}.staged`), { force: true });
    await replaceFromStage(stage.support, paths.supportRoot, transaction, 'support');
    await checkpoint(options, 'support-replaced');

    for (const [index, { name }] of OPERATIONS.entries()) {
      await replaceFromStage(
        join(stage.launcher, name),
        join(paths.launcherRoot, name),
        transaction,
        `launcher-${name}`,
      );
      await checkpoint(options, `launcher-${index + 1}`);
    }

    if (legacy.state === 'exact') {
      for (const [index, commandPath] of legacy.commandPaths.entries()) {
        await rm(commandPath, { force: false });
        await checkpoint(options, `legacy-command-${index + 1}`);
      }
      const currentInstruction = await readFile(paths.instructionPath);
      const expectedInstruction = Buffer.concat([legacy.prefix, legacy.identity.block]);
      if (!currentInstruction.equals(expectedInstruction)) {
        fail('LEGACY_FINGERPRINT_MISMATCH', 'legacy instruction file changed before compare-and-set');
      }
      const instructionMode = (await lstat(paths.instructionPath)).mode & 0o777;
      await atomicWrite(paths.instructionPath, legacy.prefix, instructionMode);
      await checkpoint(options, 'instruction-cas');
    }

    await atomicWrite(
      join(paths.supportRoot, INSTALL_MANIFEST_NAME),
      desired.manifestBytes,
      0o644,
    );
    await checkpoint(options, 'manifest-written');
    await commitTransaction(transaction);
    return transaction.id;
  } catch (error) {
    if (transaction && !error.batonInterrupted) {
      await restorePreimages(transaction);
    }
    throw error;
  } finally {
    await cleanupStage(stage);
  }
}

async function removeCreatedLauncherRoot(manifest, paths) {
  if (!manifest.created_directories.some(({ root, path }) => root === 'launcher' && path === '')) {
    return;
  }
  try {
    await rmdir(paths.launcherRoot);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  }
}

async function performUninstall({ paths, generatedManifest, prior, actions, options }) {
  const affected = [
    paths.supportRoot,
    ...OPERATIONS.map(({ name }) => join(paths.launcherRoot, name)),
  ];
  const transaction = await beginTransaction({
    stateRoot: paths.stateRoot,
    operation: 'uninstall',
    affectedPaths: affected,
    actions,
  });
  try {
    await checkpoint(options, 'prepared');
    await verifyOwnedFiles(prior.value, paths, generatedManifest);
    await assertNoUnownedContent(prior.value, paths, generatedManifest);
    for (const [index, { name }] of OPERATIONS.entries()) {
      await rm(join(paths.launcherRoot, name), { recursive: true, force: true });
      await checkpoint(options, `launcher-${index + 1}`);
    }
    await rm(paths.supportRoot, { recursive: true, force: true });
    await checkpoint(options, 'support-removed');
    await removeCreatedLauncherRoot(prior.value, paths);
    await commitTransaction(transaction);
    return transaction.id;
  } catch (error) {
    if (!error.batonInterrupted) await restorePreimages(transaction);
    throw error;
  }
}

async function planRollback({ paths, allowed, selector }) {
  const transactions = await inspectTransactions({
    stateRoot: paths.stateRoot,
    allowedPaths: allowed,
  });
  const selected = selector === 'latest'
    ? transactions.filter(({ journal }) => journal.status === 'committed').at(-1)
    : transactions.find(({ id, journal }) => id === selector && journal.status === 'committed');
  if (!selected) fail('ROLLBACK_NOT_FOUND', `no committed transaction matches ${selector}`);
  return {
    selected,
    actions: selected.journal.affected_paths.map((path) => (
      `restore transaction ${selected.id} preimage: ${path}`
    )),
  };
}

export async function runInstaller(argv, options = {}) {
  const parsed = parseArguments(argv);
  if (parsed.help) return { help: usage(parsed.host ?? '<host>'), actions: [] };
  const isTTY = options.isTTY ?? Boolean(process.stdin.isTTY);
  if (!parsed.dryRun && !parsed.yes && !isTTY) {
    fail('CONFIRMATION_REQUIRED', 'non-TTY mutation requires --yes');
  }

  const bundleRoot = resolve(options.bundleRoot ?? DEFAULT_BUNDLE_ROOT);
  const paths = await resolveInstallPaths({
    host: parsed.host,
    scope: parsed.scope,
    projectPath: parsed.projectPath,
    env: options.env ?? process.env,
    cwd: options.cwd ?? process.cwd(),
  });
  if (!parsed.dryRun && !parsed.yes) {
    let confirmed;
    if (options.confirm) {
      confirmed = await options.confirm({ parsed, paths });
    } else {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await prompt.question(
          `${parsed.operation} Baton ${paths.host}/${paths.scope} at ${paths.supportRoot}? [y/N] `,
        );
        confirmed = /^(?:y|yes)$/i.test(answer.trim());
      } finally {
        prompt.close();
      }
    }
    if (!confirmed) fail('CONFIRMATION_DECLINED', 'installation was not confirmed');
  }
  const legacyIdentity = await loadLegacyIdentity(bundleRoot);
  const allowed = allowedAffectedPaths(paths, legacyIdentity.manifest);
  await validateAffectedTargets(paths, allowed);

  let recovered = [];
  if (!parsed.dryRun) {
    recovered = await recoverPrepared({ stateRoot: paths.stateRoot, allowedPaths: allowed });
  } else {
    const prepared = (await inspectTransactions({
      stateRoot: paths.stateRoot,
      allowedPaths: allowed,
    })).filter(({ journal }) => journal.status === 'prepared');
    if (prepared.length > 0) {
      return {
        paths,
        dryRun: true,
        actions: prepared.map(({ id }) => `recover prepared transaction: ${id}`),
        recovered: [],
      };
    }
  }

  const generatedManifest = await loadGeneratedManifest(bundleRoot);
  const prior = await readInstallManifest(paths, generatedManifest);
  if (parsed.operation === 'rollback') {
    if (prior) {
      await verifyOwnedFiles(prior.value, paths, generatedManifest);
      await assertNoUnownedContent(prior.value, paths, generatedManifest);
    }
    const plan = await planRollback({ paths, allowed, selector: parsed.rollback });
    if (parsed.dryRun) {
      return { paths, dryRun: true, actions: plan.actions, recovered };
    }
    const result = await rollbackTransaction({
      stateRoot: paths.stateRoot,
      allowedPaths: allowed,
      selector: parsed.rollback,
      actions: plan.actions,
      postRestore: prior
        ? () => removeCreatedLauncherRoot(prior.value, paths)
        : undefined,
    });
    return {
      paths,
      dryRun: false,
      actions: plan.actions,
      transactionId: result.transaction.id,
      rolledBack: result.selected,
      recovered,
    };
  }

  if (parsed.operation === 'uninstall') {
    if (!prior) fail('NOT_INSTALLED', 'no Baton install manifest exists at the target');
    await verifyOwnedFiles(prior.value, paths, generatedManifest);
    await assertNoUnownedContent(prior.value, paths, generatedManifest);
    const actions = uninstallActions(paths, prior.value);
    if (parsed.dryRun) return { paths, dryRun: true, actions, recovered };
    const transactionId = await performUninstall({
      paths,
      generatedManifest,
      prior,
      actions,
      options,
    });
    return { paths, dryRun: false, actions, transactionId, recovered };
  }

  if (prior) {
    await verifyOwnedFiles(prior.value, paths, generatedManifest);
    await assertNoUnownedContent(prior.value, paths, generatedManifest);
  }
  const legacy = prior
    ? { state: 'none', commandPaths: [], prefix: null }
    : await inspectLegacyClaude({ bundleRoot, paths });
  const directories = await createdDirectories(paths, prior?.value);
  const desired = await buildDesiredInstall({
    bundleRoot,
    paths,
    generatedManifest,
    createdDirectories: directories,
  });
  await desiredCollisions(desired, prior?.value, paths, {
    allowSupportRoot: legacy.state === 'exact',
  });

  if (
    prior
    && prior.value.package_version === desired.manifest.package_version
    && prior.value.package_digest === desired.manifest.package_digest
    && prior.bytes.equals(desired.manifestBytes)
  ) {
    return {
      paths,
      dryRun: parsed.dryRun,
      actions: [],
      noOp: true,
      recovered,
    };
  }

  const actions = installActions(paths, legacy);
  if (parsed.dryRun) return { paths, dryRun: true, actions, recovered };
  const transactionId = await performInstall({
    paths,
    bundleRoot,
    generatedManifest,
    prior,
    legacy,
    desired,
    actions,
    options,
  });
  return {
    paths,
    dryRun: false,
    actions,
    transactionId,
    migratedLegacy: legacy.state === 'exact',
    recovered,
  };
}

function renderResult(result) {
  if (result.help) return `${result.help}\n`;
  if (result.recovered?.length) {
    process.stdout.write(`Recovered prepared transactions: ${result.recovered.join(', ')}\n`);
  }
  if (result.noOp) return 'No changes: installed package and manifest already match.\n';
  const prefix = result.dryRun ? 'Dry run' : 'Applied';
  const lines = result.actions.map((action, index) => `${index + 1}. ${action}`);
  if (result.transactionId) lines.push(`Transaction: ${result.transactionId}`);
  if (result.rolledBack) lines.push(`Rolled back: ${result.rolledBack}`);
  return `${prefix} ${result.actions.length} action(s):\n${lines.join('\n')}\n`;
}

async function main() {
  const result = await runInstaller(process.argv.slice(2));
  process.stdout.write(renderResult(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const code = error instanceof InstallError ? error.code : 'INSTALL_FAILED';
    process.stderr.write(`[${code}] ${error.message}\n`);
    process.exitCode = 1;
  });
}

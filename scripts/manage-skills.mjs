#!/usr/bin/env node

import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  checkGenerated,
  DEFAULT_BUNDLE_ROOT,
  DEFAULT_OUTPUT_ROOT,
} from './generate-skills.mjs';
import { sha256, stableJSON } from './lib/digest.mjs';

export class PayloadError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'PayloadError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new PayloadError(code, message, cause);
}

async function maybeLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function sorted(values) {
  return [...values].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function expectedTree(records, skill) {
  const files = new Map();
  const directories = new Set();
  const prefix = `${skill}/`;
  for (const record of records) {
    if (!record.path.startsWith(prefix)) continue;
    const path = record.path.slice(prefix.length);
    files.set(path, record);
    let parent = dirname(path).replaceAll('\\', '/');
    while (parent !== '.' && parent !== '') {
      directories.add(parent);
      parent = dirname(parent).replaceAll('\\', '/');
    }
  }
  return { files, directories };
}

async function inspectTree(
  root,
  expected,
  {
    allowMissing = false,
    allowedTemporaryFiles = new Set(),
  } = {},
) {
  const rootInfo = await maybeLstat(root);
  if (!rootInfo) return { state: 'absent' };
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    return { state: 'mismatch', reason: `${root} is not a real directory` };
  }
  const files = new Map();
  const temporaryFiles = new Set();
  const directories = new Set();
  async function walk(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absolute = join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        throw new PayloadError('MODIFIED_PAYLOAD', `${absolute} is a symbolic link`);
      }
      if (info.isDirectory()) {
        directories.add(path);
        await walk(absolute, path);
      } else if (info.isFile()) {
        if (allowedTemporaryFiles.has(path)) {
          temporaryFiles.add(path);
          continue;
        }
        files.set(path, {
          digest: sha256(await readFile(absolute)),
        });
      } else {
        throw new PayloadError(
          'MODIFIED_PAYLOAD',
          `${absolute} is not a regular file or directory`,
        );
      }
    }
  }
  try {
    await walk(root, '');
  } catch (error) {
    if (error instanceof PayloadError) {
      return { state: 'mismatch', reason: error.message };
    }
    throw error;
  }
  const observedDirectories = sorted(directories);
  const expectedDirectories = sorted(expected.directories);
  const observedFiles = sorted(files.keys());
  const expectedFiles = sorted(expected.files.keys());
  if (
    observedDirectories.some((path) => !expected.directories.has(path))
    || observedFiles.some((path) => !expected.files.has(path))
    || (
      !allowMissing
      && (
        JSON.stringify(observedDirectories) !== JSON.stringify(expectedDirectories)
        || JSON.stringify(observedFiles) !== JSON.stringify(expectedFiles)
      )
    )
  ) {
    return { state: 'mismatch', reason: `${root} has added, missing, or moved content` };
  }
  for (const [path, observed] of files) {
    const record = expected.files.get(path);
    if (observed.digest !== record.digest) {
      return { state: 'mismatch', reason: `${join(root, path)} differs from the payload` };
    }
  }
  const exact = (
    JSON.stringify(observedDirectories) === JSON.stringify(expectedDirectories)
    && JSON.stringify(observedFiles) === JSON.stringify(expectedFiles)
  );
  return {
    state: exact ? 'exact' : 'partial',
    observedFiles: observedFiles.map((path) => ({
      path,
      digest: files.get(path).digest,
    })),
    temporaryFiles,
  };
}

async function safeSkillsDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    fail('UNSAFE_DESTINATION', 'the skills directory must be an absolute path');
  }
  const requested = resolve(path);
  let canonical;
  try {
    canonical = await realpath(requested);
  } catch (error) {
    fail('UNSAFE_DESTINATION', 'the skills directory must already exist', error);
  }
  if (canonical !== requested) {
    fail('UNSAFE_DESTINATION', 'the skills directory cannot contain symbolic links');
  }
  const info = await lstat(canonical);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('UNSAFE_DESTINATION', 'the skills directory must be a real directory');
  }
  if (
    typeof process.getuid === 'function'
    && info.uid !== process.getuid()
  ) {
    fail('UNSAFE_DESTINATION', 'the skills directory is not owned by the current user');
  }
  return canonical;
}

function stageIdentity(manifest, operation) {
  return {
    schema_version: 'baton.skills-stage/v1',
    operation,
    release: manifest.release,
    payload_digest: manifest.payload_digest,
  };
}

function copyTemporaryFiles(expected) {
  return new Set([...expected.files.keys()].map(
    (path) => `.baton-write-${sha256(Buffer.from(path)).slice('sha256:'.length)}`,
  ));
}

function stagePath(skillsDirectory, manifest, operation) {
  return join(
    skillsDirectory,
    `.baton-${operation}-stage-`
      + manifest.payload_digest.slice('sha256:'.length, 'sha256:'.length + 16),
  );
}

async function rejectUnknownStages(skillsDirectory, manifest) {
  const allowed = new Set([
    stagePath(skillsDirectory, manifest, 'install'),
    stagePath(skillsDirectory, manifest, 'remove'),
  ]);
  const entries = await readdir(skillsDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (
      (
        entry.name.startsWith('.baton-install-stage-')
        || entry.name.startsWith('.baton-remove-stage-')
      )
      && !allowed.has(join(skillsDirectory, entry.name))
    ) {
      fail('AMBIGUOUS_STAGE', `unknown Baton staging path ${entry.name}`);
    }
  }
}

async function inspectStage(path, manifest, expectedBySkill, operation) {
  const info = await maybeLstat(path);
  if (!info) return { state: 'absent' };
  if (info.isSymbolicLink() || !info.isDirectory()) {
    fail('AMBIGUOUS_STAGE', 'the Baton staging path is not a real directory');
  }
  const markerPath = join(path, 'stage.json');
  let marker;
  try {
    marker = await readFile(markerPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      fail('AMBIGUOUS_STAGE', 'the Baton staging marker cannot be read', error);
    }
    const entries = await readdir(path);
    if (entries.length === 0) {
      return {
        state: 'empty',
        entries: new Set(),
        entryStates: new Map(),
        entryFiles: new Map(),
      };
    }
    fail('AMBIGUOUS_STAGE', 'the Baton staging marker is missing', error);
  }
  if (!marker.equals(stableJSON(stageIdentity(manifest, operation)))) {
    fail('AMBIGUOUS_STAGE', 'the Baton staging marker belongs to another payload');
  }
  const allowed = new Set([
    'stage.json',
    ...manifest.skills.map(({ name }) => name),
    ...(operation === 'install'
      ? manifest.skills.map(({ name }) => `.copy-${name}`)
      : []),
  ]);
  const entries = await readdir(path, { withFileTypes: true });
  const entryStates = new Map();
  const entryFiles = new Map();
  for (const entry of entries) {
    if (!allowed.has(entry.name)) {
      fail('AMBIGUOUS_STAGE', `the Baton staging path contains ${entry.name}`);
    }
    if (entry.name === 'stage.json') {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        fail('AMBIGUOUS_STAGE', 'the Baton staging marker is not a regular file');
      }
      continue;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      fail('AMBIGUOUS_STAGE', `the Baton staging entry ${entry.name} is unsafe`);
    }
    const skill = entry.name.startsWith('.copy-')
      ? entry.name.slice('.copy-'.length)
      : entry.name;
    const copy = entry.name.startsWith('.copy-');
    const state = await inspectTree(
      join(path, entry.name),
      expectedBySkill.get(skill),
      {
        allowMissing: true,
        allowedTemporaryFiles: copy
          ? copyTemporaryFiles(expectedBySkill.get(skill))
          : new Set(),
      },
    );
    if (state.state === 'mismatch') {
      fail('AMBIGUOUS_STAGE', state.reason);
    }
    entryStates.set(entry.name, state.state);
    entryFiles.set(entry.name, state.observedFiles);
  }
  return {
    state: 'exact',
    entries: new Set(entries.map(({ name }) => name)),
    entryStates,
    entryFiles,
  };
}

async function createStage(path, manifest, operation, options) {
  const existing = await maybeLstat(path);
  if (!existing) {
    await mkdir(path);
    await checkpoint(options, `${operation}-stage-created`);
  } else {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      fail('AMBIGUOUS_STAGE', 'the Baton staging path is not a real directory');
    }
    const entries = await readdir(path);
    if (entries.length !== 0) {
      fail('AMBIGUOUS_STAGE', 'the markerless Baton staging path is not empty');
    }
  }
  await writeFile(join(path, 'stage.json'), stableJSON(stageIdentity(manifest, operation)), {
    flag: 'wx',
  });
  await checkpoint(options, `${operation}-stage-marked`);
}

async function removeKnownTree(
  root,
  expected,
  {
    allowMissing = false,
    code = 'CHANGED_DURING_REMOVE',
  } = {},
) {
  const before = await inspectTree(root, expected, { allowMissing });
  if (
    before.state === 'mismatch'
    || (!allowMissing && before.state !== 'exact')
  ) {
    fail(code, before.reason ?? `${root} changed before removal`);
  }
  for (const [path, record] of expected.files) {
    const absolute = join(root, path);
    const info = await maybeLstat(absolute);
    if (!info && allowMissing) continue;
    if (
      !info
      || info.isSymbolicLink()
      || !info.isFile()
      || sha256(await readFile(absolute)) !== record.digest
    ) {
      fail(code, `${absolute} changed before removal`);
    }
    await rm(absolute, { force: false });
  }
  const directories = sorted(expected.directories)
    .sort((left, right) => right.split('/').length - left.split('/').length);
  for (const path of directories) {
    try {
      await rmdir(join(root, path));
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') continue;
      fail(code, `${join(root, path)} gained content`, error);
    }
  }
  try {
    await rmdir(root);
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return;
    fail(code, `${root} gained content`, error);
  }
}

async function inspectCopyTree(root, expected) {
  return inspectTree(root, expected, {
    allowMissing: true,
    allowedTemporaryFiles: copyTemporaryFiles(expected),
  });
}

async function removeCopyTree(root, expected) {
  const state = await inspectCopyTree(root, expected);
  if (state.state === 'absent') return;
  if (state.state === 'mismatch') {
    fail('AMBIGUOUS_STAGE', state.reason);
  }
  for (const path of state.temporaryFiles) {
    const absolute = join(root, path);
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || !info.isFile()) {
      fail('AMBIGUOUS_STAGE', `${absolute} is not a recoverable staging file`);
    }
    await rm(absolute, { force: false });
  }
  await removeKnownTree(root, expected, {
    allowMissing: true,
    code: 'AMBIGUOUS_STAGE',
  });
}

async function writeStagedSkill({
  stage,
  skill,
  expected,
  payloadRoot,
}) {
  const temporary = join(stage, `.copy-${skill}`);
  const staged = join(stage, skill);
  const existing = await maybeLstat(temporary);
  if (!existing) {
    await mkdir(temporary);
  } else if (existing.isSymbolicLink() || !existing.isDirectory()) {
    fail('AMBIGUOUS_STAGE', `${temporary} is not a real staging directory`);
  }
  let copyState = await inspectCopyTree(temporary, expected);
  if (copyState.state === 'mismatch') fail('AMBIGUOUS_STAGE', copyState.reason);
  for (const path of copyState.temporaryFiles) {
    const absolute = join(temporary, path);
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || !info.isFile()) {
      fail('AMBIGUOUS_STAGE', `${absolute} is not a recoverable staging file`);
    }
    await rm(absolute, { force: false });
  }
  for (const [path, record] of expected.files) {
    const destination = join(temporary, path);
    const destinationInfo = await maybeLstat(destination);
    if (destinationInfo) continue;
    await mkdir(dirname(destination), { recursive: true });
    const bytes = await readFile(join(payloadRoot, record.path));
    if (sha256(bytes) !== record.digest) {
      fail('SOURCE_MISMATCH', `${record.path} differs from its payload provenance`);
    }
    const temporaryFile = join(
      temporary,
      `.baton-write-${sha256(Buffer.from(path)).slice('sha256:'.length)}`,
    );
    await writeFile(temporaryFile, bytes, {
      flag: 'wx',
    });
    const temporaryInfo = await lstat(temporaryFile);
    if (
      temporaryInfo.isSymbolicLink()
      || !temporaryInfo.isFile()
      || sha256(await readFile(temporaryFile)) !== record.digest
    ) {
      fail('SOURCE_MISMATCH', `${temporaryFile} differs after staging`);
    }
    try {
      await link(temporaryFile, destination);
    } catch (error) {
      if (['EXDEV', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) {
        fail(
          'UNSUPPORTED_FILESYSTEM',
          'the skills filesystem does not support safe hard-link staging',
          error,
        );
      }
      throw error;
    }
    await rm(temporaryFile, { force: false });
  }
  copyState = await inspectCopyTree(temporary, expected);
  if (
    copyState.state !== 'exact'
    || copyState.temporaryFiles.size !== 0
  ) {
    fail('SOURCE_MISMATCH', copyState.reason ?? `${temporary} is incomplete`);
  }
  await rename(temporary, staged);
}

async function checkpoint(options, name) {
  if (options.checkpoint) await options.checkpoint(name);
}

async function preflight(skillsDirectory, manifest, expectedBySkill) {
  const states = new Map();
  for (const { name } of manifest.skills) {
    const state = await inspectTree(join(skillsDirectory, name), expectedBySkill.get(name));
    if (state.state === 'mismatch') {
      fail(
        'MODIFIED_PAYLOAD',
        `${state.reason}; remove an older release with that exact release's safe removal`,
      );
    }
    states.set(name, state.state);
  }
  return states;
}

async function install({
  skillsDirectory,
  payloadRoot,
  manifest,
  expectedBySkill,
  options,
}) {
  const states = await preflight(skillsDirectory, manifest, expectedBySkill);
  const removalStage = stagePath(skillsDirectory, manifest, 'remove');
  if (await maybeLstat(removalStage)) {
    fail('INCOMPLETE_REMOVE', 'complete the interrupted removal before installing');
  }
  const stage = stagePath(skillsDirectory, manifest, 'install');
  const observedStage = await inspectStage(stage, manifest, expectedBySkill, 'install');
  if (
    [...states.values()].every((state) => state === 'exact')
    && observedStage.state === 'absent'
  ) {
    return {
      operation: 'install',
      noOp: true,
      dryRun: !options.apply,
      changed: [],
      existing: states,
      stage: observedStage,
    };
  }
  const planned = manifest.skills
    .map(({ name }) => name)
    .filter((name) => states.get(name) === 'absent');
  const plan = {
    operation: 'install',
    noOp: planned.length === 0 && observedStage.state === 'absent',
    changed: planned,
    existing: states,
    stage: observedStage,
  };
  if (!options.apply) {
    return {
      ...plan,
      dryRun: true,
    };
  }
  if (['absent', 'empty'].includes(observedStage.state)) {
    await createStage(stage, manifest, 'install', options);
  }
  const currentStage = await inspectStage(stage, manifest, expectedBySkill, 'install');
  for (const { name } of manifest.skills) {
    const copy = join(stage, `.copy-${name}`);
    if (
      states.get(name) === 'exact'
      && currentStage.entries.has(`.copy-${name}`)
    ) {
      await removeCopyTree(copy, expectedBySkill.get(name));
    }
    if (
      states.get(name) === 'absent'
      && currentStage.entryStates.get(name) === 'partial'
    ) {
      fail('AMBIGUOUS_STAGE', `${name} is partially staged without an installed target`);
    }
    if (
      states.get(name) === 'absent'
      && !currentStage.entries.has(name)
    ) {
      await writeStagedSkill({
        stage,
        skill: name,
        expected: expectedBySkill.get(name),
        payloadRoot,
      });
      await checkpoint(options, `staged:${name}`);
    }
  }
  await preflight(skillsDirectory, manifest, expectedBySkill);
  const changed = [];
  for (const { name } of manifest.skills) {
    const target = join(skillsDirectory, name);
    const staged = join(stage, name);
    const targetState = await inspectTree(target, expectedBySkill.get(name));
    const stagedState = await inspectTree(
      staged,
      expectedBySkill.get(name),
      { allowMissing: targetState.state === 'exact' },
    );
    if (targetState.state === 'exact') {
      if (['exact', 'partial'].includes(stagedState.state)) {
        await removeKnownTree(staged, expectedBySkill.get(name), {
          allowMissing: true,
          code: 'AMBIGUOUS_STAGE',
        });
      }
      continue;
    }
    if (targetState.state !== 'absent' || stagedState.state !== 'exact') {
      fail('CHANGED_DURING_INSTALL', `${name} changed after preflight`);
    }
    await rename(staged, target);
    changed.push(name);
    await checkpoint(options, `installed:${name}`);
  }
  await rm(join(stage, 'stage.json'));
  await checkpoint(options, 'install-stage-unmarked');
  await rmdir(stage);
  return {
    operation: 'install',
    noOp: changed.length === 0,
    changed,
    existing: states,
    stage: observedStage,
  };
}

async function remove({
  skillsDirectory,
  manifest,
  expectedBySkill,
  options,
}) {
  const states = await preflight(skillsDirectory, manifest, expectedBySkill);
  const installStage = stagePath(skillsDirectory, manifest, 'install');
  if (await maybeLstat(installStage)) {
    fail('INCOMPLETE_INSTALL', 'complete the interrupted install before removing this payload');
  }
  const stage = stagePath(skillsDirectory, manifest, 'remove');
  const observedStage = await inspectStage(stage, manifest, expectedBySkill, 'remove');
  if (
    [...states.values()].every((state) => state === 'absent')
    && observedStage.state === 'absent'
  ) {
    return {
      operation: 'remove',
      noOp: true,
      dryRun: !options.apply,
      changed: [],
      existing: states,
      stage: observedStage,
    };
  }
  const planned = new Set(
    manifest.skills
      .map(({ name }) => name)
      .filter((name) => states.get(name) === 'exact'),
  );
  if (observedStage.state === 'exact') {
    for (const name of observedStage.entries) {
      if (name !== 'stage.json') planned.add(name);
    }
  }
  const plan = {
    operation: 'remove',
    noOp: planned.size === 0 && observedStage.state === 'absent',
    changed: manifest.skills.map(({ name }) => name).filter((name) => planned.has(name)),
    existing: states,
    stage: observedStage,
  };
  if (!options.apply) {
    return {
      ...plan,
      dryRun: true,
    };
  }
  if (['absent', 'empty'].includes(observedStage.state)) {
    await createStage(stage, manifest, 'remove', options);
  }
  const changed = [];
  for (const { name } of manifest.skills) {
    const target = join(skillsDirectory, name);
    const quarantined = join(stage, name);
    const targetState = await inspectTree(target, expectedBySkill.get(name));
    const quarantinedState = await inspectTree(
      quarantined,
      expectedBySkill.get(name),
      { allowMissing: true },
    );
    const resumableQuarantine = ['exact', 'partial'].includes(quarantinedState.state);
    if (targetState.state === 'exact' && resumableQuarantine) {
      fail('AMBIGUOUS_STAGE', `${name} exists in both the destination and removal stage`);
    }
    if (targetState.state === 'absent' && resumableQuarantine) continue;
    if (targetState.state === 'absent' && quarantinedState.state === 'absent') continue;
    if (targetState.state !== 'exact' || quarantinedState.state !== 'absent') {
      fail('CHANGED_DURING_REMOVE', `${name} changed after preflight`);
    }
    await rename(target, quarantined);
    await checkpoint(options, `removal-staged:${name}`);
  }
  for (const { name } of manifest.skills) {
    const quarantined = join(stage, name);
    const state = await inspectTree(
      quarantined,
      expectedBySkill.get(name),
      { allowMissing: true },
    );
    if (state.state === 'absent') continue;
    if (state.state === 'mismatch') fail('CHANGED_DURING_REMOVE', state.reason);
    await removeKnownTree(quarantined, expectedBySkill.get(name), { allowMissing: true });
    changed.push(name);
    await checkpoint(options, `removed:${name}`);
  }
  await rm(join(stage, 'stage.json'));
  await checkpoint(options, 'remove-stage-unmarked');
  await rmdir(stage);
  return {
    operation: 'remove',
    noOp: changed.length === 0,
    changed,
    existing: states,
    stage: observedStage,
  };
}

function describePlan({
  result,
  manifest,
  operation,
  skillsDirectory,
}) {
  const changed = new Set(result.changed);
  const exactTargets = new Set(
    [...result.existing]
      .filter(([, state]) => state === 'exact')
      .map(([name]) => name),
  );
  const targetFiles = manifest.files
    .filter(({ path }) => exactTargets.has(path.split('/', 1)[0]))
    .map((record) => ({
      path: join(skillsDirectory, record.path),
      digest: record.digest,
    }));
  const stageDirectory = stagePath(skillsDirectory, manifest, operation);
  const stagedFiles = [];
  for (const [entry, files] of result.stage.entryFiles ?? []) {
    for (const file of files) {
      stagedFiles.push({
        path: join(stageDirectory, entry, file.path),
        digest: file.digest,
      });
    }
  }
  const existingFiles = [...targetFiles, ...stagedFiles]
    .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const intendedChanges = [];
  for (const { name } of manifest.skills) {
    if (!changed.has(name)) continue;
    if (operation === 'remove' && !exactTargets.has(name)) {
      for (const file of result.stage.entryFiles?.get(name) ?? []) {
        intendedChanges.push({
          action: 'remove',
          path: join(stageDirectory, name, file.path),
          digest: file.digest,
        });
      }
      continue;
    }
    for (const record of manifest.files.filter(
      ({ path }) => path.startsWith(`${name}/`),
    )) {
      intendedChanges.push({
        action: operation === 'install' ? 'add' : 'remove',
        path: join(skillsDirectory, record.path),
        digest: record.digest,
      });
    }
  }
  return {
    existingFiles,
    intendedChanges: intendedChanges.sort(
      (left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)),
    ),
  };
}

export async function manageSkills({
  operation,
  skillsDirectory,
  bundleRoot = DEFAULT_BUNDLE_ROOT,
  payloadRoot = bundleRoot === DEFAULT_BUNDLE_ROOT
    ? DEFAULT_OUTPUT_ROOT
    : join(bundleRoot, 'skills'),
  apply = false,
  ...options
}) {
  if (!['install', 'remove'].includes(operation)) {
    fail('INVALID_ARGUMENT', 'operation must be install or remove');
  }
  const destination = await safeSkillsDirectory(skillsDirectory);
  let manifest;
  try {
    manifest = await checkGenerated({ bundleRoot, outputRoot: payloadRoot });
  } catch (error) {
    fail('SOURCE_MISMATCH', 'the checked-out skills payload does not match its sources', error);
  }
  const sourceCheckout = await realpath(bundleRoot);
  const sourcePayload = await realpath(payloadRoot);
  const expectedBySkill = new Map(manifest.skills.map(({ name }) => [
    name,
    expectedTree(manifest.files, name),
  ]));
  await rejectUnknownStages(destination, manifest);
  const invoke = async (operationOptions) => operation === 'install'
    ? await install({
      skillsDirectory: destination,
      payloadRoot,
      manifest,
      expectedBySkill,
      options: operationOptions,
    })
    : await remove({
      skillsDirectory: destination,
      manifest,
      expectedBySkill,
      options: operationOptions,
    });
  const result = await invoke({
    ...options,
    apply,
  });
  const plan = describePlan({
    result,
    manifest,
    operation,
    skillsDirectory: destination,
  });
  return {
    ...result,
    sourceCheckout,
    sourcePayload,
    skillsDirectory: destination,
    release: manifest.release,
    payloadDigest: manifest.payload_digest,
    existingFiles: plan.existingFiles,
    intendedChanges: plan.intendedChanges,
  };
}

function parseArguments(argv) {
  if (
    ![2, 3].includes(argv.length)
    || !['install', 'remove'].includes(argv[0])
    || (argv.length === 3 && argv[2] !== '--apply')
  ) {
    fail(
      'INVALID_ARGUMENT',
      'usage: node scripts/manage-skills.mjs install|remove /absolute/path/to/skills [--apply]',
    );
  }
  return {
    operation: argv[0],
    skillsDirectory: argv[1],
    apply: argv[2] === '--apply',
  };
}

export function formatResult(result) {
  const lines = [
    `${result.dryRun ? 'PREVIEW' : 'APPLIED'} ${result.operation}`,
    `source checkout: ${result.sourceCheckout}`,
    `source payload: ${result.sourcePayload}`,
    `release: ${result.release}`,
    `payload digest: ${result.payloadDigest}`,
    `destination: ${result.skillsDirectory}`,
    'existing Baton targets:',
    ...[...result.existing].map(([name, state]) => `  ${name}: ${state}`),
    'existing Baton files:',
    ...(result.existingFiles.length === 0
      ? ['  (none)']
      : result.existingFiles.map(
        ({ path, digest }) => `  ${path} ${digest}`,
      )),
    `staging state: ${result.stage.state}`,
    'intended file changes:',
    ...(result.intendedChanges.length === 0
      ? ['  (none)']
      : result.intendedChanges.map(
        ({ action, path, digest }) => `  ${action} ${path} ${digest}`,
      )),
  ];
  if (result.dryRun && result.intendedChanges.length > 0) {
    lines.push(
      'No files were changed. Revalidate this preview and use --apply only after approval.',
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const result = await manageSkills(parseArguments(process.argv.slice(2)));
  process.stdout.write(formatResult(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const code = error instanceof PayloadError ? error.code : 'PAYLOAD_FAILED';
    process.stderr.write(`[${code}] ${error.message}\n`);
    process.exitCode = 1;
  });
}

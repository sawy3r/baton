import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { parseArguments, runInstaller } from '../../scripts/install.mjs';
import {
  OPERATIONS,
  PORTABLE_RUNTIME_FILES,
  SUPPORT_FILES,
} from '../../scripts/lib/catalog.mjs';
import { sha256, stableJSON } from '../../scripts/lib/digest.mjs';
import { baselineFixture } from '../board/helpers.mjs';
import {
  assertInstalled,
  environment,
  initializeRepository,
  installHistoricalPackage,
  installSyntheticLegacy,
  ROOT,
  snapshot,
  symlink,
  syntheticLegacyBundle,
  targets,
  temporaryFixture,
  writeMode,
} from './helpers.mjs';

function argumentsFor(host, scope, repository, rest = []) {
  return [
    '--host',
    host,
    ...(scope === 'user' ? ['--user'] : ['--project', repository]),
    ...rest,
  ];
}

function interruptedAt(boundary) {
  return async (observed) => {
    if (observed !== boundary) return;
    const error = new Error(`injected interruption at ${boundary}`);
    error.batonInterrupted = true;
    throw error;
  };
}

async function rejectCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

function waitForOutputLine(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let output = '';
    let diagnostics = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish(
        reject,
        new Error(`installed WebUI did not start within ${timeoutMs}ms: ${diagnostics}`),
      );
    }, timeoutMs);
    const finish = (operation, value) => {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      operation(value);
    };
    const onData = (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline !== -1) finish(resolve, output.slice(0, newline));
    };
    const onExit = (code, signal) => {
      finish(
        reject,
        new Error(
          `installed WebUI exited before startup (${code ?? signal}): ${diagnostics}`,
        ),
      );
    };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      diagnostics += chunk;
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
}

async function transactionCount(stateRoot) {
  try {
    return (await readdir(join(stateRoot, 'transactions'))).length;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

async function managedSnapshot(target) {
  return {
    support: await snapshot(target.supportRoot),
    launchers: await Promise.all(
      OPERATIONS.map(({ name }) => snapshot(join(target.launcherRoot, name))),
    ),
  };
}

test('checked-in legacy identity freezes 8 commands, 79 package files, and the exact block', async () => {
  const manifest = JSON.parse(
    await readFile(join(ROOT, 'legacy', 'v0.16.0', 'install-manifest.json'), 'utf8'),
  );
  const block = await readFile(join(ROOT, 'legacy', 'v0.16.0', 'claude-global-block.md'));
  assert.equal(Object.keys(manifest.commands).length, 8);
  assert.equal(Object.keys(manifest.package_files).length, 79);
  assert.equal(
    sha256(block),
    'sha256:bfa1fbe8bb01436f585a94067fa9e0131efea75e6f5d59c2e1440527e88d8484',
  );
  assert.equal(manifest.instruction_block.digest, sha256(block));
});

test('shell wrappers are executable source-relative delegates with no mutation logic', async (t) => {
  const fixture = await temporaryFixture(t, 'baton-wrapper-');
  for (const host of ['claude', 'codex']) {
    const path = join(ROOT, `install-${host}.sh`);
    const text = await readFile(path, 'utf8');
    assert.match(text, /BASH_SOURCE/);
    assert.match(text, new RegExp(`--host ${host}`));
    assert.doesNotMatch(text, /^(?:cp|mv|rm|install|chmod)\s/m);
    assert.notEqual((await lstat(path)).mode & 0o111, 0);
    const before = await snapshot(fixture.home);
    const output = execFileSync(path, ['--user', '--dry-run'], {
      cwd: fixture.home,
      encoding: 'utf8',
      env: environment(fixture.home),
    });
    assert.match(output, /Dry run 7 action/);
    assert.deepEqual(await snapshot(fixture.home), before);
  }
});

test('clean user and project installs cover both hosts, dry-run, no-op, and uninstall', async (t) => {
  for (const host of ['claude', 'codex']) {
    for (const scope of ['user', 'project']) {
      const fixture = await temporaryFixture(t, `baton-${host}-${scope}-`);
      const repository = scope === 'project'
        ? initializeRepository(join(fixture.home, 'project'))
        : null;
      const target = targets(host, scope, fixture.home, repository);
      const env = environment(fixture.home);
      const baseArguments = argumentsFor(host, scope, repository);

      const before = await snapshot(fixture.home);
      const dryRun = await runInstaller([...baseArguments, '--dry-run'], {
        env,
        cwd: repository ?? fixture.home,
        isTTY: false,
      });
      assert.equal(dryRun.actions.length, 7);
      assert.deepEqual(await snapshot(fixture.home), before);

      const installed = await runInstaller([...baseArguments, '--yes'], {
        env,
        cwd: repository ?? fixture.home,
        isTTY: false,
      });
      assert.equal(installed.actions.length, 7);
      const manifest = await assertInstalled(target, host, scope);
      assert.equal(manifest.owned_files.length, SUPPORT_FILES.length + OPERATIONS.length);
      const manifestBytes = await readFile(join(target.supportRoot, 'install-manifest.json'));
      const transactions = await transactionCount(target.stateRoot);

      const repeated = await runInstaller([...baseArguments, '--yes'], {
        env,
        cwd: repository ?? fixture.home,
        isTTY: false,
      });
      assert.equal(repeated.noOp, true);
      assert.equal(repeated.actions.length, 0);
      assert.deepEqual(
        await readFile(join(target.supportRoot, 'install-manifest.json')),
        manifestBytes,
      );
      assert.equal(await transactionCount(target.stateRoot), transactions);

      const foreign = join(target.launcherRoot, 'foreign-skill', 'SKILL.md');
      await mkdir(join(target.launcherRoot, 'foreign-skill'), { recursive: true });
      await writeFile(foreign, 'foreign\n');
      await runInstaller([...baseArguments, '--uninstall', '--yes'], {
        env,
        cwd: repository ?? fixture.home,
        isTTY: false,
      });
      await assert.rejects(lstat(target.supportRoot), { code: 'ENOENT' });
      assert.equal(await readFile(foreign, 'utf8'), 'foreign\n');
    }
  }
});

test('pinned RC2, RC3, and RC4 packages upgrade, roll back exactly, and re-upgrade', async (t) => {
  const currentVersion = (await readFile(join(ROOT, 'VERSION'), 'utf8')).trim();
  for (const version of ['1.0.0-rc.2', '1.0.0-rc.3', '1.0.0-rc.4']) {
    for (const host of ['claude', 'codex']) {
      for (const scope of ['user', 'project']) {
        const fixture = await temporaryFixture(t, `baton-upgrade-${version}-${host}-${scope}-`);
        const repository = scope === 'project'
          ? initializeRepository(join(fixture.home, 'project'))
          : null;
        const env = environment(fixture.home);
        const baseArguments = argumentsFor(host, scope, repository);
        const { target } = await installHistoricalPackage({
          version,
          host,
          scope,
          home: fixture.home,
          repository,
        });
        const foreign = join(target.launcherRoot, 'foreign-skill', 'SKILL.md');
        await writeMode(foreign, Buffer.from('foreign skill\n'), 0o644);
        const before = await managedSnapshot(target);
        const foreignBefore = await snapshot(foreign);

        const preview = await runInstaller([...baseArguments, '--dry-run'], {
          env,
          cwd: repository ?? fixture.home,
          isTTY: false,
        });
        assert.equal(preview.actions.length, 7, `${version}/${host}/${scope} preview`);

        const upgraded = await runInstaller([...baseArguments, '--yes'], {
          env,
          cwd: repository ?? fixture.home,
          isTTY: false,
        });
        assert.equal(upgraded.actions.length, 7, `${version}/${host}/${scope} upgrade`);
        assert.equal(
          (await assertInstalled(target, host, scope)).package_version,
          currentVersion,
        );
        assert.deepEqual(await snapshot(foreign), foreignBefore);

        const repeated = await runInstaller([...baseArguments, '--yes'], {
          env,
          cwd: repository ?? fixture.home,
          isTTY: false,
        });
        assert.equal(repeated.noOp, true);

        const rolledBack = await runInstaller(
          [...baseArguments, '--rollback', 'latest', '--yes'],
          {
            env,
            cwd: repository ?? fixture.home,
            isTTY: false,
          },
        );
        assert.equal(rolledBack.rolledBack, upgraded.transactionId);
        assert.deepEqual(await managedSnapshot(target), before);
        assert.deepEqual(await snapshot(foreign), foreignBefore);

        const reupgraded = await runInstaller([...baseArguments, '--yes'], {
          env,
          cwd: repository ?? fixture.home,
          isTTY: false,
        });
        assert.equal(reupgraded.actions.length, 7);
        assert.equal(
          (await assertInstalled(target, host, scope)).package_version,
          currentVersion,
        );
        assert.equal(
          (await runInstaller([...baseArguments, '--yes'], {
            env,
            cwd: repository ?? fixture.home,
            isTTY: false,
          })).noOp,
          true,
        );
      }
    }
  }
});

test('unsupported or altered predecessor claims fail with zero installer mutation', async (t) => {
  const cases = [
    {
      name: 'owned-byte',
      code: 'MODIFIED_OWNED_FILE',
      mutate: async ({ manifest, target }) => {
        const file = manifest.owned_files.find(({ root }) => root === 'support');
        await writeMode(join(target.supportRoot, file.path), Buffer.from('altered\n'), 0o644);
      },
    },
    {
      name: 'renamed-path',
      code: 'INVALID_MANIFEST',
      mutate: async ({ manifest }) => {
        manifest.owned_files.find(({ root }) => root === 'support').path += '.renamed';
      },
    },
    {
      name: 'mode',
      code: 'INVALID_MANIFEST',
      mutate: async ({ manifest }) => {
        manifest.owned_files.find(({ root }) => root === 'support').mode = '0600';
      },
    },
    {
      name: 'digest',
      code: 'INVALID_MANIFEST',
      mutate: async ({ manifest }) => {
        manifest.owned_files.find(({ root }) => root === 'support').digest = `sha256:${'0'.repeat(64)}`;
      },
    },
    {
      name: 'operation-attribution',
      code: 'INVALID_MANIFEST',
      mutate: async ({ manifest }) => {
        const file = manifest.owned_files.find(({ operation }) => operation === 'baton-plan');
        file.operation = 'baton-merge';
      },
    },
    {
      name: 'created-directory',
      code: 'INVALID_MANIFEST',
      mutate: async ({ manifest }) => {
        manifest.created_directories.push({ root: 'support', path: 'foreign' });
      },
    },
    {
      name: 'unknown-tuple',
      code: 'INVALID_MANIFEST',
      mutate: async ({ manifest }) => {
        manifest.package_version = '9.9.9-unknown';
      },
    },
    {
      name: 'missing-entry',
      code: 'INVALID_MANIFEST',
      mutate: async ({ manifest }) => {
        manifest.owned_files.pop();
      },
    },
    {
      name: 'extra-entry',
      code: 'INVALID_MANIFEST',
      mutate: async ({ manifest }) => {
        const launcher = manifest.owned_files.find(({ root }) => root === 'launcher');
        manifest.owned_files.push({ ...launcher, path: `${launcher.path}.extra` });
      },
    },
  ];
  for (const scenario of cases) {
    const fixture = await temporaryFixture(t, `baton-upgrade-reject-${scenario.name}-`);
    const repository = initializeRepository(join(fixture.home, 'project'));
    const env = environment(fixture.home);
    const installed = await installHistoricalPackage({
      version: '1.0.0-rc.3',
      host: 'codex',
      scope: 'project',
      home: fixture.home,
      repository,
    });
    const manifest = structuredClone(installed.manifest);
    await scenario.mutate({ manifest, target: installed.target });
    if (scenario.name !== 'owned-byte') {
      await writeFile(
        join(installed.target.supportRoot, 'install-manifest.json'),
        stableJSON(manifest),
      );
    }
    const before = await snapshot(fixture.home);
    await rejectCode(
      runInstaller(
        argumentsFor('codex', 'project', repository, ['--yes']),
        { env, cwd: repository, isTTY: false },
      ),
      scenario.code,
    );
    assert.deepEqual(await snapshot(fixture.home), before, scenario.name);
  }
});

test('the current generated package is verified before its identity is trusted', async (t) => {
  const identity = await syntheticLegacyBundle(t);
  const adapter = join(
    identity.bundle,
    'adapters',
    'generated',
    'codex',
    'skills',
    'baton-plan',
    'SKILL.md',
  );
  await writeFile(adapter, Buffer.from('altered generated adapter\n'));
  const fixture = await temporaryFixture(t, 'baton-generated-identity-');
  const before = await snapshot(fixture.home);
  await rejectCode(
    runInstaller(['--host', 'codex', '--user', '--yes'], {
      env: environment(fixture.home),
      cwd: fixture.home,
      isTTY: false,
      bundleRoot: identity.bundle,
    }),
    'PACKAGE_MISMATCH',
  );
  assert.deepEqual(await snapshot(fixture.home), before);
});

test('the current install manifest cannot widen its owned topology', async (t) => {
  const fixture = await temporaryFixture(t, 'baton-current-topology-');
  const env = environment(fixture.home);
  const target = targets('codex', 'user', fixture.home);
  const arguments_ = ['--host', 'codex', '--user', '--yes'];
  await runInstaller(arguments_, {
    env,
    cwd: fixture.home,
    isTTY: false,
  });
  const manifestPath = join(target.supportRoot, 'install-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.owned_files.find(({ root }) => root === 'launcher').path = 'baton-plan/RENAMED.md';
  await writeFile(manifestPath, stableJSON(manifest));
  const before = await snapshot(fixture.home);
  await rejectCode(
    runInstaller(arguments_, {
      env,
      cwd: fixture.home,
      isTTY: false,
    }),
    'INVALID_MANIFEST',
  );
  assert.deepEqual(await snapshot(fixture.home), before);
});

test('documented rollback examples include a valid selector', async () => {
  const install = await readFile(join(ROOT, 'INSTALL.md'), 'utf8');
  for (const host of ['claude', 'codex']) {
    for (const confirmation of ['--dry-run', '--yes']) {
      const command = `./install-${host}.sh --user --rollback latest ${confirmation}`;
      assert.match(install, new RegExp(command.replaceAll('.', '\\.')));
      const parsed = parseArguments([
        '--host',
        host,
        '--user',
        '--rollback',
        'latest',
        confirmation,
      ]);
      assert.equal(parsed.operation, 'rollback');
      assert.equal(parsed.rollback, 'latest');
    }
  }
});

test('installed board and receipt/state/action runtime is host-identical and executable', async (t) => {
  const fixture = await temporaryFixture(t, 'baton-installed-runtime-');
  const release = baselineFixture();
  t.after(() => release.cleanup());
  const env = environment(fixture.home);
  const manifests = new Map();
  const installedTargets = new Map();

  for (const host of ['claude', 'codex']) {
    await runInstaller(argumentsFor(host, 'project', release.repo, ['--yes']), {
      env,
      cwd: release.repo,
      isTTY: false,
    });
    const target = targets(host, 'project', fixture.home, release.repo);
    installedTargets.set(host, target);
    manifests.set(host, await assertInstalled(target, host, 'project'));
  }

  assert.equal(
    manifests.get('claude').package_digest,
    manifests.get('codex').package_digest,
  );
  assert.deepEqual(
    manifests.get('claude').owned_files.filter(({ root }) => root === 'support'),
    manifests.get('codex').owned_files.filter(({ root }) => root === 'support'),
  );

  for (const path of PORTABLE_RUNTIME_FILES) {
    const source = await readFile(join(ROOT, path));
    for (const host of ['claude', 'codex']) {
      const target = installedTargets.get(host);
      assert.deepEqual(await readFile(join(target.supportRoot, path)), source, `${host}:${path}`);
      const owned = manifests.get(host).owned_files.find((entry) => (
        entry.root === 'support' && entry.path === path
      ));
      assert.equal(owned?.mode, '0644', `${host}:${path}`);
      assert.equal(owned?.digest, sha256(source), `${host}:${path}`);
    }
  }

  const runtime = installedTargets.get('codex').supportRoot;
  const board = execFileSync(
    process.execPath,
    [join(runtime, 'reference/board/oracle.mjs'), release.repo],
    { encoding: 'utf8', env },
  );
  const projection = JSON.parse(board);
  assert.equal(projection.schema_version, 'baton.board/v1');
  assert.equal(projection.valid, true);
  assert.equal(projection.releases[0].release, 'v1.0.0');

  const terminal = execFileSync(
    process.execPath,
    [join(runtime, 'reference/board/terminal.mjs'), '--color', 'never'],
    { encoding: 'utf8', env, input: board },
  );
  assert.match(terminal, /Release v1\.0\.0/);
  assert.match(terminal, /Next operations/);

  const installedGit = await import(
    pathToFileURL(join(runtime, 'reference/records/git.mjs')).href,
  );
  const installedReceipts = await import(
    pathToFileURL(join(runtime, 'reference/records/receipts.mjs')).href,
  );
  const installedState = await import(
    pathToFileURL(join(runtime, 'reference/records/state.mjs')).href,
  );
  const installedActions = await import(
    pathToFileURL(join(runtime, 'reference/records/actions.mjs')).href,
  );
  assert.equal(
    installedReceipts.parsePlanBytes(release.parsed.bytes).metadata.release,
    release.metadata.release,
  );
  const recordPathAdmission = installedGit.resolveRecordPathAdmission(release.repo);
  const productExclusionAdmission = installedGit.resolveProductExclusionAdmission(
    release.repo,
    {
      recordPathAdmission,
      resolveBehavioralInertness: (request) => ({ ...request, decision: 'inert' }),
    },
  );
  const state = installedState.readBatonState(
    release.repo,
    release.metadata.release,
    { productExclusionAdmission },
  );
  assert.equal(state.release, release.metadata.release);
  assert.equal(state.plan.metadata.schema_version, 'baton.plan/v2');
  const actions = installedActions.createBatonActions({
    repo: release.repo,
    resolveBehavioralInertness: (request) => ({ ...request, decision: 'inert' }),
  });
  assert.deepEqual(
    Object.keys(actions),
    [
      'recordPlanRevision',
      'prepareTrackBase',
      'appendReceipt',
      'prepareAssembly',
      'mergePassedCandidate',
    ],
  );

  const web = spawn(
    process.execPath,
    [
      join(runtime, 'reference/board/web.mjs'),
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      release.repo,
    ],
    {
      cwd: release.repo,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const url = await waitForOutputLine(web);
    const response = await fetch(`${url}/api/board`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal((await response.json()).schema_version, 'baton.board/v1');
  } finally {
    if (web.exitCode === null && web.signalCode === null) {
      const exited = once(web, 'exit');
      web.kill('SIGTERM');
      await exited;
    }
  }
});

test('Claude and Codex project installs coexist and uninstall independently', async (t) => {
  const fixture = await temporaryFixture(t, 'baton-coexist-');
  const repository = initializeRepository(join(fixture.home, 'project'));
  const env = environment(fixture.home);
  for (const host of ['claude', 'codex']) {
    await runInstaller(argumentsFor(host, 'project', repository, ['--yes']), {
      env,
      cwd: repository,
      isTTY: false,
    });
  }
  const claude = targets('claude', 'project', fixture.home, repository);
  const codex = targets('codex', 'project', fixture.home, repository);
  await assertInstalled(claude, 'claude', 'project');
  await assertInstalled(codex, 'codex', 'project');

  await runInstaller(argumentsFor('claude', 'project', repository, ['--uninstall', '--yes']), {
    env,
    cwd: repository,
    isTTY: false,
  });
  await assert.rejects(lstat(claude.supportRoot), { code: 'ENOENT' });
  await assertInstalled(codex, 'codex', 'project');
});

test('project discovery is scoped to the requested path and ignores Git control environment', async (t) => {
  const fixture = await temporaryFixture(t, 'baton-project-path-');
  const repository = initializeRepository(join(fixture.home, 'project'));
  const foreign = initializeRepository(join(fixture.home, 'foreign'));
  const env = environment(fixture.home, {
    GIT_DIR: join(foreign, '.git'),
    GIT_WORK_TREE: foreign,
    GIT_INDEX_FILE: join(foreign, '.git', 'index'),
  });
  await runInstaller(['--host', 'codex', '--project', 'project', '--yes'], {
    env,
    cwd: fixture.home,
    isTTY: false,
  });
  await assertInstalled(
    targets('codex', 'project', fixture.home, repository),
    'codex',
    'project',
  );
  await assert.rejects(lstat(join(foreign, '.codex', 'baton')), { code: 'ENOENT' });
});

test('confirmation, collision, modified ownership, and path hazards fail before mutation', async (t) => {
  const confirmation = await temporaryFixture(t, 'baton-confirm-');
  const confirmationEnv = environment(confirmation.home);
  await rejectCode(
    runInstaller(['--host', 'claude', '--user'], {
      env: confirmationEnv,
      cwd: confirmation.home,
      isTTY: false,
    }),
    'CONFIRMATION_REQUIRED',
  );
  const interactiveBefore = await snapshot(confirmation.home);
  await rejectCode(
    runInstaller(['--host', 'claude', '--user'], {
      env: confirmationEnv,
      cwd: confirmation.home,
      isTTY: true,
      confirm: async () => false,
    }),
    'CONFIRMATION_DECLINED',
  );
  assert.deepEqual(await snapshot(confirmation.home), interactiveBefore);
  const interactive = await runInstaller(['--host', 'claude', '--user'], {
    env: confirmationEnv,
    cwd: confirmation.home,
    isTTY: true,
    confirm: async () => true,
  });
  assert.equal(interactive.actions.length, 7);

  const collision = await temporaryFixture(t, 'baton-collision-');
  const collisionTarget = targets('claude', 'user', collision.home);
  await writeMode(
    join(collisionTarget.launcherRoot, 'baton-plan', 'SKILL.md'),
    Buffer.from('foreign\n'),
    0o644,
  );
  const collisionBefore = await snapshot(collision.home);
  await rejectCode(
    runInstaller(['--host', 'claude', '--user', '--yes'], {
      env: environment(collision.home),
      cwd: collision.home,
      isTTY: false,
    }),
    'UNOWNED_COLLISION',
  );
  assert.deepEqual(await snapshot(collision.home), collisionBefore);

  const nestedCollision = await temporaryFixture(t, 'baton-nested-collision-');
  const nestedTarget = targets('codex', 'user', nestedCollision.home);
  await writeMode(
    join(nestedTarget.launcherRoot, 'baton-plan', 'notes.txt'),
    Buffer.from('foreign content\n'),
    0o644,
  );
  const nestedBefore = await snapshot(nestedCollision.home);
  await rejectCode(
    runInstaller(['--host', 'codex', '--user', '--yes'], {
      env: environment(nestedCollision.home),
      cwd: nestedCollision.home,
      isTTY: false,
    }),
    'UNOWNED_COLLISION',
  );
  assert.deepEqual(await snapshot(nestedCollision.home), nestedBefore);

  const modified = await temporaryFixture(t, 'baton-modified-');
  const modifiedTarget = targets('codex', 'user', modified.home);
  const modifiedOptions = {
    env: environment(modified.home),
    cwd: modified.home,
    isTTY: false,
  };
  await runInstaller(['--host', 'codex', '--user', '--yes'], modifiedOptions);
  await writeFile(
    join(modifiedTarget.launcherRoot, 'baton-plan', 'SKILL.md'),
    'locally modified\n',
  );
  const modifiedBefore = await snapshot(modified.home);
  await rejectCode(
    runInstaller(['--host', 'codex', '--user', '--uninstall', '--yes'], modifiedOptions),
    'MODIFIED_OWNED_FILE',
  );
  assert.deepEqual(await snapshot(modified.home), modifiedBefore);

  const linked = await temporaryFixture(t, 'baton-symlink-');
  const outside = join(linked.root, 'outside');
  await mkdir(join(linked.home, '.claude'), { recursive: true });
  await mkdir(outside);
  await symlink(outside, join(linked.home, '.claude', 'skills'));
  const linkedBefore = await snapshot(linked.home);
  await rejectCode(
    runInstaller(['--host', 'claude', '--user', '--yes'], {
      env: environment(linked.home),
      cwd: linked.home,
      isTTY: false,
    }),
    'SYMLINK_COMPONENT',
  );
  assert.deepEqual(await snapshot(linked.home), linkedBefore);

  const unsafe = await temporaryFixture(t, 'baton-unsafe-');
  await rejectCode(
    runInstaller(['--host', 'claude', '--user', '--yes'], {
      env: environment(unsafe.home, { CLAUDE_CONFIG_DIR: unsafe.home }),
      cwd: unsafe.home,
      isTTY: false,
    }),
    'UNSAFE_ROOT',
  );
  await rejectCode(
    runInstaller(['--host', 'codex', '--user', '--yes'], {
      env: environment(unsafe.home, { CODEX_HOME: '/' }),
      cwd: unsafe.home,
      isTTY: false,
    }),
    'UNSAFE_ROOT',
  );
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    await rejectCode(
      runInstaller(['--host', 'claude', '--user', '--yes'], {
        env: environment(unsafe.home, {
          CLAUDE_CONFIG_DIR: join('/tmp', `baton-owner-${process.pid}`),
        }),
        cwd: unsafe.home,
        isTTY: false,
      }),
      'UNSAFE_OWNERSHIP',
    );
  }
});

test('an unrelated short Claude instruction file is preserved on a clean install', async (t) => {
  const fixture = await temporaryFixture(t, 'baton-short-claude-');
  const instructionPath = join(fixture.home, '.claude', 'CLAUDE.md');
  await writeMode(instructionPath, Buffer.from('# Personal instructions\n'), 0o664);
  const before = await snapshot(instructionPath);

  await runInstaller(['--host', 'claude', '--user', '--yes'], {
    env: environment(fixture.home),
    cwd: fixture.home,
    isTTY: false,
  });

  assert.deepEqual(await snapshot(instructionPath), before);
  await assertInstalled(targets('claude', 'user', fixture.home), 'claude', 'user');
});

test('exact legacy migration preserves unrelated files and rollback restores exact bytes', async (t) => {
  const identity = await syntheticLegacyBundle(t);
  const fixture = await temporaryFixture(t, 'baton-legacy-');
  const { config, prefix } = await installSyntheticLegacy(fixture.home, identity);
  const originalPackage = await snapshot(join(config, 'baton'));
  const originalCommands = await snapshot(join(config, 'commands'));
  const originalInstructions = await snapshot(join(config, 'CLAUDE.md'));

  const result = await runInstaller(['--host', 'claude', '--user', '--yes'], {
    env: environment(fixture.home),
    cwd: fixture.home,
    isTTY: false,
    bundleRoot: identity.bundle,
  });
  assert.equal(result.migratedLegacy, true);
  assert.equal(await readFile(join(config, 'CLAUDE.md'), 'utf8'), prefix.toString('utf8'));
  assert.equal(await readFile(join(config, 'commands', 'pr.md'), 'utf8'), 'unrelated pr command\n');
  assert.equal(
    await readFile(join(config, 'commands', 'review-tldr.md'), 'utf8'),
    'unrelated review command\n',
  );
  await assert.rejects(lstat(join(config, 'commands', 'mark-shipped.md')), { code: 'ENOENT' });
  const target = targets('claude', 'user', fixture.home);
  await assertInstalled(target, 'claude', 'user');

  const rollback = await runInstaller(
    ['--host', 'claude', '--user', '--rollback', result.transactionId, '--yes'],
    {
      env: environment(fixture.home),
      cwd: fixture.home,
      isTTY: false,
      bundleRoot: identity.bundle,
    },
  );
  assert.equal(rollback.rolledBack, result.transactionId);
  assert.deepEqual(await snapshot(join(config, 'baton')), originalPackage);
  assert.deepEqual(await snapshot(join(config, 'commands')), originalCommands);
  assert.deepEqual(await snapshot(join(config, 'CLAUDE.md')), originalInstructions);
  await assert.rejects(lstat(join(config, 'skills')), { code: 'ENOENT' });
});

test('one-byte legacy command or block changes fail with zero mutation', async (t) => {
  const identity = await syntheticLegacyBundle(t);
  for (const kind of ['command', 'block']) {
    const fixture = await temporaryFixture(t, `baton-legacy-${kind}-`);
    const { config } = await installSyntheticLegacy(fixture.home, identity);
    if (kind === 'command') {
      const command = join(config, 'commands', 'plan-release.md');
      const bytes = await readFile(command);
      bytes[0] ^= 1;
      await writeFile(command, bytes);
      await chmod(command, 0o664);
    } else {
      const instructions = join(config, 'CLAUDE.md');
      const bytes = await readFile(instructions);
      bytes[bytes.length - 2] ^= 1;
      await writeFile(instructions, bytes);
      await chmod(instructions, 0o664);
    }
    const before = await snapshot(config);
    await rejectCode(
      runInstaller(['--host', 'claude', '--user', '--yes'], {
        env: environment(fixture.home),
        cwd: fixture.home,
        isTTY: false,
        bundleRoot: identity.bundle,
      }),
      'LEGACY_FINGERPRINT_MISMATCH',
    );
    assert.deepEqual(await snapshot(config), before);
  }
});

test('injected interruption at every clean-install boundary recovers before retry', async (t) => {
  const boundaries = [
    'prepared',
    'support-replaced',
    'launcher-1',
    'launcher-2',
    'launcher-3',
    'launcher-4',
    'launcher-5',
    'manifest-written',
  ];
  for (const boundary of boundaries) {
    const fixture = await temporaryFixture(t, `baton-interrupt-${boundary}-`);
    const options = {
      env: environment(fixture.home),
      cwd: fixture.home,
      isTTY: false,
    };
    await assert.rejects(
      runInstaller(['--host', 'codex', '--user', '--yes'], {
        ...options,
        checkpoint: interruptedAt(boundary),
      }),
      new RegExp(boundary),
    );
    const recovered = await runInstaller(['--host', 'codex', '--user', '--yes'], options);
    assert.equal(recovered.recovered.length, 1, boundary);
    await assertInstalled(targets('codex', 'user', fixture.home), 'codex', 'user');
  }
});

test('injected interruption at every legacy-only boundary restores before retry', async (t) => {
  const identity = await syntheticLegacyBundle(t);
  const boundaries = [
    'legacy-command-1',
    'legacy-command-2',
    'legacy-command-3',
    'legacy-command-4',
    'legacy-command-5',
    'legacy-command-6',
    'legacy-command-7',
    'legacy-command-8',
    'instruction-cas',
  ];
  for (const boundary of boundaries) {
    const fixture = await temporaryFixture(t, `baton-legacy-interrupt-${boundary}-`);
    await installSyntheticLegacy(fixture.home, identity);
    const options = {
      env: environment(fixture.home),
      cwd: fixture.home,
      isTTY: false,
      bundleRoot: identity.bundle,
    };
    await assert.rejects(
      runInstaller(['--host', 'claude', '--user', '--yes'], {
        ...options,
        checkpoint: interruptedAt(boundary),
      }),
      new RegExp(boundary),
    );
    const recovered = await runInstaller(['--host', 'claude', '--user', '--yes'], options);
    assert.equal(recovered.recovered.length, 1, boundary);
    assert.equal(recovered.migratedLegacy, true);
    await assertInstalled(targets('claude', 'user', fixture.home), 'claude', 'user');
  }
});

test('rollback and uninstall refuse modified or unowned managed content', async (t) => {
  const fixture = await temporaryFixture(t, 'baton-rollback-guard-');
  const options = {
    env: environment(fixture.home),
    cwd: fixture.home,
    isTTY: false,
  };
  const installed = await runInstaller(['--host', 'claude', '--user', '--yes'], options);
  const target = targets('claude', 'user', fixture.home);
  await writeFile(join(target.supportRoot, 'foreign.txt'), 'foreign\n');
  const before = await snapshot(fixture.home);
  await rejectCode(
    runInstaller(
      ['--host', 'claude', '--user', '--rollback', installed.transactionId, '--yes'],
      options,
    ),
    'UNOWNED_COLLISION',
  );
  assert.deepEqual(await snapshot(fixture.home), before);
});

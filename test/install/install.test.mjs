import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

import { runInstaller } from '../../scripts/install.mjs';
import { sha256 } from '../../scripts/lib/digest.mjs';
import {
  assertInstalled,
  environment,
  initializeRepository,
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

async function transactionCount(stateRoot) {
  try {
    return (await readdir(join(stateRoot, 'transactions'))).length;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
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
      assert.equal(manifest.owned_files.length, 26);
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

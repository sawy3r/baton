import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { writeGenerated } from '../../scripts/generate-skills.mjs';
import {
  manageSkills,
  PayloadError,
} from '../../scripts/manage-skills.mjs';
import { sha256 } from '../../scripts/lib/digest.mjs';
import { OPERATIONS } from '../../scripts/lib/payload.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

async function fixture(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const skills = join(root, 'skills');
  await mkdir(skills);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, skills };
}

async function snapshot(root) {
  const records = [];
  async function walk(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absolute = join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isDirectory()) {
        records.push(`directory ${path}`);
        await walk(absolute, path);
      } else if (info.isFile()) {
        records.push(
          `file ${path} 0${(info.mode & 0o777).toString(8).padStart(3, '0')} `
          + sha256(await readFile(absolute)),
        );
      } else if (info.isSymbolicLink()) {
        records.push(`symlink ${path}`);
      } else {
        records.push(`other ${path}`);
      }
    }
  }
  await walk(root, '');
  return records;
}

async function rejectCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof PayloadError && error.code === code,
  );
}

async function applyApproved(options) {
  await manageSkills({
    ...options,
    apply: false,
  });
  return manageSkills({
    ...options,
    apply: true,
  });
}

function interruptedAt(boundary) {
  return async (observed) => {
    if (observed === boundary) throw new Error(`interrupted at ${boundary}`);
  };
}

async function assertExactInstall(skills) {
  for (const operation of OPERATIONS) {
    const source = await readFile(join(ROOT, 'skills', operation.name, 'SKILL.md'));
    assert.deepEqual(
      await readFile(join(skills, operation.name, 'SKILL.md')),
      source,
      operation.name,
    );
  }
  assert.deepEqual(
    await readFile(join(skills, 'baton-plan', 'templates', 'plan.md')),
    await readFile(join(ROOT, 'templates', 'plan.md')),
  );
}

test('clean install, exact no-op, and removal preserve unrelated skills', async (t) => {
  const current = await fixture(t, 'baton-manage-clean-');
  const foreign = join(current.skills, 'foreign-skill', 'SKILL.md');
  await mkdir(dirname(foreign));
  await writeFile(foreign, 'foreign\n');
  const beforePreview = await snapshot(current.skills);
  const preview = await manageSkills({
    operation: 'install',
    skillsDirectory: current.skills,
  });
  assert.equal(preview.dryRun, true);
  assert.deepEqual(preview.changed, OPERATIONS.map(({ name }) => name));
  assert.deepEqual(await snapshot(current.skills), beforePreview);
  const installed = await manageSkills({
    operation: 'install',
    skillsDirectory: current.skills,
    apply: true,
  });
  assert.equal(installed.release, 'v1.0.0-rc.9');
  assert.deepEqual(installed.changed, OPERATIONS.map(({ name }) => name));
  await assertExactInstall(current.skills);
  const beforeNoOp = await snapshot(current.skills);
  const noOpPreview = await manageSkills({
    operation: 'install',
    skillsDirectory: current.skills,
  });
  assert.equal(noOpPreview.dryRun, true);
  const noOp = await manageSkills({
    operation: 'install',
    skillsDirectory: current.skills,
    apply: true,
  });
  assert.equal(noOp.noOp, true);
  assert.deepEqual(await snapshot(current.skills), beforeNoOp);

  const removePreview = await manageSkills({
    operation: 'remove',
    skillsDirectory: current.skills,
  });
  assert.equal(removePreview.dryRun, true);
  assert.deepEqual(removePreview.changed, OPERATIONS.map(({ name }) => name));
  assert.deepEqual(await snapshot(current.skills), beforeNoOp);
  const removed = await manageSkills({
    operation: 'remove',
    skillsDirectory: current.skills,
    apply: true,
  });
  assert.deepEqual(removed.changed, OPERATIONS.map(({ name }) => name));
  assert.equal(await readFile(foreign, 'utf8'), 'foreign\n');
  for (const { name } of OPERATIONS) {
    await assert.rejects(lstat(join(current.skills, name)), { code: 'ENOENT' });
  }
  assert.equal((await applyApproved({
    operation: 'remove',
    skillsDirectory: current.skills,
  })).noOp, true);
});

test('apply immediately revalidates source and destination before effects', async (t) => {
  const current = await fixture(t, 'baton-manage-revalidate-');
  const mutableBundle = join(current.root, 'mutable-bundle');
  await mkdir(join(mutableBundle, 'templates'), { recursive: true });
  await cp(join(ROOT, 'operations'), join(mutableBundle, 'operations'), { recursive: true });
  await cp(join(ROOT, 'templates', 'plan.md'), join(mutableBundle, 'templates', 'plan.md'));
  await writeFile(join(mutableBundle, 'VERSION'), '1.0.0-rc.9.preview\n');
  await writeGenerated({
    bundleRoot: mutableBundle,
    outputRoot: join(mutableBundle, 'skills'),
  });
  const preview = await manageSkills({
    operation: 'install',
    skillsDirectory: current.skills,
    bundleRoot: mutableBundle,
  });
  assert.equal(preview.intendedChanges.length, 6);
  const empty = await snapshot(current.skills);

  await writeFile(
    join(mutableBundle, 'operations', 'baton-plan.md'),
    'source changed after preview\n',
  );
  await rejectCode(
    manageSkills({
      operation: 'install',
      skillsDirectory: current.skills,
      bundleRoot: mutableBundle,
      apply: true,
    }),
    'SOURCE_MISMATCH',
  );
  assert.deepEqual(await snapshot(current.skills), empty);

  await cp(
    join(ROOT, 'operations', 'baton-plan.md'),
    join(mutableBundle, 'operations', 'baton-plan.md'),
  );
  await writeGenerated({
    bundleRoot: mutableBundle,
    outputRoot: join(mutableBundle, 'skills'),
  });
  const modified = join(current.skills, 'baton-plan', 'SKILL.md');
  await mkdir(dirname(modified));
  await writeFile(modified, 'destination changed after preview\n');
  const changedDestination = await snapshot(current.skills);
  await rejectCode(
    manageSkills({
      operation: 'install',
      skillsDirectory: current.skills,
      bundleRoot: mutableBundle,
      apply: true,
    }),
    'MODIFIED_PAYLOAD',
  );
  assert.deepEqual(await snapshot(current.skills), changedDestination);
});

test('CLI preview is complete, copyable, no-write, and labels no-op as preview', async (t) => {
  const current = await fixture(t, 'baton-manage-cli-');
  const script = join(ROOT, 'scripts', 'manage-skills.mjs');
  const before = await snapshot(current.skills);
  const { stdout } = await execFileAsync(process.execPath, [
    script,
    'install',
    current.skills,
  ]);
  assert.match(stdout, /^PREVIEW install\n/);
  assert.match(stdout, new RegExp(`source checkout: ${ROOT.replaceAll('.', '\\.')}`));
  assert.match(stdout, /payload digest: sha256:[0-9a-f]{64}/);
  assert.match(stdout, new RegExp(`destination: ${current.skills}`));
  assert.match(stdout, /baton-plan: absent/);
  assert.match(stdout, /existing Baton files:\n  \(none\)/);
  assert.match(stdout, new RegExp(`add ${join(current.skills, 'baton-plan', 'SKILL.md')}`));
  assert.deepEqual(await snapshot(current.skills), before);
  await execFileAsync(process.execPath, [
    script,
    'install',
    current.skills,
    '--apply',
  ]);
  await assertExactInstall(current.skills);
  const { stdout: noOp } = await execFileAsync(process.execPath, [
    script,
    'install',
    current.skills,
  ]);
  assert.match(noOp, /^PREVIEW install\n/);
  assert.match(noOp, /baton-plan\/SKILL\.md sha256:/);
  assert.match(noOp, /intended file changes:\n  \(none\)/);
});

test('update removes the exact old payload before installing the new one', async (t) => {
  const current = await fixture(t, 'baton-manage-update-');
  const oldBundle = join(current.root, 'old-bundle');
  await mkdir(join(oldBundle, 'templates'), { recursive: true });
  await cp(join(ROOT, 'operations'), join(oldBundle, 'operations'), { recursive: true });
  await cp(join(ROOT, 'templates', 'plan.md'), join(oldBundle, 'templates', 'plan.md'));
  await writeFile(join(oldBundle, 'VERSION'), '1.0.0-rc.9-old\n');
  await writeGenerated({
    bundleRoot: oldBundle,
    outputRoot: join(oldBundle, 'skills'),
  });

  await applyApproved({
    operation: 'install',
    skillsDirectory: current.skills,
    bundleRoot: oldBundle,
  });
  const oldSnapshot = await snapshot(current.skills);
  await rejectCode(
    manageSkills({
      operation: 'install',
      skillsDirectory: current.skills,
    }),
    'MODIFIED_PAYLOAD',
  );
  assert.deepEqual(await snapshot(current.skills), oldSnapshot);

  await applyApproved({
    operation: 'remove',
    skillsDirectory: current.skills,
    bundleRoot: oldBundle,
  });
  await applyApproved({
    operation: 'install',
    skillsDirectory: current.skills,
  });
  await assertExactInstall(current.skills);
});

test('modified, added, legacy, and mixed partial payloads refuse every mutation', async (t) => {
  for (const kind of ['modified', 'added', 'legacy', 'mixed']) {
    const current = await fixture(t, `baton-manage-refuse-${kind}-`);
    if (kind === 'legacy') {
      const skill = join(current.skills, 'baton-plan', 'SKILL.md');
      await mkdir(dirname(skill));
      await writeFile(
        skill,
        '<!-- baton-adapter\npackage-version: 1.0.0-rc.8\n-->\nlegacy\n',
      );
    } else {
      await applyApproved({
        operation: 'install',
        skillsDirectory: current.skills,
      });
      if (kind === 'modified') {
        await writeFile(join(current.skills, 'baton-plan', 'SKILL.md'), 'modified\n');
      } else if (kind === 'added') {
        await writeFile(join(current.skills, 'baton-plan', 'notes.txt'), 'added\n');
      } else {
        await rm(join(current.skills, 'baton-plan'), { recursive: true });
        await writeFile(join(current.skills, 'baton-verify', 'SKILL.md'), 'modified\n');
      }
    }
    const before = await snapshot(current.skills);
    for (const operation of ['install', 'remove']) {
      await rejectCode(
        manageSkills({
          operation,
          skillsDirectory: current.skills,
        }),
        'MODIFIED_PAYLOAD',
      );
      assert.deepEqual(await snapshot(current.skills), before, `${kind}:${operation}`);
    }
  }
});

test('interrupted staging, installation, and removal resume safely', async (t) => {
  const names = OPERATIONS.map(({ name }) => name);
  for (const boundary of [
    'install-stage-created',
    'install-stage-marked',
    ...names.map((name) => `staged:${name}`),
    ...names.map((name) => `installed:${name}`),
    'install-stage-unmarked',
  ]) {
    const current = await fixture(t, `baton-manage-${boundary.replace(':', '-')}-`);
    await assert.rejects(
      applyApproved({
        operation: 'install',
        skillsDirectory: current.skills,
        checkpoint: interruptedAt(boundary),
      }),
      new RegExp(boundary),
    );
    const stage = (await readdir(current.skills))
      .find((entry) => entry.startsWith('.baton-install-stage-'));
    assert.ok(stage, boundary);
    assert.equal(dirname(join(current.skills, stage)), current.skills);
    await applyApproved({
      operation: 'install',
      skillsDirectory: current.skills,
    });
    await assertExactInstall(current.skills);
    assert.equal(
      (await readdir(current.skills))
        .some((entry) => entry.startsWith('.baton-install-stage-')),
      false,
    );
  }

  for (const boundary of [
    'remove-stage-created',
    'remove-stage-marked',
    ...names.map((name) => `removal-staged:${name}`),
    ...names.map((name) => `removed:${name}`),
    'remove-stage-unmarked',
  ]) {
    const current = await fixture(t, `baton-manage-${boundary.replace(':', '-')}-`);
    await applyApproved({
      operation: 'install',
      skillsDirectory: current.skills,
    });
    await assert.rejects(
      applyApproved({
        operation: 'remove',
        skillsDirectory: current.skills,
        checkpoint: interruptedAt(boundary),
      }),
      new RegExp(boundary),
    );
    await applyApproved({
      operation: 'remove',
      skillsDirectory: current.skills,
    });
    for (const operation of OPERATIONS) {
      await assert.rejects(lstat(join(current.skills, operation.name)), { code: 'ENOENT' });
    }
  }
});

test('interrupted-removal preview names the actual quarantined files', async (t) => {
  const current = await fixture(t, 'baton-manage-remove-preview-');
  await applyApproved({
    operation: 'install',
    skillsDirectory: current.skills,
  });
  await assert.rejects(
    applyApproved({
      operation: 'remove',
      skillsDirectory: current.skills,
      checkpoint: interruptedAt('removal-staged:baton-plan'),
    }),
    /removal-staged:baton-plan/,
  );
  const stage = (await readdir(current.skills))
    .find((entry) => entry.startsWith('.baton-remove-stage-'));
  const quarantined = join(current.skills, stage, 'baton-plan', 'SKILL.md');
  const nonexistentTarget = join(current.skills, 'baton-plan', 'SKILL.md');
  const before = await snapshot(current.skills);
  const { stdout } = await execFileAsync(process.execPath, [
    join(ROOT, 'scripts', 'manage-skills.mjs'),
    'remove',
    current.skills,
  ]);
  assert.ok(stdout.includes(`  ${quarantined} sha256:`));
  assert.ok(stdout.includes(`  remove ${quarantined} sha256:`));
  assert.equal(stdout.includes(`  remove ${nonexistentTarget} sha256:`), false);
  assert.ok(stdout.includes(
    `  remove ${join(current.skills, 'baton-implement', 'SKILL.md')} sha256:`,
  ));
  assert.deepEqual(await snapshot(current.skills), before);
  await applyApproved({
    operation: 'remove',
    skillsDirectory: current.skills,
  });
});

test('partial internal writes and removals resume without deleting additions', async (t) => {
  const partialCopy = await fixture(t, 'baton-manage-partial-copy-');
  await assert.rejects(
    applyApproved({
      operation: 'install',
      skillsDirectory: partialCopy.skills,
      checkpoint: interruptedAt('install-stage-marked'),
    }),
    /install-stage-marked/,
  );
  const installStage = (await readdir(partialCopy.skills))
    .find((entry) => entry.startsWith('.baton-install-stage-'));
  const copyRoot = join(partialCopy.skills, installStage, '.copy-baton-plan');
  await mkdir(copyRoot);
  const partialFile = `.baton-write-${
    sha256(Buffer.from('SKILL.md')).slice('sha256:'.length)
  }`;
  await writeFile(join(copyRoot, partialFile), 'partial');
  await applyApproved({
    operation: 'install',
    skillsDirectory: partialCopy.skills,
  });
  await assertExactInstall(partialCopy.skills);

  const addedCopy = await fixture(t, 'baton-manage-added-copy-');
  await assert.rejects(
    applyApproved({
      operation: 'install',
      skillsDirectory: addedCopy.skills,
      checkpoint: interruptedAt('install-stage-marked'),
    }),
    /install-stage-marked/,
  );
  const addedStage = (await readdir(addedCopy.skills))
    .find((entry) => entry.startsWith('.baton-install-stage-'));
  const addedRoot = join(addedCopy.skills, addedStage, '.copy-baton-plan');
  await mkdir(addedRoot);
  await writeFile(join(addedRoot, 'foreign.txt'), 'preserve\n');
  const beforeRefusal = await snapshot(addedCopy.skills);
  await rejectCode(
    manageSkills({
      operation: 'install',
      skillsDirectory: addedCopy.skills,
    }),
    'AMBIGUOUS_STAGE',
  );
  assert.deepEqual(await snapshot(addedCopy.skills), beforeRefusal);

  for (const kind of ['file', 'directory']) {
    const partialRemoval = await fixture(t, `baton-manage-partial-remove-${kind}-`);
    await applyApproved({
      operation: 'install',
      skillsDirectory: partialRemoval.skills,
    });
    await assert.rejects(
      applyApproved({
        operation: 'remove',
        skillsDirectory: partialRemoval.skills,
        checkpoint: interruptedAt('removal-staged:baton-plan'),
      }),
      /removal-staged:baton-plan/,
    );
    const removalStage = (await readdir(partialRemoval.skills))
      .find((entry) => entry.startsWith('.baton-remove-stage-'));
    if (kind === 'file') {
      await rm(join(partialRemoval.skills, removalStage, 'baton-plan', 'SKILL.md'));
    } else {
      await rm(
        join(partialRemoval.skills, removalStage, 'baton-plan', 'templates'),
        { recursive: true },
      );
    }
    await applyApproved({
      operation: 'remove',
      skillsDirectory: partialRemoval.skills,
    });
    for (const { name } of OPERATIONS) {
      await assert.rejects(
        lstat(join(partialRemoval.skills, name)),
        { code: 'ENOENT' },
      );
    }
  }
});

test('removal quarantines atomically and preserves content added after preflight', async (t) => {
  const current = await fixture(t, 'baton-manage-remove-race-');
  await applyApproved({
    operation: 'install',
    skillsDirectory: current.skills,
  });
  await rejectCode(
    applyApproved({
      operation: 'remove',
      skillsDirectory: current.skills,
      checkpoint: async (boundary) => {
        if (boundary !== 'removal-staged:baton-plan') return;
        const stage = (await readdir(current.skills))
          .find((entry) => entry.startsWith('.baton-remove-stage-'));
        await writeFile(join(current.skills, stage, 'baton-plan', 'added.txt'), 'added\n');
      },
    }),
    'CHANGED_DURING_REMOVE',
  );
  const stage = (await readdir(current.skills))
    .find((entry) => entry.startsWith('.baton-remove-stage-'));
  assert.equal(
    await readFile(join(current.skills, stage, 'baton-plan', 'added.txt'), 'utf8'),
    'added\n',
  );
});

test('a stage from another payload stops before any destination mutation', async (t) => {
  const current = await fixture(t, 'baton-manage-unknown-stage-');
  const unknown = join(current.skills, '.baton-install-stage-unknown-payload');
  await mkdir(unknown);
  await writeFile(join(unknown, 'evidence.txt'), 'unknown\n');
  const before = await snapshot(current.skills);
  for (const operation of ['install', 'remove']) {
    await rejectCode(
      manageSkills({
        operation,
        skillsDirectory: current.skills,
        apply: true,
      }),
      'AMBIGUOUS_STAGE',
    );
    assert.deepEqual(await snapshot(current.skills), before, operation);
  }
});

test('the helper requires one explicit real destination and contains no discovery knowledge', async (t) => {
  const current = await fixture(t, 'baton-manage-path-');
  await rejectCode(
    manageSkills({ operation: 'install', skillsDirectory: 'relative/skills' }),
    'UNSAFE_DESTINATION',
  );
  await rejectCode(
    manageSkills({
      operation: 'install',
      skillsDirectory: join(current.root, 'missing'),
    }),
    'UNSAFE_DESTINATION',
  );
  const linked = join(current.root, 'linked-skills');
  await symlink(current.skills, linked);
  await rejectCode(
    manageSkills({ operation: 'install', skillsDirectory: linked }),
    'UNSAFE_DESTINATION',
  );
  const source = await readFile(join(ROOT, 'scripts', 'manage-skills.mjs'), 'utf8');
  assert.doesNotMatch(
    source,
    /(?:\.claude|\.codex|\.agents|opencode|hermes|cline|cursor|windsurf|client selector)/i,
  );
});

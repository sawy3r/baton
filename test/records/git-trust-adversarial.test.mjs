import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  applyExactComposition,
  assertRecordOnlyTransition,
  captureHeadRefs,
  changedPathsBetween,
  commitRecordTransition,
  configureGitExecutable,
  gitExecutablePath,
  productTreeIdentity,
  readFilesAtRef,
  resolveRecordRootAdmission,
  resolveRef,
  runGit,
} from '../../reference/records/git.mjs';
import {
  commitAll,
  git,
  temporaryRepository,
  write,
} from './helpers.mjs';

function throwsCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code);
}

function divergentMergeFixture(attributes) {
  const fixture = temporaryRepository();
  write(fixture.repo, '.gitattributes', `${attributes}\n`);
  write(fixture.repo, 'conflict.txt', 'base\n');
  const base = commitAll(fixture.repo, 'merge base');
  git(fixture.repo, 'switch', '-q', '-c', 'candidate', base);
  write(fixture.repo, 'conflict.txt', 'candidate\n');
  const candidate = commitAll(fixture.repo, 'candidate');
  git(fixture.repo, 'switch', '-q', '-c', 'release', base);
  write(fixture.repo, 'conflict.txt', 'release\n');
  const expected = commitAll(fixture.repo, 'release');
  return {
    ...fixture,
    base,
    candidate,
    expected,
    targetRef: 'refs/heads/release',
  };
}

test('Git execution ignores hostile PATH and accepts only an explicit absolute override', () => {
  const fixture = temporaryRepository();
  const priorPath = process.env.PATH;
  try {
    write(fixture.repo, 'tracked.txt', 'safe\n');
    const commit = commitAll(fixture.repo, 'safe');
    const trusted = gitExecutablePath();
    assert.ok(path.isAbsolute(trusted));

    const fakeDirectory = path.join(fixture.repo, 'hostile-path');
    const sentinel = path.join(fixture.repo, 'fake-git-ran');
    write(fakeDirectory, 'git', `#!/bin/sh\n: > '${sentinel}'\nexit 99\n`);
    chmodSync(path.join(fakeDirectory, 'git'), 0o755);
    process.env.PATH = fakeDirectory;

    assert.equal(resolveRef(fixture.repo, commit), commit);
    assert.equal(existsSync(sentinel), false);
    throwsCode(() => configureGitExecutable('git'), 'INVALID_GIT_EXECUTABLE');
  } finally {
    process.env.PATH = priorPath;
    fixture.cleanup();
  }
});

test('custom merge drivers fail closed before a configured command can execute', () => {
  const fixture = divergentMergeFixture('*.txt merge=hostile');
  try {
    const sentinel = path.join(fixture.repo, 'custom-driver-ran');
    const driver = path.join(fixture.repo, 'custom-driver.sh');
    writeFileSync(
      driver,
      `#!/bin/sh\n: > '${sentinel}'\ncp "$3" "$2"\n`,
    );
    chmodSync(driver, 0o755);
    git(
      fixture.repo,
      'config',
      'merge.hostile.driver',
      `${driver} %O %A %B`,
    );

    throwsCode(
      () => applyExactComposition(fixture.repo, {
        targetRef: fixture.targetRef,
        expectedHead: fixture.expected,
        candidate: fixture.candidate,
      }),
      'UNTRUSTED_MERGE_DRIVER',
    );
    assert.equal(existsSync(sentinel), false);
    assert.equal(resolveRef(fixture.repo, fixture.targetRef), fixture.expected);
  } finally {
    fixture.cleanup();
  }
});

test('a nondeterministic external merge driver cannot influence composition', () => {
  const fixture = divergentMergeFixture('*.txt merge=randomized');
  try {
    const sentinel = path.join(fixture.repo, 'random-driver-ran');
    const driver = path.join(fixture.repo, 'random-driver.sh');
    writeFileSync(
      driver,
      `#!/bin/sh\n: > '${sentinel}'\ndate +%s%N > "$2"\n`,
    );
    chmodSync(driver, 0o755);
    git(
      fixture.repo,
      'config',
      'merge.randomized.driver',
      `${driver} %O %A %B`,
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      throwsCode(
        () => applyExactComposition(fixture.repo, {
          targetRef: fixture.targetRef,
          expectedHead: fixture.expected,
          candidate: fixture.candidate,
        }),
        'UNTRUSTED_MERGE_DRIVER',
      );
    }
    assert.equal(existsSync(sentinel), false);
  } finally {
    fixture.cleanup();
  }
});

test('safe built-in merge semantics remain deterministic in the engine context', () => {
  const fixture = divergentMergeFixture('*.txt merge=union');
  try {
    const first = applyExactComposition(fixture.repo, {
      targetRef: fixture.targetRef,
      expectedHead: fixture.expected,
      candidate: fixture.candidate,
    });
    assert.equal(first.mode, 'two-parent');
    git(fixture.repo, 'update-ref', fixture.targetRef, fixture.expected, first.result);
    const second = applyExactComposition(fixture.repo, {
      targetRef: fixture.targetRef,
      expectedHead: fixture.expected,
      candidate: fixture.candidate,
    });
    assert.equal(second.result, first.result);
  } finally {
    fixture.cleanup();
  }
});

test('changed paths are NUL-safe and expose both sides of renames plus Git object changes', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'seed.txt', 'seed\n');
    const seed = commitAll(fixture.repo, 'seed');
    write(fixture.repo, 'delete.txt', 'delete\n');
    write(fixture.repo, 'rename-old.txt', 'rename\n');
    write(fixture.repo, 'mode.txt', 'mode\n');
    commitAll(fixture.repo, 'changed-path files');
    git(fixture.repo, 'update-index', '--add', '--cacheinfo', `160000,${seed},vendor/sub`);
    git(fixture.repo, 'commit', '-q', '-m', 'changed-path base');
    const base = git(fixture.repo, 'rev-parse', 'HEAD');

    rmSync(path.join(fixture.repo, 'delete.txt'));
    git(fixture.repo, 'mv', 'rename-old.txt', 'rename-new.txt');
    chmodSync(path.join(fixture.repo, 'mode.txt'), 0o755);
    write(fixture.repo, 'add odd.txt', 'added\n');
    git(fixture.repo, 'add', '-A');
    git(fixture.repo, 'update-index', '--add', '--cacheinfo', `160000,${base},vendor/sub`);
    git(fixture.repo, 'commit', '-q', '-m', 'changed-path candidate');
    const candidate = git(fixture.repo, 'rev-parse', 'HEAD');

    assert.deepEqual(
      changedPathsBetween(fixture.repo, base, candidate),
      [
        'add odd.txt',
        'delete.txt',
        'mode.txt',
        'rename-new.txt',
        'rename-old.txt',
        'vendor/sub',
      ],
    );
  } finally {
    fixture.cleanup();
  }
});

test('product-tree exclusion requires an opaque admission for exactly the v1 root', () => {
  const fixture = temporaryRepository();
  const other = temporaryRepository();
  try {
    write(fixture.repo, '.baton/releases/keep', 'record\n');
    write(fixture.repo, 'product.txt', 'product\n');
    const commit = commitAll(fixture.repo, 'product');
    write(other.repo, '.baton/releases/keep', 'other\n');
    commitAll(other.repo, 'other');

    throwsCode(
      () => resolveRecordRootAdmission(fixture.repo, '.other/releases'),
      'RECORD_ROOT_NOT_ADMITTED',
    );
    for (const forged of [undefined, true, {}, { root: '.baton/releases' }]) {
      throwsCode(
        () => productTreeIdentity(fixture.repo, commit, forged),
        'RECORD_ROOT_ADMISSION_REQUIRED',
      );
    }
    const admission = resolveRecordRootAdmission(fixture.repo);
    assert.equal(productTreeIdentity(fixture.repo, commit, admission).entries.length, 1);
    const foreignAdmission = resolveRecordRootAdmission(other.repo);
    throwsCode(
      () => productTreeIdentity(fixture.repo, commit, foreignAdmission),
      'RECORD_ROOT_ADMISSION_MISMATCH',
    );
  } finally {
    fixture.cleanup();
    other.cleanup();
  }
});

test('record transitions cannot delete or replace the admitted root directory', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, '.baton/releases/status.json', '{"state":0}\n');
    write(fixture.repo, 'product.txt', 'product\n');
    const base = commitAll(fixture.repo, 'record base');
    git(fixture.repo, 'branch', 'record-target', base);
    const admission = resolveRecordRootAdmission(fixture.repo);

    throwsCode(
      () => commitRecordTransition(fixture.repo, {
        ref: 'refs/heads/record-target',
        expectedHead: base,
        message: 'delete root',
        admission,
        changes: { '.baton/releases': null },
      }),
      'NON_RECORD_CHANGE',
    );
    throwsCode(
      () => commitRecordTransition(fixture.repo, {
        ref: 'refs/heads/record-target',
        expectedHead: base,
        message: 'delete final root child',
        admission,
        changes: { '.baton/releases/status.json': null },
      }),
      'RECORD_ROOT_REPLACED',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/record-target'), base);

    rmSync(path.join(fixture.repo, '.baton/releases'), { recursive: true });
    const deleted = commitAll(fixture.repo, 'delete record root');
    throwsCode(
      () => assertRecordOnlyTransition(fixture.repo, base, deleted, admission),
      'RECORD_ROOT_REPLACED',
    );
  } finally {
    fixture.cleanup();
  }
});

test('record materialisation updates release and creates its owner in one ref transaction', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, '.baton/releases/status.json', '{"state":0}\n');
    const base = commitAll(fixture.repo, 'materialisation base');
    git(fixture.repo, 'branch', 'release-wt/v1.0.0', base);
    const admission = resolveRecordRootAdmission(fixture.repo);

    throwsCode(
      () => commitRecordTransition(fixture.repo, {
        ref: 'refs/heads/release-wt/v1.0.0',
        expectedHead: base,
        message: 'forged admission',
        admission: { root: '.baton/releases' },
        changes: { '.baton/releases/status.json': '{"state":1}\n' },
      }),
      'RECORD_ROOT_ADMISSION_REQUIRED',
    );

    const materialized = commitRecordTransition(fixture.repo, {
      ref: 'refs/heads/release-wt/v1.0.0',
      expectedHead: base,
      message: 'materialize owner',
      admission,
      changes: { '.baton/releases/status.json': '{"state":1}\n' },
      createRef: { ref: 'refs/heads/track/v1.0.0/T1' },
    });
    assert.equal(resolveRef(fixture.repo, 'refs/heads/release-wt/v1.0.0'), materialized);
    assert.equal(resolveRef(fixture.repo, 'refs/heads/track/v1.0.0/T1'), materialized);

    git(fixture.repo, 'branch', 'track/v1.0.0/already-exists', base);
    throwsCode(
      () => commitRecordTransition(fixture.repo, {
        ref: 'refs/heads/release-wt/v1.0.0',
        expectedHead: materialized,
        message: 'must remain atomic',
        admission,
        changes: { '.baton/releases/status.json': '{"state":2}\n' },
        createRef: { ref: 'refs/heads/track/v1.0.0/already-exists' },
      }),
      'ATOMIC_REF_UPDATE_FAILED',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/release-wt/v1.0.0'), materialized);
    assert.equal(resolveRef(fixture.repo, 'refs/heads/track/v1.0.0/already-exists'), base);
  } finally {
    fixture.cleanup();
  }
});

test('record transition allocations are bounded before any record object is written', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, '.baton/releases/status.json', '{"state":0}\n');
    const base = commitAll(fixture.repo, 'bounded record base');
    git(fixture.repo, 'branch', 'bounded-records', base);
    const admission = resolveRecordRootAdmission(fixture.repo);
    const invocation = (message, changes) => commitRecordTransition(fixture.repo, {
      ref: 'refs/heads/bounded-records',
      expectedHead: base,
      message,
      admission,
      changes,
    });

    throwsCode(
      () => invocation(
        'too many paths',
        Object.fromEntries(Array.from(
          { length: 1025 },
          (_, index) => [`.baton/releases/many/${index}`, null],
        )),
      ),
      'RECORD_CHANGE_LIMIT',
    );
    throwsCode(
      () => invocation('oversized value', {
        '.baton/releases/large': Buffer.alloc(262_145),
      }),
      'RECORD_VALUE_LIMIT',
    );
    const sharedMaximumValue = Buffer.alloc(262_144);
    throwsCode(
      () => invocation(
        'oversized aggregate',
        Object.fromEntries(Array.from(
          { length: 257 },
          (_, index) => [`.baton/releases/aggregate/${index}`, sharedMaximumValue],
        )),
      ),
      'RECORD_TOTAL_LIMIT',
    );
    throwsCode(
      () => invocation('unsupported value', {
        '.baton/releases/status.json': { state: 1 },
      }),
      'INVALID_RECORD_VALUE',
    );
    throwsCode(
      () => invocation('x'.repeat(1001), {
        '.baton/releases/status.json': '{"state":1}\n',
      }),
      'COMMIT_MESSAGE_LIMIT',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/bounded-records'), base);
  } finally {
    fixture.cleanup();
  }
});

test('every helper suppresses hostile fsmonitor and repository hook execution', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, '.baton/releases/status.json', '{"state":0}\n');
    const base = commitAll(fixture.repo, 'hostile config base');
    git(fixture.repo, 'branch', 'record-target', base);

    const hooksDirectory = path.join(fixture.repo, 'hostile-hooks');
    mkdirSync(hooksDirectory, { recursive: true });
    const hookSentinel = path.join(fixture.repo, 'hook-ran');
    for (const hook of ['reference-transaction', 'pre-commit', 'post-commit']) {
      const executable = path.join(hooksDirectory, hook);
      writeFileSync(executable, `#!/bin/sh\n: > '${hookSentinel}'\n`);
      chmodSync(executable, 0o755);
    }
    const fsmonitorSentinel = path.join(fixture.repo, 'fsmonitor-ran');
    const fsmonitor = path.join(fixture.repo, 'hostile-fsmonitor.sh');
    writeFileSync(fsmonitor, `#!/bin/sh\n: > '${fsmonitorSentinel}'\nprintf '2\\n'\n`);
    chmodSync(fsmonitor, 0o755);
    git(fixture.repo, 'config', 'core.hooksPath', hooksDirectory);
    git(fixture.repo, 'config', 'core.fsmonitor', fsmonitor);
    git(fixture.repo, 'config', 'core.fsmonitorHookVersion', '2');

    runGit(fixture.repo, ['status', '--porcelain']);
    runGit(fixture.repo, ['update-ref', 'refs/heads/helper-update', base]);
    const admission = resolveRecordRootAdmission(fixture.repo);
    const transitioned = commitRecordTransition(fixture.repo, {
      ref: 'refs/heads/record-target',
      expectedHead: base,
      message: 'hook-safe record transition',
      admission,
      changes: { '.baton/releases/status.json': '{"state":1}\n' },
    });
    assert.equal(resolveRef(fixture.repo, 'refs/heads/record-target'), transitioned);
    assert.equal(existsSync(hookSentinel), false);
    assert.equal(existsSync(fsmonitorSentinel), false);
  } finally {
    fixture.cleanup();
  }
});

test('head capture is bounded, exact, ordered, and deeply frozen', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'one.txt', 'one\n');
    const first = commitAll(fixture.repo, 'first head');
    git(fixture.repo, 'branch', 'capture/one', first);
    write(fixture.repo, 'two.txt', 'two\n');
    const second = commitAll(fixture.repo, 'second head');
    git(fixture.repo, 'branch', 'capture/two', second);

    const captured = captureHeadRefs(fixture.repo, [
      'refs/heads/capture/two',
      'refs/heads/capture/missing',
      'refs/heads/capture/one',
    ]);
    assert.deepEqual(captured, [
      { ref: 'refs/heads/capture/two', head: second },
      { ref: 'refs/heads/capture/missing', head: null },
      { ref: 'refs/heads/capture/one', head: first },
    ]);
    assert.equal(Object.isFrozen(captured), true);
    assert.equal(captured.every(Object.isFrozen), true);
    throwsCode(
      () => captureHeadRefs(
        fixture.repo,
        Array.from({ length: 129 }, (_, index) => `refs/heads/capture/${index}`),
      ),
      'INVALID_REF_BATCH',
    );
  } finally {
    fixture.cleanup();
  }
});

test('batched captured-ref reads preserve exact bytes and missing paths in frozen entries', () => {
  const fixture = temporaryRepository();
  try {
    const binary = Buffer.from([0x00, 0xff, 0x0a, 0x41]);
    write(fixture.repo, 'board/status one.json', '{"state":1}\n');
    write(fixture.repo, 'board/proof.bin', binary);
    const commit = commitAll(fixture.repo, 'batch files');

    const entries = readFilesAtRef(fixture.repo, commit, [
      'board/status one.json',
      'board/missing.json',
      'board/proof.bin',
    ]);
    assert.equal(Object.isFrozen(entries), true);
    assert.equal(entries.every(Object.isFrozen), true);
    assert.deepEqual(entries[0].bytes, Buffer.from('{"state":1}\n'));
    assert.deepEqual(entries[1], {
      path: 'board/missing.json',
      object: null,
      size: null,
      bytes: null,
    });
    assert.deepEqual(entries[2].bytes, binary);
    throwsCode(
      () => readFilesAtRef(fixture.repo, 'HEAD', ['board/proof.bin']),
      'INVALID_REF_OID',
    );
    throwsCode(
      () => readFilesAtRef(
        fixture.repo,
        commit,
        Array.from({ length: 1026 }, (_, index) => `board/${index}.json`),
      ),
      'INVALID_PATH_BATCH',
    );
  } finally {
    fixture.cleanup();
  }
});

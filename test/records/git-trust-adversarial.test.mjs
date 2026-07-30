import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  unsafeApplyExactComposition,
  assertCandidateRecordRootUnchanged,
  assertStructuralRecordOnlyTransition,
  captureHeadRefs,
  changedPathsBetween,
  unsafeCommitRecordTransition,
  unsafePrepareRecordTransition,
  configureEngineGitExecutable,
  gitExecutablePath,
  productTreeIdentity,
  readFilesAtOID,
  resolveRecordPathAdmission,
  resolveRef,
  unsafeAtomicUpdateRefs,
  unsafeRunGit,
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

function throwsCodeMessage(operation, code, pattern) {
  assert.throws(
    operation,
    (error) => error?.code === code && pattern.test(error.message),
  );
}

function optionalBytes(absolutePath) {
  return existsSync(absolutePath) ? readFileSync(absolutePath) : null;
}

function looseRefSnapshot(repo, ref) {
  const relative = ref.replace(/^refs\//, '');
  return Object.freeze({
    ref: optionalBytes(path.join(repo, '.git', 'refs', relative)),
    reflog: optionalBytes(path.join(repo, '.git', 'logs', 'refs', relative)),
  });
}

const GIT_MODULE_URL = new URL('../../reference/records/git.mjs', import.meta.url);

function replaceExactlyOnce(source, search, replacement) {
  const first = source.indexOf(search);
  assert.notEqual(first, -1, `missing instrumentation seam: ${search.slice(0, 80)}`);
  assert.equal(
    source.indexOf(search, first + search.length),
    -1,
    `duplicate instrumentation seam: ${search.slice(0, 80)}`,
  );
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function runInstrumentedAtomic(repo, operations, replacements, repeats = 1) {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'baton-ref-fault-module-'));
  let source = readFileSync(GIT_MODULE_URL, 'utf8');
  for (const [search, replacement] of replacements) {
    source = replaceExactlyOnce(source, search, replacement);
  }
  writeFileSync(path.join(sandbox, 'git.mjs'), source);
  writeFileSync(
    path.join(sandbox, 'runner.mjs'),
    `import {
  configureEngineGitExecutable,
  unsafeAtomicUpdateRefs,
} from './git.mjs';
configureEngineGitExecutable(${JSON.stringify(gitExecutablePath())});
const operations = ${JSON.stringify(operations)};
try {
  const receipts = [];
  for (let attempt = 0; attempt < ${repeats}; attempt += 1) {
    receipts.push(unsafeAtomicUpdateRefs(${JSON.stringify(repo)}, operations));
  }
  process.stdout.write(JSON.stringify({ ok: true, receipts }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    cause: error?.cause?.message ?? null,
  }));
}
`,
  );
  try {
    const rendered = execFileSync(
      process.execPath,
      [path.join(sandbox, 'runner.mjs')],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          LANG: 'C',
          LC_ALL: 'C',
          PATH: path.dirname(process.execPath),
        },
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { result: JSON.parse(rendered), sandbox };
  } catch (error) {
    rmSync(sandbox, { recursive: true, force: true });
    throw error;
  }
}

async function waitFor(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
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
    throwsCode(() => configureEngineGitExecutable('git'), 'INVALID_GIT_EXECUTABLE');
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
      () => unsafeApplyExactComposition(fixture.repo, {
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
        () => unsafeApplyExactComposition(fixture.repo, {
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
    const first = unsafeApplyExactComposition(fixture.repo, {
      targetRef: fixture.targetRef,
      expectedHead: fixture.expected,
      candidate: fixture.candidate,
    });
    assert.equal(first.mode, 'two-parent');
    git(fixture.repo, 'update-ref', fixture.targetRef, fixture.expected, first.result);
    const second = unsafeApplyExactComposition(fixture.repo, {
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

test('product identity structurally excludes exactly the fixed record root', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, '.baton/releases/keep', 'record\n');
    write(fixture.repo, '.baton/runtime.json', '{"product":true}\n');
    write(fixture.repo, '.baton-release', 'product-adjacent\n');
    write(fixture.repo, 'product.txt', 'product\n');
    const base = commitAll(fixture.repo, 'product and records');
    const baseline = productTreeIdentity(fixture.repo, base);
    assert.deepEqual(
      baseline.entries.map((entry) => entry.path),
      ['.baton-release', '.baton/runtime.json', 'product.txt'],
    );
    write(fixture.repo, '.baton/releases/keep', 'changed record\n');
    const recordOnly = commitAll(fixture.repo, 'change reserved records');
    assert.equal(productTreeIdentity(fixture.repo, recordOnly).productTree, baseline.productTree);
    write(fixture.repo, '.baton/runtime.json', '{"product":false}\n');
    const adjacentProduct = commitAll(fixture.repo, 'change adjacent product');
    assert.notEqual(
      productTreeIdentity(fixture.repo, adjacentProduct).productTree,
      baseline.productTree,
    );
  } finally {
    fixture.cleanup();
  }
});

test('candidate validation rejects reserved-root mutation without moving refs', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, '.baton/releases/status.json', '{"state":0}\n');
    write(fixture.repo, 'product.txt', 'product\n');
    const base = commitAll(fixture.repo, 'candidate base');
    git(fixture.repo, 'branch', 'candidate-authority', base);
    write(fixture.repo, '.baton/releases/status.json', '{"state":1}\n');
    const candidate = commitAll(fixture.repo, 'mutate reserved records');
    assert.equal(
      productTreeIdentity(fixture.repo, candidate).productTree,
      productTreeIdentity(fixture.repo, base).productTree,
    );
    throwsCode(
      () => assertCandidateRecordRootUnchanged(fixture.repo, base, candidate),
      'RESERVED_RECORD_ROOT_CHANGED',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/candidate-authority'), base);
  } finally {
    fixture.cleanup();
  }
});

test('record transitions cannot delete or replace the admitted root directory', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, '.baton/releases/status.json', '{"state":0}\n');
    write(fixture.repo, 'product.txt', 'product\n');
    const base = commitAll(fixture.repo, 'record base');
    git(fixture.repo, 'branch', 'record-target', base);
    const admission = resolveRecordPathAdmission(fixture.repo);

    throwsCode(
      () => unsafeCommitRecordTransition(fixture.repo, {
        ref: 'refs/heads/record-target',
        expectedHead: base,
        message: 'delete root',
        recordPathAdmission: admission,
        changes: { '.baton/releases': null },
      }),
      'NON_RECORD_CHANGE',
    );
    throwsCode(
      () => unsafeCommitRecordTransition(fixture.repo, {
        ref: 'refs/heads/record-target',
        expectedHead: base,
        message: 'delete final root child',
        recordPathAdmission: admission,
        changes: { '.baton/releases/status.json': null },
      }),
      'RECORD_ROOT_REPLACED',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/record-target'), base);

    rmSync(path.join(fixture.repo, '.baton/releases'), { recursive: true });
    const deleted = commitAll(fixture.repo, 'delete record root');
    throwsCode(
      () => assertStructuralRecordOnlyTransition(fixture.repo, base, deleted, admission),
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
    const admission = resolveRecordPathAdmission(fixture.repo);

    throwsCode(
      () => unsafeCommitRecordTransition(fixture.repo, {
        ref: 'refs/heads/release-wt/v1.0.0',
        expectedHead: base,
        message: 'forged admission',
        recordPathAdmission: { root: '.baton/releases' },
        changes: { '.baton/releases/status.json': '{"state":1}\n' },
      }),
      'RECORD_PATH_ADMISSION_REQUIRED',
    );

    const materialized = unsafeCommitRecordTransition(fixture.repo, {
      ref: 'refs/heads/release-wt/v1.0.0',
      expectedHead: base,
      message: 'materialize owner',
      recordPathAdmission: admission,
      changes: { '.baton/releases/status.json': '{"state":1}\n' },
      createRef: { ref: 'refs/heads/track/v1.0.0/T1' },
    });
    assert.equal(resolveRef(fixture.repo, 'refs/heads/release-wt/v1.0.0'), materialized);
    assert.equal(resolveRef(fixture.repo, 'refs/heads/track/v1.0.0/T1'), materialized);

    git(fixture.repo, 'branch', 'track/v1.0.0/already-exists', base);
    throwsCode(
      () => unsafeCommitRecordTransition(fixture.repo, {
        ref: 'refs/heads/release-wt/v1.0.0',
        expectedHead: materialized,
        message: 'must remain atomic',
        recordPathAdmission: admission,
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
    const admission = resolveRecordPathAdmission(fixture.repo);
    const invocation = (message, changes) => unsafeCommitRecordTransition(fixture.repo, {
      ref: 'refs/heads/bounded-records',
      expectedHead: base,
      message,
      recordPathAdmission: admission,
      changes,
    });

    const exactBoundary = unsafePrepareRecordTransition(fixture.repo, {
      expectedHead: base,
      message: 'exact 1025-path install boundary',
      recordPathAdmission: admission,
      changes: Object.fromEntries(Array.from(
        { length: 1025 },
        (_, index) => [`.baton/releases/exact/${index}`, null],
      )),
    });
    assert.equal(exactBoundary.paths.length, 1025);
    throwsCode(
      () => invocation(
        'too many paths',
        Object.fromEntries(Array.from(
          { length: 1026 },
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

    unsafeRunGit(fixture.repo, ['status', '--porcelain']);
    unsafeRunGit(fixture.repo, ['update-ref', 'refs/heads/helper-update', base]);
    const admission = resolveRecordPathAdmission(fixture.repo);
    const transitioned = unsafeCommitRecordTransition(fixture.repo, {
      ref: 'refs/heads/record-target',
      expectedHead: base,
      message: 'hook-safe record transition',
      recordPathAdmission: admission,
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

test('head capture rejects non-commit, resolving, dangling, and broken exact refs', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'commit.txt', 'commit\n');
    const commit = commitAll(fixture.repo, 'capture representation base');
    git(fixture.repo, 'branch', 'capture/direct', commit);
    git(
      fixture.repo,
      'symbolic-ref',
      'refs/heads/capture/resolving',
      'refs/heads/capture/direct',
    );
    git(
      fixture.repo,
      'symbolic-ref',
      'refs/heads/capture/dangling',
      'refs/heads/capture/absent-referent',
    );
    write(fixture.repo, 'blob.txt', 'blob\n');
    const blob = git(fixture.repo, 'hash-object', '-w', 'blob.txt');
    writeFileSync(
      path.join(fixture.repo, '.git', 'refs', 'heads', 'capture', 'blob'),
      `${blob}\n`,
    );
    writeFileSync(
      path.join(fixture.repo, '.git', 'refs', 'heads', 'capture', 'broken'),
      `${'1'.repeat(40)}\n`,
    );

    assert.deepEqual(
      captureHeadRefs(fixture.repo, [
        'refs/heads/capture/direct',
        'refs/heads/capture/missing',
      ]),
      [
        { ref: 'refs/heads/capture/direct', head: commit },
        { ref: 'refs/heads/capture/missing', head: null },
      ],
    );
    for (const ref of ['blob', 'resolving', 'dangling', 'broken']) {
      throwsCode(
        () => captureHeadRefs(fixture.repo, [`refs/heads/capture/${ref}`]),
        'INVALID_HEAD_OBJECT',
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test('exact create, update, and verify effects reconcile and retry idempotently', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'base.txt', 'base\n');
    const base = commitAll(fixture.repo, 'atomic base');
    git(fixture.repo, 'branch', 'atomic/update', base);
    write(fixture.repo, 'next.txt', 'next\n');
    const next = commitAll(fixture.repo, 'atomic next');
    const operations = [
      {
        kind: 'update',
        ref: 'refs/heads/atomic/update',
        expectedHead: base,
        newHead: next,
      },
      { kind: 'create', ref: 'refs/heads/atomic/create', newHead: next },
      { kind: 'verify', ref: 'refs/heads/main', expectedHead: next },
      { kind: 'verify', ref: 'refs/heads/atomic/missing', expectedHead: null },
    ];

    const first = unsafeAtomicUpdateRefs(fixture.repo, operations);
    assert.deepEqual(first, operations);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(first.every(Object.isFrozen), true);
    assert.equal(resolveRef(fixture.repo, 'refs/heads/atomic/update'), next);
    assert.equal(resolveRef(fixture.repo, 'refs/heads/atomic/create'), next);
    const beforeRetry = {
      update: looseRefSnapshot(fixture.repo, 'refs/heads/atomic/update'),
      create: looseRefSnapshot(fixture.repo, 'refs/heads/atomic/create'),
      main: looseRefSnapshot(fixture.repo, 'refs/heads/main'),
    };

    assert.deepEqual(unsafeAtomicUpdateRefs(fixture.repo, operations), operations);
    assert.deepEqual(
      {
        update: looseRefSnapshot(fixture.repo, 'refs/heads/atomic/update'),
        create: looseRefSnapshot(fixture.repo, 'refs/heads/atomic/create'),
        main: looseRefSnapshot(fixture.repo, 'refs/heads/main'),
      },
      beforeRetry,
    );
    assert.deepEqual(
      unsafeAtomicUpdateRefs(fixture.repo, [
        { kind: 'verify', ref: 'refs/heads/main', expectedHead: next },
        { kind: 'verify', ref: 'refs/heads/atomic/missing', expectedHead: null },
        {
          kind: 'update',
          ref: 'refs/heads/atomic/create',
          expectedHead: next,
          newHead: next,
        },
      ]),
      [
        { kind: 'verify', ref: 'refs/heads/main', expectedHead: next },
        { kind: 'verify', ref: 'refs/heads/atomic/missing', expectedHead: null },
        {
          kind: 'update',
          ref: 'refs/heads/atomic/create',
          expectedHead: next,
          newHead: next,
        },
      ],
    );
    assert.deepEqual(looseRefSnapshot(fixture.repo, 'refs/heads/main'), beforeRetry.main);
  } finally {
    fixture.cleanup();
  }
});

test('exact ref transactions preserve SHA-256 widths and ignore inherited Node injection', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'baton-sha256-ref-test-'));
  const priorNodeOptions = process.env.NODE_OPTIONS;
  try {
    git(repo, 'init', '-q', '--object-format=sha256', '-b', 'main');
    git(repo, 'config', 'user.name', 'Baton Test');
    git(repo, 'config', 'user.email', 'baton-test@example.invalid');
    write(repo, 'base.txt', 'base\n');
    const base = commitAll(repo, 'SHA-256 base');
    assert.equal(base.length, 64);
    git(repo, 'branch', 'sha256/update', base);
    write(repo, 'next.txt', 'next\n');
    const next = commitAll(repo, 'SHA-256 next');
    process.env.NODE_OPTIONS = '--require=/definitely/not/a/baton/module.cjs';
    const operations = [
      {
        kind: 'update',
        ref: 'refs/heads/sha256/update',
        expectedHead: base,
        newHead: next,
      },
      { kind: 'create', ref: 'refs/heads/sha256/create', newHead: next },
      { kind: 'verify', ref: 'refs/heads/main', expectedHead: next },
    ];
    throwsCode(
      () => unsafeAtomicUpdateRefs(repo, [{
        kind: 'create',
        ref: 'refs/heads/sha256/wrong-width',
        newHead: 'a'.repeat(40),
      }]),
      'INVALID_REF_OID',
    );
    assert.deepEqual(unsafeAtomicUpdateRefs(repo, operations), operations);
    assert.equal(resolveRef(repo, 'refs/heads/sha256/update'), next);
    assert.equal(resolveRef(repo, 'refs/heads/sha256/create'), next);
  } finally {
    if (priorNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = priorNodeOptions;
    rmSync(repo, { recursive: true, force: true });
  }
});

test('exact transaction and helper inputs remain closed and bounded before effects', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'bounded.txt', 'bounded\n');
    const head = commitAll(fixture.repo, 'bounded transaction base');
    throwsCode(
      () => unsafeAtomicUpdateRefs(fixture.repo, [{
        kind: 'create',
        ref: 'refs/heads/bounded/wrong-width',
        newHead: 'a'.repeat(64),
      }]),
      'INVALID_REF_OID',
    );
    throwsCode(
      () => unsafeAtomicUpdateRefs(fixture.repo, [
        { kind: 'verify', ref: 'refs/heads/main', expectedHead: head },
        { kind: 'verify', ref: 'refs/heads/main', expectedHead: head },
      ]),
      'DUPLICATE_REF',
    );
    throwsCode(
      () => unsafeAtomicUpdateRefs(
        fixture.repo,
        Array.from({ length: 129 }, (_, index) => ({
          kind: 'create',
          ref: `refs/heads/bounded/${index}`,
          newHead: head,
        })),
      ),
      'INVALID_REF_TRANSACTION',
    );
    assert.equal(
      captureHeadRefs(fixture.repo, ['refs/heads/bounded/wrong-width'])[0].head,
      null,
    );

    assert.throws(
      () => execFileSync(
        process.execPath,
        [GIT_MODULE_URL.pathname, '--baton-exact-ref-helper-v1'],
        {
          cwd: fixture.repo,
          encoding: null,
          input: Buffer.alloc((512 * 1024) + 1, 0x20),
          env: {
            LANG: 'C',
            LC_ALL: 'C',
            PATH: path.dirname(process.execPath),
          },
          maxBuffer: 16 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      ),
      (error) => {
        assert.equal(error?.status, 1);
        assert.equal(error?.stdout?.byteLength, 0);
        assert.ok(error?.stderr?.byteLength <= 4097);
        assert.match(
          error.stderr.toString(),
          /request exceeded its byte bound/u,
        );
        return true;
      },
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/main'), head);
  } finally {
    fixture.cleanup();
  }
});

test('resolving and dangling aliases refuse create, update, and verify atomically', () => {
  for (const aliasKind of ['resolving', 'dangling']) {
    for (const operationKind of ['create', 'update', 'verify']) {
      const fixture = temporaryRepository();
      try {
        write(fixture.repo, 'base.txt', 'base\n');
        const base = commitAll(fixture.repo, 'alias base');
        git(fixture.repo, 'branch', 'alias/referent', base);
        git(fixture.repo, 'branch', 'alias/paired', base);
        write(fixture.repo, 'next.txt', 'next\n');
        const next = commitAll(fixture.repo, 'alias next');
        const target = `refs/heads/alias/${aliasKind}-${operationKind}`;
        const referent = aliasKind === 'resolving'
          ? 'refs/heads/alias/referent'
          : `refs/heads/alias/missing-${operationKind}`;
        git(fixture.repo, 'symbolic-ref', target, referent);
        const targetOperation = operationKind === 'create'
          ? { kind: 'create', ref: target, newHead: next }
          : operationKind === 'update'
            ? { kind: 'update', ref: target, expectedHead: base, newHead: next }
            : {
                kind: 'verify',
                ref: target,
                expectedHead: aliasKind === 'resolving' ? base : null,
              };
        const before = {
          target: looseRefSnapshot(fixture.repo, target),
          referent: looseRefSnapshot(fixture.repo, referent),
          paired: looseRefSnapshot(fixture.repo, 'refs/heads/alias/paired'),
        };

        throwsCodeMessage(
          () => unsafeAtomicUpdateRefs(fixture.repo, [
            targetOperation,
            {
              kind: 'update',
              ref: 'refs/heads/alias/paired',
              expectedHead: base,
              newHead: next,
            },
          ]),
          'ATOMIC_REF_UPDATE_FAILED',
          /ambiguous outcome.*recovery is required before retry/u,
        );
        assert.deepEqual(
          {
            target: looseRefSnapshot(fixture.repo, target),
            referent: looseRefSnapshot(fixture.repo, referent),
            paired: looseRefSnapshot(fixture.repo, 'refs/heads/alias/paired'),
          },
          before,
          `${aliasKind} ${operationKind} changed an exact ref or reflog`,
        );
        assert.equal(resolveRef(fixture.repo, 'refs/heads/alias/paired'), base);
        if (aliasKind === 'resolving') {
          assert.equal(resolveRef(fixture.repo, referent), base);
        }
      } finally {
        fixture.cleanup();
      }
    }
  }
});

test('after-capture alias races refuse every operation, including beneath prepared exact locks', () => {
  const parentSeam = [
    '  let helperOutcome = null;',
    '  try {',
    '    const helperOutput = execFileSync(',
  ].join('\n');
  const helperSeam = [
    "    if (await stdout.next() !== 'prepare: ok') {",
    "      throw new Error('exact-ref Git protocol rejected prepare');",
    '    }',
    '    stdout.requireNoQueued();',
    '    recheckPreparedRefState(request);',
  ].join('\n');
  const preparedCells = [];
  for (const operationKind of ['create', 'update', 'verify']) {
    for (const aliasKind of ['resolving', 'dangling']) {
      const fixture = temporaryRepository();
      let sandbox;
      try {
        write(fixture.repo, 'base.txt', 'base\n');
        const base = commitAll(fixture.repo, `${operationKind} ${aliasKind} base`);
        git(fixture.repo, 'branch', 'race/referent', base);
        git(fixture.repo, 'branch', 'race/paired', base);
        write(fixture.repo, 'next.txt', 'next\n');
        const next = commitAll(fixture.repo, `${operationKind} ${aliasKind} next`);
        const target = `refs/heads/race/${operationKind}-${aliasKind}`;
        const referent = aliasKind === 'resolving'
          ? 'refs/heads/race/referent'
          : `refs/heads/race/missing-${operationKind}`;
        const expectedHead = operationKind === 'create'
          ? null
          : operationKind === 'verify' && aliasKind === 'dangling'
            ? null
            : base;
        if (expectedHead !== null) {
          git(fixture.repo, 'update-ref', target, base);
        }
        assert.deepEqual(
          captureHeadRefs(fixture.repo, [target]),
          [{ ref: target, head: expectedHead }],
        );
        const operation = operationKind === 'create'
          ? { kind: 'create', ref: target, newHead: next }
          : operationKind === 'update'
            ? { kind: 'update', ref: target, expectedHead: base, newHead: next }
            : { kind: 'verify', ref: target, expectedHead };
        const paired = {
          kind: 'update',
          ref: 'refs/heads/race/paired',
          expectedHead: base,
          newHead: next,
        };
        const proofFile = path.join(
          fixture.repo,
          `${operationKind}-${aliasKind}-prepared.json`,
        );
        const snapshotFile = path.join(
          fixture.repo,
          `${operationKind}-${aliasKind}-raced.json`,
        );
        const lockPath = path.join(
          fixture.repo,
          '.git',
          'refs',
          'heads',
          'race',
          `${operationKind}-${aliasKind}.lock`,
        );
        const statePaths = Object.fromEntries([
          ['target', target],
          ['referent', referent],
          ['paired', paired.ref],
        ].flatMap(([label, ref]) => {
          const relative = ref.replace(/^refs\//, '');
          return [
            [`${label}Ref`, path.join(fixture.repo, '.git', 'refs', relative)],
            [`${label}Log`, path.join(fixture.repo, '.git', 'logs', 'refs', relative)],
          ];
        }));
        const serializedState = Object.entries(statePaths).map(([label, absolute]) => (
          `    ${JSON.stringify(label)}: existsSync(${JSON.stringify(absolute)}) `
          + `? readFileSync(${JSON.stringify(absolute)}).toString('base64') : null,`
        )).join('\n');
        const parentReplacement = [
          `  execFileSync(gitExecutablePath(), [`,
          `    'symbolic-ref', ${JSON.stringify(target)}, ${JSON.stringify(referent)},`,
          `  ], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });`,
          `  writeFileSync(${JSON.stringify(snapshotFile)}, JSON.stringify({`,
          serializedState,
          '  }));',
          '  let helperOutcome = null;',
          '  try {',
          '    const helperOutput = execFileSync(',
        ].join('\n');
        const helperReplacement = [
          "    if (await stdout.next() !== 'prepare: ok') {",
          "      throw new Error('exact-ref Git protocol rejected prepare');",
          '    }',
          '    stdout.requireNoQueued();',
          '    const cooperative = spawnSync(',
          '      request.gitExecutable,',
          '      helperGitArguments(request.hooksDirectory, [',
          `        'update-ref', ${JSON.stringify(target)}, ${JSON.stringify(next)},`,
          '      ]),',
          '      {',
          '        cwd: process.cwd(),',
          '        encoding: null,',
          '        env: gitEnvironmentForExecutable(request.gitExecutable),',
          '        maxBuffer: MAX_REF_HELPER_OUTPUT_BYTES,',
          "        stdio: ['ignore', 'pipe', 'pipe'],",
          '      },',
          '    );',
          `    writeFileSync(${JSON.stringify(proofFile)}, JSON.stringify({`,
          '      gitPid: child.pid,',
          `      lockHeld: existsSync(${JSON.stringify(lockPath)}),`,
          '      cooperativeStatus: cooperative.status,',
          '      cooperativeSignal: cooperative.signal,',
          '    }));',
          '    recheckPreparedRefState(request);',
        ].join('\n');
        const invocation = runInstrumentedAtomic(
          fixture.repo,
          [operation, paired],
          [
            [
              '  realpathSync,\n  rmSync,',
              '  readFileSync,\n  realpathSync,\n  rmSync,',
            ],
            [parentSeam, parentReplacement],
            [helperSeam, helperReplacement],
          ],
        );
        sandbox = invocation.sandbox;
        if (existsSync(proofFile)) {
          preparedCells.push(`${operationKind}-${aliasKind}`);
          const proof = JSON.parse(readFileSync(proofFile, 'utf8'));
          assert.equal(proof.lockHeld, true);
          assert.notEqual(proof.cooperativeStatus, 0);
          assert.equal(proof.cooperativeSignal, null);
        }
        assert.equal(invocation.result.code, 'ATOMIC_REF_UPDATE_FAILED');
        assert.match(
          invocation.result.message,
          /ambiguous outcome.*recovery is required before retry/u,
        );
        const raced = JSON.parse(readFileSync(snapshotFile, 'utf8'));
        const observed = Object.fromEntries(
          Object.entries(statePaths).map(([label, absolute]) => [
            label,
            existsSync(absolute) ? readFileSync(absolute).toString('base64') : null,
          ]),
        );
        assert.deepEqual(observed, raced);
        assert.equal(resolveRef(fixture.repo, paired.ref), base);
        if (aliasKind === 'resolving') {
          assert.equal(resolveRef(fixture.repo, referent), base);
        }
        assert.equal(existsSync(lockPath), false);
      } finally {
        if (sandbox) rmSync(sandbox, { recursive: true, force: true });
        fixture.cleanup();
      }
    }
  }
  // Git itself always rejects create-over-resolving and update-over-dangling
  // while preparing their CAS. Git 2.43 lets the two null-OID dangling cells
  // reach prepared exact locks, while Git 2.54 rejects them during prepare.
  // Both versions reach the helper's representation check for these two
  // resolving cells; no other prepared cell is permitted.
  assert.deepEqual(
    preparedCells.filter((cell) => ![
      'create-dangling',
      'verify-dangling',
    ].includes(cell)),
    [
      'update-resolving',
      'verify-resolving',
    ],
  );
});

test('every pre-commit helper and acknowledgement fault aborts and releases its lock', async () => {
  const preCommitSeam = (
    '    recheckPreparedRefState(request);\n'
    + "    await writeProtocolLine(child, 'commit');"
  );
  const childSeam = '  const stdout = createBoundedLineReader(child.stdout);';
  const lineSeam = '      lines.push(buffered.subarray(0, newline));';
  for (const mode of [
    'kill',
    'timeout',
    'early-exit',
    'malformed-ack',
    'extra-ack',
    'missing-ack',
    'inspection-error',
    'stdout-overflow',
    'stderr-overflow',
  ]) {
    const fixture = temporaryRepository();
    let sandbox;
    try {
      write(fixture.repo, 'base.txt', 'base\n');
      const base = commitAll(fixture.repo, `${mode} base`);
      git(fixture.repo, 'branch', 'fault/target', base);
      write(fixture.repo, 'next.txt', 'next\n');
      const next = commitAll(fixture.repo, `${mode} next`);
      const pidFile = path.join(fixture.repo, `${mode}-git-child.pid`);
      const proofFile = path.join(fixture.repo, `${mode}-prepared.json`);
      const lockPath = path.join(
        fixture.repo,
        '.git',
        'refs',
        'heads',
        'fault',
        'target.lock',
      );
      const lineDisposition = mode === 'malformed-ack'
        ? "        lines.push(Buffer.from('prepare: malformed'));"
        : mode === 'missing-ack'
          ? '        // Deliberately suppress the prepared acknowledgement.'
          : mode === 'extra-ack'
            ? [
                '        lines.push(protocolLine);',
                "        lines.push(Buffer.from('prepare: extra'));",
              ].join('\n')
            : '        lines.push(protocolLine);';
      const instrumentedLine = [
        '      const protocolLine = buffered.subarray(0, newline);',
        "      if (protocolLine.toString('utf8') === 'prepare: ok') {",
        `        writeFileSync(${JSON.stringify(proofFile)}, JSON.stringify({`,
        `          lockHeld: existsSync(${JSON.stringify(lockPath)}),`,
        '        }));',
        lineDisposition,
        '      } else {',
        '        lines.push(protocolLine);',
        '      }',
      ].join('\n');
      const replacements = [
        [
          childSeam,
          `${childSeam}\n`
            + `  writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
        ],
        [lineSeam, instrumentedLine],
      ];
      if ([
        'kill',
        'timeout',
        'early-exit',
        'inspection-error',
        'stdout-overflow',
        'stderr-overflow',
      ].includes(mode)) {
        const fault = {
          kill: "    process.kill(process.pid, 'SIGKILL');",
          timeout: '    await new Promise(() => {});',
          'early-exit': '    process.exit(91);',
          'inspection-error': "    throw new Error('injected inspection failure');",
          'stdout-overflow': [
            "    child.stdout.emit('data', Buffer.alloc(MAX_REF_HELPER_OUTPUT_BYTES + 1));",
            "    throw new Error('injected stdout overflow');",
          ].join('\n'),
          'stderr-overflow': [
            "    child.stderr.emit('data', Buffer.alloc(MAX_REF_HELPER_OUTPUT_BYTES + 1));",
            "    throw new Error('injected stderr overflow');",
          ].join('\n'),
        }[mode];
        replacements.push([
          preCommitSeam,
          `    recheckPreparedRefState(request);\n`
            + `${fault}\n`
            + "    await writeProtocolLine(child, 'commit');",
        ]);
      }
      if (['timeout', 'missing-ack'].includes(mode)) {
        replacements.push([
          'const REF_HELPER_TIMEOUT_MS = 10_000;',
          'const REF_HELPER_TIMEOUT_MS = 750;',
        ]);
      }
      const invocation = runInstrumentedAtomic(
        fixture.repo,
        [{
          kind: 'update',
          ref: 'refs/heads/fault/target',
          expectedHead: base,
          newHead: next,
        }],
        replacements,
      );
      sandbox = invocation.sandbox;
      assert.deepEqual(
        {
          ok: invocation.result.ok,
          code: invocation.result.code,
          message: invocation.result.message,
        },
        {
          ok: false,
          code: 'ATOMIC_REF_UPDATE_FAILED',
          message: 'exact Baton ref transaction lost without partial advancement',
        },
      );
      assert.equal(resolveRef(fixture.repo, 'refs/heads/fault/target'), base);
      const prepared = JSON.parse(readFileSync(proofFile, 'utf8'));
      assert.equal(prepared.lockHeld, true, `${mode} did not reach a prepared exact lock`);
      const gitPid = Number(readFileSync(pidFile, 'utf8'));
      await waitFor(
        () => !processExists(gitPid),
        `${mode} Git transaction child exit`,
      );
      await waitFor(
        () => !existsSync(lockPath),
        `${mode} exact ref lock release`,
      );
      git(
        fixture.repo,
        'update-ref',
        'refs/heads/fault/target',
        next,
        base,
      );
      assert.equal(resolveRef(fixture.repo, 'refs/heads/fault/target'), next);
    } finally {
      if (sandbox) rmSync(sandbox, { recursive: true, force: true });
      fixture.cleanup();
    }
  }
});

test('post-commit transport and cleanup faults reconcile as idempotent success', async () => {
  const afterCommit = '    committed = true;\n    child.stdin.end();';
  const cleanup = [
    'function cleanupRefTransactionHooks(hooksDirectory) {',
    '  rmSync(hooksDirectory, { recursive: true, force: true });',
    '}',
  ].join('\n');
  const scenarios = [
    {
      name: 'non-zero helper exit',
      replacements: [[
        afterCommit,
        "    committed = true;\n    process.exitCode = 97;\n    child.stdin.end();",
      ]],
    },
    {
      name: 'killed helper',
      replacements: [[
        afterCommit,
        "    committed = true;\n    process.kill(process.pid, 'SIGKILL');\n    child.stdin.end();",
      ]],
    },
    {
      name: 'timed-out helper',
      replacements: [
        [
          afterCommit,
          '    committed = true;\n'
            + '    await new Promise(() => {});\n'
            + '    child.stdin.end();',
        ],
        [
          'const REF_HELPER_TIMEOUT_MS = 10_000;',
          'const REF_HELPER_TIMEOUT_MS = 750;',
        ],
      ],
    },
    {
      name: 'extra helper output',
      replacements: [[
        afterCommit,
        "    committed = true;\n"
          + "    process.stdout.write('unexpected helper output\\\\n');\n"
          + '    child.stdin.end();',
      ]],
    },
    {
      name: 'bounded helper stdout',
      replacements: [[
        afterCommit,
        '    committed = true;\n'
          + '    process.stdout.write(Buffer.alloc(MAX_REF_HELPER_OUTPUT_BYTES + 1));\n'
          + '    child.stdin.end();',
      ]],
    },
    {
      name: 'bounded helper stderr',
      replacements: [[
        afterCommit,
        '    committed = true;\n'
          + '    process.stderr.write(Buffer.alloc(MAX_REF_HELPER_OUTPUT_BYTES + 1));\n'
          + '    child.stdin.end();',
      ]],
    },
    {
      name: 'post-ack parser failure',
      replacements: [[
        afterCommit,
        "    committed = true;\n"
          + "    throw new Error('injected malformed commit acknowledgement');\n"
          + '    child.stdin.end();',
      ]],
    },
    {
      name: 'parent cleanup failure',
      replacements: [[
        cleanup,
        'function cleanupRefTransactionHooks() {\n'
          + "  throw new Error('injected cleanup failure');\n"
          + '}',
      ]],
    },
  ];
  for (const scenario of scenarios) {
    const fixture = temporaryRepository();
    let sandbox;
    try {
      write(fixture.repo, 'base.txt', 'base\n');
      const base = commitAll(fixture.repo, `${scenario.name} base`);
      git(fixture.repo, 'branch', 'fault/target', base);
      write(fixture.repo, 'next.txt', 'next\n');
      const next = commitAll(fixture.repo, `${scenario.name} next`);
      const operation = {
        kind: 'update',
        ref: 'refs/heads/fault/target',
        expectedHead: base,
        newHead: next,
      };
      const invocation = runInstrumentedAtomic(
        fixture.repo,
        [operation],
        scenario.replacements,
      );
      sandbox = invocation.sandbox;
      assert.equal(invocation.result.ok, true, scenario.name);
      assert.deepEqual(invocation.result.receipts, [[operation]], scenario.name);
      assert.equal(resolveRef(fixture.repo, operation.ref), next, scenario.name);
      const lockPath = path.join(
        fixture.repo,
        '.git',
        'refs',
        'heads',
        'fault',
        'target.lock',
      );
      await waitFor(() => !existsSync(lockPath), `${scenario.name} lock release`);
      const beforeRetry = looseRefSnapshot(fixture.repo, operation.ref);
      assert.deepEqual(unsafeAtomicUpdateRefs(fixture.repo, [operation]), [operation]);
      assert.deepEqual(looseRefSnapshot(fixture.repo, operation.ref), beforeRetry);
    } finally {
      if (sandbox) rmSync(sandbox, { recursive: true, force: true });
      fixture.cleanup();
    }
  }
});

test('pure verify succeeds when helper transport is lost after commit acknowledgement', () => {
  const fixture = temporaryRepository();
  let sandbox;
  try {
    write(fixture.repo, 'verify.txt', 'verify\n');
    const head = commitAll(fixture.repo, 'verify transport base');
    const operation = {
      kind: 'verify',
      ref: 'refs/heads/main',
      expectedHead: head,
    };
    const invocation = runInstrumentedAtomic(
      fixture.repo,
      [operation],
      [[
        '    committed = true;\n    child.stdin.end();',
        "    committed = true;\n    process.kill(process.pid, 'SIGKILL');\n    child.stdin.end();",
      ]],
    );
    sandbox = invocation.sandbox;
    assert.equal(invocation.result.ok, true);
    assert.deepEqual(invocation.result.receipts, [[operation]]);
    assert.equal(resolveRef(fixture.repo, operation.ref), head);
  } finally {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test('every mixed or invalid reconciliation is ambiguous and never internally retried', () => {
  const reconciliationSeam = [
    '  let observed = null;',
    '  let reconciliationError = null;',
    '  try {',
  ].join('\n');
  const scenarios = [
    {
      name: 'third OID',
      operationCount: 1,
      injection: ({ target, third }) => (
        `  execFileSync(gitExecutablePath(), [`
        + `'update-ref', ${JSON.stringify(target)}, ${JSON.stringify(third)}`
        + `], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });`
      ),
    },
    {
      name: 'symbolic alias',
      operationCount: 1,
      injection: ({ target, referent }) => (
        `  execFileSync(gitExecutablePath(), [`
        + `'symbolic-ref', ${JSON.stringify(target)}, ${JSON.stringify(referent)}`
        + `], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });`
      ),
    },
    {
      name: 'unexpected absence',
      operationCount: 1,
      injection: ({ target, next }) => (
        `  execFileSync(gitExecutablePath(), [`
        + `'update-ref', '-d', ${JSON.stringify(target)}, ${JSON.stringify(next)}`
        + `], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });`
      ),
    },
    {
      name: 'unexpected presence',
      operationCount: 1,
      preMissing: true,
      injection: ({ target, third }) => (
        `  execFileSync(gitExecutablePath(), [`
        + `'update-ref', ${JSON.stringify(target)}, ${JSON.stringify(third)}`
        + `], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });`
      ),
    },
    {
      name: 'broken direct ref',
      operationCount: 1,
      injection: ({ brokenPath }) => (
        `  writeFileSync(${JSON.stringify(brokenPath)}, \`${'1'.repeat(40)}\\n\`);`
      ),
    },
    {
      name: 'direct non-commit ref',
      operationCount: 1,
      injection: ({ brokenPath, blob }) => (
        `  writeFileSync(${JSON.stringify(brokenPath)}, ${JSON.stringify(`${blob}\n`)});`
      ),
    },
    {
      name: 'mixed pre and post',
      operationCount: 2,
      injection: ({ target, base, next }) => (
        `  execFileSync(gitExecutablePath(), [`
        + `'update-ref', ${JSON.stringify(target)}, ${JSON.stringify(base)}, `
        + `${JSON.stringify(next)}`
        + `], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });`
      ),
    },
  ];
  for (const scenario of scenarios) {
    const fixture = temporaryRepository();
    let sandbox;
    try {
      write(fixture.repo, 'base.txt', 'base\n');
      const base = commitAll(fixture.repo, `${scenario.name} base`);
      if (!scenario.preMissing) {
        git(fixture.repo, 'branch', 'fault/target', base);
      }
      git(fixture.repo, 'branch', 'fault/paired', base);
      write(fixture.repo, 'next.txt', 'next\n');
      const next = commitAll(fixture.repo, `${scenario.name} next`);
      write(fixture.repo, 'third.txt', 'third\n');
      const third = commitAll(fixture.repo, `${scenario.name} third`);
      git(fixture.repo, 'branch', 'fault/referent', third);
      write(fixture.repo, 'blob-only.txt', 'blob\n');
      const blob = git(fixture.repo, 'hash-object', '-w', 'blob-only.txt');
      const target = 'refs/heads/fault/target';
      const operations = scenario.preMissing
        ? [{ kind: 'verify', ref: target, expectedHead: null }]
        : [{
            kind: 'update',
            ref: target,
            expectedHead: base,
            newHead: next,
          }];
      if (scenario.operationCount === 2) {
        operations.push({
          kind: 'update',
          ref: 'refs/heads/fault/paired',
          expectedHead: base,
          newHead: next,
        });
      }
      const injection = scenario.injection({
        target,
        referent: 'refs/heads/fault/referent',
        base,
        next,
        third,
        blob,
        brokenPath: path.join(fixture.repo, '.git', 'refs', 'heads', 'fault', 'target'),
      });
      const helperCount = path.join(fixture.repo, `${scenario.name}-helper-count`);
      const invocation = runInstrumentedAtomic(
        fixture.repo,
        operations,
        [
          [
            'async function runExactRefHelperMain() {\n  try {',
            'async function runExactRefHelperMain() {\n'
              + `  writeFileSync(${JSON.stringify(helperCount)}, 'x', { flag: 'a' });\n`
              + '  try {',
          ],
          [
            reconciliationSeam,
            `  let observed = null;\n`
              + `  let reconciliationError = null;\n`
              + `${injection}\n`
              + '  try {',
          ],
        ],
      );
      sandbox = invocation.sandbox;
      assert.deepEqual(
        {
          ok: invocation.result.ok,
          code: invocation.result.code,
        },
        { ok: false, code: 'ATOMIC_REF_UPDATE_FAILED' },
        scenario.name,
      );
      assert.match(
        invocation.result.message,
        /ambiguous outcome.*recovery is required before retry/u,
        scenario.name,
      );
      assert.equal(readFileSync(helperCount, 'utf8'), 'x', scenario.name);
    } finally {
      if (sandbox) rmSync(sandbox, { recursive: true, force: true });
      fixture.cleanup();
    }
  }

  const fixture = temporaryRepository();
  let sandbox;
  try {
    write(fixture.repo, 'base.txt', 'base\n');
    const base = commitAll(fixture.repo, 'reconciliation failure base');
    git(fixture.repo, 'branch', 'fault/target', base);
    write(fixture.repo, 'next.txt', 'next\n');
    const next = commitAll(fixture.repo, 'reconciliation failure next');
    const helperCount = path.join(fixture.repo, 'reconciliation-helper-count');
    const invocation = runInstrumentedAtomic(
      fixture.repo,
      [{
        kind: 'update',
        ref: 'refs/heads/fault/target',
        expectedHead: base,
        newHead: next,
      }],
      [
        [
          'async function runExactRefHelperMain() {\n  try {',
          'async function runExactRefHelperMain() {\n'
            + `  writeFileSync(${JSON.stringify(helperCount)}, 'x', { flag: 'a' });\n`
            + '  try {',
        ],
        [
          '    observed = captureHeadRefs(\n',
          "    throw new Error('injected reconciliation failure');\n"
            + '    observed = captureHeadRefs(\n',
        ],
      ],
    );
    sandbox = invocation.sandbox;
    assert.equal(invocation.result.code, 'ATOMIC_REF_UPDATE_FAILED');
    assert.match(
      invocation.result.message,
      /ambiguous outcome.*recovery is required before retry/u,
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/fault/target'), next);
    assert.equal(readFileSync(helperCount, 'utf8'), 'x');
  } finally {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test('all-pre reconciliation is snapshot-scoped and does not claim ABA history', () => {
  const fixture = temporaryRepository();
  let sandbox;
  try {
    write(fixture.repo, 'base.txt', 'base\n');
    const base = commitAll(fixture.repo, 'ABA base');
    git(fixture.repo, 'branch', 'fault/target', base);
    write(fixture.repo, 'next.txt', 'next\n');
    const next = commitAll(fixture.repo, 'ABA next');
    const target = 'refs/heads/fault/target';
    const invocation = runInstrumentedAtomic(
      fixture.repo,
      [{ kind: 'update', ref: target, expectedHead: base, newHead: next }],
      [[
        [
          '  let observed = null;',
          '  let reconciliationError = null;',
          '  try {',
        ].join('\n'),
        `  let observed = null;\n`
          + `  let reconciliationError = null;\n`
          + `  execFileSync(gitExecutablePath(), [`
          + `'update-ref', ${JSON.stringify(target)}, ${JSON.stringify(base)}, `
          + `${JSON.stringify(next)}`
          + `], { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });\n`
          + '  try {',
      ]],
    );
    sandbox = invocation.sandbox;
    assert.equal(invocation.result.code, 'ATOMIC_REF_UPDATE_FAILED');
    assert.equal(
      invocation.result.message,
      'exact Baton ref transaction lost without partial advancement',
    );
    assert.equal(resolveRef(fixture.repo, target), base);
    const reflog = readFileSync(
      path.join(fixture.repo, '.git', 'logs', 'refs', 'heads', 'fault', 'target'),
      'utf8',
    );
    assert.match(reflog, new RegExp(`${base} ${next}`, 'u'));
    assert.match(reflog, new RegExp(`${next} ${base}`, 'u'));
  } finally {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
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

    const entries = readFilesAtOID(fixture.repo, commit, [
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
      () => readFilesAtOID(fixture.repo, 'HEAD', ['board/proof.bin']),
      'INVALID_REF_OID',
    );
    throwsCode(
      () => readFilesAtOID(
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

import assert from 'node:assert/strict';
import { rmSync, symlinkSync } from 'node:fs';
import test from 'node:test';

import {
  assertCandidate,
  assertCanonicalRecordRoot,
  assertRecordRootAtRef,
  productTreeIdentity,
  readFileAtOID,
  resolveRef,
  unsafeApplyExactComposition,
  unsafeCommitRecordTransition,
  verifyReleaseIntegration,
  verifyTrackComposition,
} from '../../reference/records/git.mjs';
import {
  commitAll,
  git,
  temporaryRepository,
  testProductExclusionAdmission,
  write,
} from './helpers.mjs';

const PLAN_PATH = '.baton/releases/rc4/plan.md';

function throwsCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code);
}

test('metadata-only commits preserve product identity while product edits change it', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/app.txt', 'product-v1\n');
    write(fixture.repo, PLAN_PATH, 'plan-v1\n');
    const base = commitAll(fixture.repo, 'base product and plan');
    const admission = testProductExclusionAdmission(fixture.repo);
    const baseline = productTreeIdentity(fixture.repo, base, admission);

    write(fixture.repo, PLAN_PATH, 'plan-v2\n');
    const metadataOnly = commitAll(fixture.repo, 'revise plan metadata');
    const afterMetadata = productTreeIdentity(fixture.repo, metadataOnly, admission);
    assert.notEqual(afterMetadata.candidateTree, baseline.candidateTree);
    assert.equal(afterMetadata.productTree, baseline.productTree);
    assert.deepEqual(afterMetadata.entries.map((entry) => entry.path), ['src/app.txt']);

    write(fixture.repo, 'src/app.txt', 'product-v2\n');
    const productChange = commitAll(fixture.repo, 'change product');
    assert.notEqual(
      productTreeIdentity(fixture.repo, productChange, admission).productTree,
      baseline.productTree,
    );
  } finally {
    fixture.cleanup();
  }
});

test('candidate ancestry is required even when product trees are equal', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/app.txt', 'base\n');
    write(fixture.repo, PLAN_PATH, 'plan-v1\n');
    const base = commitAll(fixture.repo, 'base');
    const admission = testProductExclusionAdmission(fixture.repo);

    git(fixture.repo, 'switch', '-q', '-c', 'metadata-descendant');
    write(fixture.repo, PLAN_PATH, 'plan-v2\n');
    const descendant = commitAll(fixture.repo, 'metadata descendant');
    assert.equal(
      productTreeIdentity(fixture.repo, base, admission).productTree,
      productTreeIdentity(fixture.repo, descendant, admission).productTree,
    );

    git(fixture.repo, 'switch', '-q', '--detach', `${base}^0`);
    write(fixture.repo, 'src/app.txt', 'divergent\n');
    const divergent = commitAll(fixture.repo, 'divergent product');
    throwsCode(
      () => assertCandidate(fixture.repo, descendant, divergent),
      'INVALID_CANDIDATE_ANCESTRY',
    );
  } finally {
    fixture.cleanup();
  }
});

test('captured refs reject symlinked record roots independently of the launch checkout', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'safe checkout\n');
    const safe = commitAll(fixture.repo, 'safe checkout');
    const admission = testProductExclusionAdmission(fixture.repo);

    symlinkSync('elsewhere', `${fixture.repo}/.baton`);
    const captured = commitAll(fixture.repo, 'captured symlink');
    git(fixture.repo, 'switch', '-q', '--detach', safe);

    throwsCode(
      () => assertRecordRootAtRef(fixture.repo, captured, '.baton/releases'),
      'SYMLINKED_RECORD_ROOT',
    );
    throwsCode(
      () => productTreeIdentity(fixture.repo, captured, admission),
      'SYMLINKED_RECORD_ROOT',
    );
  } finally {
    fixture.cleanup();
  }
});

test('one same-head metadata writer wins and a stale writer changes nothing', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/app.txt', 'product\n');
    write(fixture.repo, PLAN_PATH, 'plan-v1\n');
    const base = commitAll(fixture.repo, 'base');
    const ref = 'refs/heads/release-wt/rc4';
    git(fixture.repo, 'branch', 'release-wt/rc4', base);
    const admission = testProductExclusionAdmission(fixture.repo);
    const baseline = productTreeIdentity(fixture.repo, base, admission);

    const first = unsafeCommitRecordTransition(fixture.repo, {
      ref,
      expectedHead: base,
      message: 'plan revision two',
      recordPathAdmission: admission,
      productExclusionAdmission: admission,
      changes: { [PLAN_PATH]: 'plan-v2\n' },
    });
    throwsCode(
      () => unsafeCommitRecordTransition(fixture.repo, {
        ref,
        expectedHead: base,
        message: 'competing plan revision',
        recordPathAdmission: admission,
        productExclusionAdmission: admission,
        changes: { [PLAN_PATH]: 'plan-competing\n' },
      }),
      'STALE_WRITER',
    );
    assert.equal(resolveRef(fixture.repo, ref), first);
    assert.equal(
      productTreeIdentity(fixture.repo, first, admission).productTree,
      baseline.productTree,
    );
  } finally {
    fixture.cleanup();
  }
});

test('Git reads and CAS ignore inherited control environment and replacement refs', () => {
  const fixture = temporaryRepository();
  const poisoned = [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_NAMESPACE',
    'GIT_SHALLOW_FILE',
    'GIT_REPLACE_REF_BASE',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
    'GIT_CONFIG_PARAMETERS',
    'GIT_LITERAL_PATHSPECS',
    'GIT_NO_REPLACE_OBJECTS',
  ];
  const previous = new Map(poisoned.map((key) => [key, process.env[key]]));
  try {
    write(fixture.repo, 'src/app.txt', 'base\n');
    write(fixture.repo, PLAN_PATH, 'plan-v1\n');
    const base = commitAll(fixture.repo, 'base');
    write(fixture.repo, 'src/app.txt', 'candidate\n');
    const candidate = commitAll(fixture.repo, 'candidate');
    const admission = testProductExclusionAdmission(fixture.repo);
    const expectedProduct = productTreeIdentity(fixture.repo, candidate, admission).productTree;
    git(fixture.repo, 'replace', candidate, base);
    git(fixture.repo, 'branch', 'poison-safe-cas', candidate);

    Object.assign(process.env, {
      GIT_DIR: '/definitely/not/the/selected/repository',
      GIT_WORK_TREE: '/definitely/not/a/worktree',
      GIT_COMMON_DIR: '/definitely/not/a/common-dir',
      GIT_INDEX_FILE: '/definitely/not/an/index',
      GIT_OBJECT_DIRECTORY: '/definitely/not/an/object-directory',
      GIT_ALTERNATE_OBJECT_DIRECTORIES: '/definitely/not/alternates',
      GIT_NAMESPACE: 'poison',
      GIT_SHALLOW_FILE: '/definitely/not/a/shallow-file',
      GIT_REPLACE_REF_BASE: 'refs/poison/',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.bare',
      GIT_CONFIG_VALUE_0: 'true',
      GIT_CONFIG_PARAMETERS: "'core.bare'='true'",
      GIT_LITERAL_PATHSPECS: '0',
      GIT_NO_REPLACE_OBJECTS: '0',
    });

    assert.equal(resolveRef(fixture.repo, 'refs/heads/poison-safe-cas'), candidate);
    assert.equal(
      productTreeIdentity(fixture.repo, candidate, admission).productTree,
      expectedProduct,
    );
    const transitioned = unsafeCommitRecordTransition(fixture.repo, {
      ref: 'refs/heads/poison-safe-cas',
      expectedHead: candidate,
      message: 'poison-safe plan revision',
      recordPathAdmission: admission,
      productExclusionAdmission: admission,
      changes: { [PLAN_PATH]: 'plan-v2\n' },
    });
    assert.equal(resolveRef(fixture.repo, 'refs/heads/poison-safe-cas'), transitioned);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fixture.cleanup();
  }
});

test('composition admits only exact fast-forward or ordered two-parent topology', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'base.txt', 'base\n');
    const base = commitAll(fixture.repo, 'base');

    git(fixture.repo, 'switch', '-q', '-c', 'candidate', base);
    write(fixture.repo, 'candidate.txt', 'candidate\n');
    const candidate = commitAll(fixture.repo, 'candidate');
    assert.equal(
      verifyTrackComposition(fixture.repo, base, candidate, candidate).mode,
      'fast-forward',
    );

    git(fixture.repo, 'switch', '-q', '-c', 'release', base);
    write(fixture.repo, 'release.txt', 'release\n');
    const expected = commitAll(fixture.repo, 'release movement');
    git(fixture.repo, 'merge', '-q', '--no-ff', '-m', 'exact merge', 'candidate');
    const composed = git(fixture.repo, 'rev-parse', 'HEAD');
    assert.equal(
      verifyTrackComposition(fixture.repo, expected, candidate, composed).mode,
      'two-parent',
    );

    write(fixture.repo, 'later.txt', 'later\n');
    const unexpected = commitAll(fixture.repo, 'unexpected child');
    throwsCode(
      () => verifyTrackComposition(fixture.repo, expected, candidate, unexpected),
      'UNEXPECTED_COMPOSITION_TOPOLOGY',
    );

    const forgedTree = git(fixture.repo, 'rev-parse', `${unexpected}^{tree}`);
    const forged = git(
      fixture.repo,
      'commit-tree',
      forgedTree,
      '-p',
      expected,
      '-p',
      candidate,
      '-m',
      'forged parent shape',
    );
    throwsCode(
      () => verifyTrackComposition(fixture.repo, expected, candidate, forged),
      'FORGED_COMPOSITION_TREE',
    );

    assert.equal(
      verifyReleaseIntegration(fixture.repo, base, candidate, candidate).mode,
      'fast-forward',
    );
    git(fixture.repo, 'branch', 'target-moved', unexpected);
    const admission = testProductExclusionAdmission(fixture.repo);
    throwsCode(
      () => unsafeApplyExactComposition(fixture.repo, {
        targetRef: 'refs/heads/target-moved',
        expectedHead: base,
        candidate,
        productExclusionAdmission: admission,
      }),
      'STALE_TARGET',
    );
  } finally {
    fixture.cleanup();
  }
});

test('an ordinary composition conflict leaves the target ref untouched', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'shared.txt', 'base\n');
    const base = commitAll(fixture.repo, 'base');
    git(fixture.repo, 'switch', '-q', '-c', 'conflict-track', base);
    write(fixture.repo, 'shared.txt', 'track\n');
    commitAll(fixture.repo, 'track edit');
    git(fixture.repo, 'switch', '-q', '-c', 'conflict-release', base);
    write(fixture.repo, 'shared.txt', 'release\n');
    const expected = commitAll(fixture.repo, 'release edit');
    const admission = testProductExclusionAdmission(fixture.repo);

    throwsCode(
      () => unsafeApplyExactComposition(fixture.repo, {
        targetRef: 'refs/heads/conflict-release',
        expectedHead: expected,
        candidate: 'refs/heads/conflict-track',
        productExclusionAdmission: admission,
      }),
      'COMPOSITION_CONFLICT',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/conflict-release'), expected);
  } finally {
    fixture.cleanup();
  }
});

test('captured-object reads remain valid when the launch checkout becomes unsafe', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/app.txt', 'safe product\n');
    write(fixture.repo, PLAN_PATH, 'plan-v1\n');
    commitAll(fixture.repo, 'safe base');
    write(fixture.repo, PLAN_PATH, 'plan-v2\n');
    const captured = commitAll(fixture.repo, 'safe captured plan');
    const admission = testProductExclusionAdmission(fixture.repo);
    const identity = productTreeIdentity(fixture.repo, captured, admission);

    rmSync(`${fixture.repo}/.baton`, { recursive: true });
    symlinkSync('elsewhere', `${fixture.repo}/.baton`);
    commitAll(fixture.repo, 'unsafe launch checkout');
    throwsCode(
      () => assertCanonicalRecordRoot(fixture.repo, '.baton/releases'),
      'SYMLINKED_RECORD_ROOT',
    );
    assert.equal(
      productTreeIdentity(fixture.repo, captured, admission).productTree,
      identity.productTree,
    );
    assert.deepEqual(readFileAtOID(fixture.repo, captured, PLAN_PATH), Buffer.from('plan-v2\n'));
  } finally {
    fixture.cleanup();
  }
});

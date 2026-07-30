import assert from 'node:assert/strict';
import { rmSync, symlinkSync } from 'node:fs';
import test from 'node:test';

import {
  assertCandidate,
  assertCanonicalRecordRoot,
  assertRecordRootAtRef,
  productTreeIdentity,
  readFileAtOID,
  readFirstParentHistory,
  resolveRecordPathAdmission,
  resolveRef,
  unsafeApplyExactComposition,
  unsafePrepareApprovedTargetBase,
  unsafePrepareExactComposition,
  unsafePrepareProductComposition,
  unsafeCommitRecordTransition,
  verifyReleaseIntegration,
  verifyTrackComposition,
} from '../../reference/records/git.mjs';
import {
  commitAll,
  git,
  temporaryRepository,
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
    const baseline = productTreeIdentity(fixture.repo, base);

    write(fixture.repo, PLAN_PATH, 'plan-v2\n');
    const metadataOnly = commitAll(fixture.repo, 'revise plan metadata');
    const afterMetadata = productTreeIdentity(fixture.repo, metadataOnly);
    assert.notEqual(afterMetadata.candidateTree, baseline.candidateTree);
    assert.equal(afterMetadata.productTree, baseline.productTree);
    assert.deepEqual(afterMetadata.entries.map((entry) => entry.path), ['src/app.txt']);

    write(fixture.repo, 'src/app.txt', 'product-v2\n');
    const productChange = commitAll(fixture.repo, 'change product');
    assert.notEqual(
      productTreeIdentity(fixture.repo, productChange).productTree,
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

    git(fixture.repo, 'switch', '-q', '-c', 'metadata-descendant');
    write(fixture.repo, PLAN_PATH, 'plan-v2\n');
    const descendant = commitAll(fixture.repo, 'metadata descendant');
    assert.equal(
      productTreeIdentity(fixture.repo, base).productTree,
      productTreeIdentity(fixture.repo, descendant).productTree,
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

    symlinkSync('elsewhere', `${fixture.repo}/.baton`);
    const captured = commitAll(fixture.repo, 'captured symlink');
    git(fixture.repo, 'switch', '-q', '--detach', safe);

    throwsCode(
      () => assertRecordRootAtRef(fixture.repo, captured, '.baton/releases'),
      'SYMLINKED_RECORD_ROOT',
    );
    throwsCode(
      () => productTreeIdentity(fixture.repo, captured),
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
    const admission = resolveRecordPathAdmission(fixture.repo);
    const baseline = productTreeIdentity(fixture.repo, base);

    const first = unsafeCommitRecordTransition(fixture.repo, {
      ref,
      expectedHead: base,
      message: 'plan revision two',
      recordPathAdmission: admission,
      changes: { [PLAN_PATH]: 'plan-v2\n' },
    });
    throwsCode(
      () => unsafeCommitRecordTransition(fixture.repo, {
        ref,
        expectedHead: base,
        message: 'competing plan revision',
        recordPathAdmission: admission,
        changes: { [PLAN_PATH]: 'plan-competing\n' },
      }),
      'STALE_WRITER',
    );
    assert.equal(resolveRef(fixture.repo, ref), first);
    assert.equal(
      productTreeIdentity(fixture.repo, first).productTree,
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
    const admission = resolveRecordPathAdmission(fixture.repo);
    const expectedProduct = productTreeIdentity(fixture.repo, candidate).productTree;
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
      productTreeIdentity(fixture.repo, candidate).productTree,
      expectedProduct,
    );
    const transitioned = unsafeCommitRecordTransition(fixture.repo, {
      ref: 'refs/heads/poison-safe-cas',
      expectedHead: candidate,
      message: 'poison-safe plan revision',
      recordPathAdmission: admission,
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
    throwsCode(
      () => unsafeApplyExactComposition(fixture.repo, {
        targetRef: 'refs/heads/target-moved',
        expectedHead: base,
        candidate,
      }),
      'STALE_TARGET',
    );
  } finally {
    fixture.cleanup();
  }
});

test('approved-target preparation preserves second-parent authority on first-parent replay', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'base.txt', 'base\n');
    const base = commitAll(fixture.repo, 'base');
    git(fixture.repo, 'switch', '-q', '-c', 'authority', base);
    write(fixture.repo, 'authority.txt', 'authority\n');
    const expected = commitAll(fixture.repo, 'current track authority');

    git(fixture.repo, 'switch', '-q', '-c', 'approved-target', base);
    write(fixture.repo, 'target.txt', 'target\n');
    commitAll(fixture.repo, 'approved target first-parent work');
    git(fixture.repo, 'merge', '-q', '--no-ff', '-m', 'carry authority as second parent', expected);
    const target = git(fixture.repo, 'rev-parse', 'HEAD');
    assert.deepEqual(
      git(fixture.repo, 'rev-list', '--parents', '-n', '1', target).split(' '),
      [target, git(fixture.repo, 'rev-parse', `${target}^1`), expected],
    );

    const options = {
      targetRef: 'refs/heads/track/replay/T1',
      expectedHead: expected,
      approvedTarget: target,
    };
    const prepared = unsafePrepareApprovedTargetBase(fixture.repo, options);
    assert.deepEqual(
      git(fixture.repo, 'rev-list', '--parents', '-n', '1', prepared).split(' '),
      [prepared, expected, target],
    );
    assert.deepEqual(
      readFirstParentHistory(fixture.repo, prepared)
        .slice(0, 2)
        .map(({ oid }) => oid),
      [prepared, expected],
    );
    assert.equal(
      readFirstParentHistory(fixture.repo, prepared).some(({ oid }) => oid === target),
      false,
    );
    assert.equal(unsafePrepareApprovedTargetBase(fixture.repo, options), prepared);
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

    throwsCode(
      () => unsafeApplyExactComposition(fixture.repo, {
        targetRef: 'refs/heads/conflict-release',
        expectedHead: expected,
        candidate: 'refs/heads/conflict-track',
      }),
      'COMPOSITION_CONFLICT',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/conflict-release'), expected);
  } finally {
    fixture.cleanup();
  }
});

test('product composition replays the exact producer delta when ancestry gives Git a false base', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'shared.txt', 'obsolete history\n');
    write(fixture.repo, PLAN_PATH, 'obsolete record\n');
    const historical = commitAll(fixture.repo, 'obsolete historical base');

    git(fixture.repo, 'switch', '-q', '-c', 'producer-product-base', historical);
    write(fixture.repo, 'shared.txt', 'reviewed foundation\n');
    write(fixture.repo, PLAN_PATH, 'first-parent record\n');
    const productBase = commitAll(fixture.repo, 'authority-derived producer product base');

    git(fixture.repo, 'switch', '-q', '-c', 'producer-pass', historical);
    write(fixture.repo, 'shared.txt', 'reviewed foundation\n');
    write(fixture.repo, 'producer.txt', 'exact passed producer delta\n');
    write(fixture.repo, PLAN_PATH, 'second-parent record\n');
    const producerPass = commitAll(fixture.repo, 'passed producer on misleading history');

    git(fixture.repo, 'switch', '-q', '-c', 'consumer-authority', historical);
    write(fixture.repo, 'shared.txt', 'current consumer foundation\n');
    write(fixture.repo, 'consumer.txt', 'current consumer authority\n');
    write(fixture.repo, PLAN_PATH, 'first-parent record\n');
    const consumer = commitAll(fixture.repo, 'consumer authority');

    assert.throws(
      () => git(
        fixture.repo,
        'merge-tree',
        '--write-tree',
        '--no-messages',
        consumer,
        producerPass,
      ),
    );

    git(fixture.repo, 'switch', '-q', '-c', 'audited-product', consumer);
    write(fixture.repo, 'producer.txt', 'exact passed producer delta\n');
    const audited = commitAll(fixture.repo, 'independently audited product');
    const auditedTree = git(fixture.repo, 'rev-parse', `${audited}^{tree}`);

    const prepared = unsafePrepareProductComposition(fixture.repo, {
      targetRef: 'refs/heads/consumer-authority',
      expectedHead: consumer,
      candidate: producerPass,
      productBase: () => productBase,
    });

    assert.equal(prepared.mode, 'two-parent');
    assert.equal(prepared.productBase, productBase);
    assert.deepEqual(
      git(fixture.repo, 'rev-list', '--parents', '-n', '1', prepared.result).split(' '),
      [prepared.result, consumer, producerPass],
    );
    assert.equal(git(fixture.repo, 'rev-parse', `${prepared.result}^{tree}`), auditedTree);
    assert.deepEqual(
      readFileAtOID(fixture.repo, prepared.result, PLAN_PATH),
      Buffer.from('first-parent record\n'),
    );
    throwsCode(
      () => unsafePrepareProductComposition(fixture.repo, {
        targetRef: 'refs/heads/consumer-authority',
        expectedHead: consumer,
        candidate: producerPass,
        productBase: () => 'refs/heads/producer-product-base',
      }),
      'INVALID_REF_OID',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/consumer-authority'), consumer);
  } finally {
    fixture.cleanup();
  }
});

test('exact composition ignores record-only conflicts and preserves first-parent records', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'shared.txt', 'stable product\n');
    write(fixture.repo, PLAN_PATH, 'historical record\n');
    const historical = commitAll(fixture.repo, 'historical record base');

    git(fixture.repo, 'switch', '-q', '-c', 'record-first-parent', historical);
    write(fixture.repo, 'consumer.txt', 'consumer product\n');
    write(fixture.repo, PLAN_PATH, 'first-parent record\n');
    const consumer = commitAll(fixture.repo, 'consumer record authority');

    git(fixture.repo, 'switch', '-q', '-c', 'record-second-parent', historical);
    write(fixture.repo, 'producer.txt', 'producer product\n');
    write(fixture.repo, PLAN_PATH, 'second-parent record\n');
    const producer = commitAll(fixture.repo, 'producer record authority');

    assert.throws(
      () => git(
        fixture.repo,
        'merge-tree',
        '--write-tree',
        '--no-messages',
        consumer,
        producer,
      ),
    );

    const prepared = unsafePrepareExactComposition(fixture.repo, {
      targetRef: 'refs/heads/record-first-parent',
      expectedHead: consumer,
      candidate: producer,
    });
    assert.deepEqual(
      git(fixture.repo, 'rev-list', '--parents', '-n', '1', prepared.result).split(' '),
      [prepared.result, consumer, producer],
    );
    assert.deepEqual(
      readFileAtOID(fixture.repo, prepared.result, PLAN_PATH),
      Buffer.from('first-parent record\n'),
    );
    assert.deepEqual(
      readFileAtOID(fixture.repo, prepared.result, 'consumer.txt'),
      Buffer.from('consumer product\n'),
    );
    assert.deepEqual(
      readFileAtOID(fixture.repo, prepared.result, 'producer.txt'),
      Buffer.from('producer product\n'),
    );
    assert.equal(
      verifyTrackComposition(
        fixture.repo,
        consumer,
        producer,
        prepared.result,
      ).mode,
      'two-parent',
    );
    git(fixture.repo, 'switch', '-q', '--detach', prepared.result);
    write(fixture.repo, PLAN_PATH, 'second-parent record\n');
    const wrongRecord = commitAll(fixture.repo, 'forge second-parent record bytes');
    const forged = git(
      fixture.repo,
      'commit-tree',
      git(fixture.repo, 'rev-parse', `${wrongRecord}^{tree}`),
      '-p',
      consumer,
      '-p',
      producer,
      '-m',
      'forged second-parent records',
    );
    throwsCode(
      () => verifyTrackComposition(fixture.repo, consumer, producer, forged),
      'FORGED_COMPOSITION_TREE',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/record-first-parent'), consumer);
  } finally {
    fixture.cleanup();
  }
});

test('exact verification preserves a missing first-parent record root across delete-modify', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'shared.txt', 'stable product\n');
    write(fixture.repo, PLAN_PATH, 'historical record\n');
    const historical = commitAll(fixture.repo, 'delete-modify record base');

    git(fixture.repo, 'switch', '-q', '-c', 'missing-record-first-parent', historical);
    rmSync(`${fixture.repo}/${PLAN_PATH}`);
    write(fixture.repo, 'consumer.txt', 'consumer product\n');
    const consumer = commitAll(fixture.repo, 'delete first-parent records');

    git(fixture.repo, 'switch', '-q', '-c', 'modified-record-second-parent', historical);
    write(fixture.repo, PLAN_PATH, 'modified second-parent record\n');
    write(fixture.repo, 'producer.txt', 'producer product\n');
    const producer = commitAll(fixture.repo, 'modify second-parent records');

    assert.throws(
      () => git(
        fixture.repo,
        'merge-tree',
        '--write-tree',
        '--no-messages',
        consumer,
        producer,
      ),
    );
    const prepared = unsafePrepareExactComposition(fixture.repo, {
      targetRef: 'refs/heads/missing-record-first-parent',
      expectedHead: consumer,
      candidate: producer,
    });
    throwsCode(
      () => readFileAtOID(fixture.repo, prepared.result, PLAN_PATH),
      'RECORD_NOT_FOUND',
    );
    assert.equal(
      verifyReleaseIntegration(
        fixture.repo,
        consumer,
        producer,
        prepared.result,
      ).mode,
      'two-parent',
    );
  } finally {
    fixture.cleanup();
  }
});

test('product composition leaves its lazy base unresolved on the ordinary clean path', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, PLAN_PATH, 'first-parent record\n');
    const historical = commitAll(fixture.repo, 'clean historical base');

    git(fixture.repo, 'switch', '-q', '-c', 'clean-first-parent', historical);
    write(fixture.repo, 'consumer.txt', 'consumer delta\n');
    const consumer = commitAll(fixture.repo, 'clean consumer');

    git(fixture.repo, 'switch', '-q', '-c', 'clean-second-parent', historical);
    write(fixture.repo, 'producer.txt', 'producer delta\n');
    const producer = commitAll(fixture.repo, 'clean producer');

    const prepared = unsafePrepareProductComposition(fixture.repo, {
      targetRef: 'refs/heads/clean-first-parent',
      expectedHead: consumer,
      candidate: producer,
      productBase: () => {
        throw new Error('ordinary composition must not resolve a product base');
      },
    });
    assert.equal(prepared.mode, 'two-parent');
    assert.equal(Object.hasOwn(prepared, 'productBase'), false);
    throwsCode(
      () => unsafePrepareProductComposition(fixture.repo, {
        targetRef: 'refs/heads/clean-first-parent',
        expectedHead: consumer,
        candidate: producer,
        productBase: historical,
      }),
      'PRODUCT_BASE_RESOLVER_REQUIRED',
    );
  } finally {
    fixture.cleanup();
  }
});

test('product-base fallback refuses a custom merge driver without moving a ref', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'shared.txt', 'obsolete history\n');
    const historical = commitAll(fixture.repo, 'obsolete historical base');

    git(fixture.repo, 'switch', '-q', '-c', 'driver-product-base', historical);
    write(fixture.repo, '.gitattributes', '*.txt merge=hostile\n');
    write(fixture.repo, 'shared.txt', 'reviewed foundation\n');
    const productBase = commitAll(fixture.repo, 'product base with untrusted merge policy');

    git(fixture.repo, 'switch', '-q', '-c', 'driver-producer', historical);
    write(fixture.repo, 'shared.txt', 'reviewed foundation\n');
    write(fixture.repo, 'producer.txt', 'producer delta\n');
    const producer = commitAll(fixture.repo, 'producer on misleading history');

    git(fixture.repo, 'switch', '-q', '-c', 'driver-consumer', historical);
    write(fixture.repo, 'shared.txt', 'consumer foundation\n');
    const consumer = commitAll(fixture.repo, 'consumer authority');

    throwsCode(
      () => unsafePrepareProductComposition(fixture.repo, {
        targetRef: 'refs/heads/driver-consumer',
        expectedHead: consumer,
        candidate: producer,
        productBase: () => productBase,
      }),
      'UNTRUSTED_MERGE_DRIVER',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/driver-consumer'), consumer);
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
    const identity = productTreeIdentity(fixture.repo, captured);

    rmSync(`${fixture.repo}/.baton`, { recursive: true });
    symlinkSync('elsewhere', `${fixture.repo}/.baton`);
    commitAll(fixture.repo, 'unsafe launch checkout');
    throwsCode(
      () => assertCanonicalRecordRoot(fixture.repo, '.baton/releases'),
      'SYMLINKED_RECORD_ROOT',
    );
    assert.equal(
      productTreeIdentity(fixture.repo, captured).productTree,
      identity.productTree,
    );
    assert.deepEqual(readFileAtOID(fixture.repo, captured, PLAN_PATH), Buffer.from('plan-v2\n'));
  } finally {
    fixture.cleanup();
  }
});

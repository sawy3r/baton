import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  unsafeApplyExactComposition,
  unsafeCommitRecordTransition,
  productTreeIdentity,
  resolveRef,
  verifyReleaseIntegration,
  verifyTrackComposition,
} from '../../reference/records/git.mjs';
import {
  assertWorkMayAdvance,
  assemblyProofPath,
  assemblyStatusPath,
  captureRefSnapshot,
  digestBytes,
  expectedTrackMaterialization,
  nextWorkForTrack,
  parsePlanBytes,
  readAuthoritativeRecordSnapshot,
  resolveStatusEvidence,
  selectAssemblyFromSnapshot,
  selectAuthoritativeStatus,
  validateAssemblyStatus,
  validateTrackMaterialization,
  workDesignPath,
  workProofPath,
  workStatusPath,
} from '../../reference/records/records.mjs';
import {
  validateAssemblyPreparationTransition,
  validateAssemblyMergeTransition,
  validateTrackCompositionTransition,
} from '../../reference/records/transition.mjs';
import {
  DIGESTS,
  APPROVAL_BYTES,
  DISPATCH_BYTES,
  captainResult,
  clone,
  commitAll,
  designReady,
  git,
  initialWorkStatus,
  initialAssemblyStatus,
  makePlanBytes,
  makePlanMetadata,
  mergedAssembly,
  mergedWork,
  proofReady,
  temporaryRepository,
  testProductExclusionAdmission,
  verified,
  write,
} from './helpers.mjs';

function throwsCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code);
}

function bindStatus(status, plan) {
  const bound = clone(status);
  bound.plan.digest = plan.digest;
  bound.plan.approval.ref = plan.metadata.approval_ref;
  return bound;
}

function writeStatus(repo, plan, status) {
  write(repo, workStatusPath(plan, status.work_id), `${JSON.stringify(status)}\n`);
}

function makePassedStatus(plan, workId, trackId, materialization) {
  const initial = bindStatus(initialWorkStatus({ workId, trackId, materialization }), plan);
  return verified(proofReady(captainResult(designReady(initial), 'proceed')), 'pass');
}

function evidenceFor(status, profile = 'guided') {
  return resolveStatusEvidence(status, {
    profile,
    resolveEvidence: ({ kind }) => ({
      bytes: kind === 'approval' ? APPROVAL_BYTES : DISPATCH_BYTES,
      provenance: kind === 'approval'
        ? {
          kind,
          ref: status.plan.approval.ref,
          protected: true,
          decision: 'approved',
          plan_digest: status.plan.digest,
          authorizer_isolated: true,
          delivery_writable: false,
        }
        : {
          kind,
          ref: status.verification.attestation_ref,
          protected: true,
          role: 'verifier',
          fresh_context: true,
          read_only: true,
          invocation: status.verification.invocation,
          plan_digest: status.plan.digest,
          proof_digest: status.proof.digest,
          candidate_commit: status.proof.candidate_commit,
          product_tree: status.proof.product_tree,
          engine_controlled: true,
        },
    }),
  });
}

test('owner-aware selection follows baseline, exact track owner, then proven transfer', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    const base = commitAll(fixture.repo, 'base');
    const plan = parsePlanBytes(makePlanBytes());
    git(fixture.repo, 'switch', '-q', '-c', 'release-wt/v1.0.0', base);
    write(
      fixture.repo,
      '.baton/releases/v1.0.0/plan.md',
      plan.bytes,
    );
    for (const [workId, trackId] of [['W1', 'T1'], ['W2', 'T1'], ['W3', 'T2'], ['W4', 'T3']]) {
      writeStatus(
        fixture.repo,
        plan,
        bindStatus(initialWorkStatus({
          workId,
          trackId,
          authority: 'refs/heads/release-wt/v1.0.0',
        }), plan),
      );
    }
    const releaseBaseline = commitAll(fixture.repo, 'approved baseline');
    const admission = testProductExclusionAdmission(fixture.repo);

    const baseline = selectAuthoritativeStatus(
      fixture.repo,
      plan,
      'W1',
      captureRefSnapshot(fixture.repo, plan),
      { recordRootAdmission: admission },
    );
    assert.equal(baseline.source, 'baseline');
    assert.equal(baseline.ref, plan.metadata.release_ref);

    git(fixture.repo, 'switch', '-q', '-c', 'foreign-copy', releaseBaseline);
    const T1Materialization = { base_commit: releaseBaseline, dependencies: [] };
    const foreign = makePassedStatus(plan, 'W1', 'T1', T1Materialization);
    writeStatus(fixture.repo, plan, foreign);
    commitAll(fixture.repo, 'foreign stale copy');
    assert.equal(selectAuthoritativeStatus(
      fixture.repo,
      plan,
      'W1',
      captureRefSnapshot(fixture.repo, plan),
      { recordRootAdmission: admission },
    ).source, 'baseline');

    const ownerW1 = bindStatus(initialWorkStatus({
      workId: 'W1',
      trackId: 'T1',
      materialization: T1Materialization,
    }), plan);
    const ownerW2 = bindStatus(initialWorkStatus({
      workId: 'W2',
      trackId: 'T1',
      materialization: T1Materialization,
    }), plan);
    unsafeCommitRecordTransition(fixture.repo, {
      ref: plan.metadata.release_ref,
      expectedHead: releaseBaseline,
      message: 'materialize T1 owner marker',
      recordPathAdmission: admission,
      productExclusionAdmission: admission,
      changes: {
        [workStatusPath(plan, 'W1')]: `${JSON.stringify(ownerW1)}\n`,
        [workStatusPath(plan, 'W2')]: `${JSON.stringify(ownerW2)}\n`,
      },
      createRef: { ref: plan.metadata.tracks[0].ref },
    });
    git(fixture.repo, 'switch', '-q', 'track/v1.0.0/T1');
    const passedW1 = makePassedStatus(plan, 'W1', 'T1', T1Materialization);
    const passedW2 = makePassedStatus(plan, 'W2', 'T1', T1Materialization);
    writeStatus(fixture.repo, plan, passedW1);
    writeStatus(fixture.repo, plan, passedW2);
    let frozenTrack = commitAll(fixture.repo, 'materialise and complete T1 work');
    assert.equal(selectAuthoritativeStatus(
      fixture.repo,
      plan,
      'W1',
      captureRefSnapshot(fixture.repo, plan),
      { recordRootAdmission: admission },
    ).source, 'owner');

    write(fixture.repo, workStatusPath(plan, 'W1'), '{"malformed":true}\n');
    commitAll(fixture.repo, 'malformed owner');
    throwsCode(
      () => selectAuthoritativeStatus(
        fixture.repo,
        plan,
        'W1',
        captureRefSnapshot(fixture.repo, plan),
        { recordRootAdmission: admission },
      ),
      'UNKNOWN_FIELD',
    );
    writeStatus(fixture.repo, plan, passedW1);
    frozenTrack = commitAll(fixture.repo, 'restore owner');

    rmSync(path.join(fixture.repo, workStatusPath(plan, 'W1')));
    commitAll(fixture.repo, 'missing owner');
    throwsCode(
      () => selectAuthoritativeStatus(
        fixture.repo,
        plan,
        'W1',
        captureRefSnapshot(fixture.repo, plan),
        { recordRootAdmission: admission },
      ),
      'AUTHORITATIVE_STATUS_MISSING',
    );
    writeStatus(fixture.repo, plan, passedW1);
    frozenTrack = commitAll(fixture.repo, 'restore exact owner');

    git(fixture.repo, 'switch', '-q', 'release-wt/v1.0.0');
    write(fixture.repo, workStatusPath(plan, 'W1'), '{"malformed":true}\n');
    commitAll(fixture.repo, 'malformed non-authoritative release copy');
    throwsCode(
      () => selectAuthoritativeStatus(
        fixture.repo,
        plan,
        'W1',
        captureRefSnapshot(fixture.repo, plan),
        { recordRootAdmission: admission },
      ),
      'UNKNOWN_FIELD',
    );
    writeStatus(fixture.repo, plan, ownerW1);
    commitAll(fixture.repo, 'restore release baseline');

    const expectedRelease = resolveRef(fixture.repo, plan.metadata.release_ref);
    git(fixture.repo, 'merge', '-q', '--no-ff', '-m', 'compose T1', 'track/v1.0.0/T1');
    const composition = git(fixture.repo, 'rev-parse', 'HEAD');
    assert.equal(
      verifyTrackComposition(fixture.repo, expectedRelease, frozenTrack, composition).mode,
      'two-parent',
    );

    for (const status of [passedW1, passedW2]) {
      const complete = mergedWork(status);
      complete.merge.frozen_track_head = frozenTrack;
      complete.merge.expected_target = expectedRelease;
      complete.merge.observed_target = expectedRelease;
      complete.merge.result_commit = composition;
      writeStatus(fixture.repo, plan, complete);
    }
    commitAll(fixture.repo, 'transfer T1 authority');

    const composedSnapshot = captureRefSnapshot(fixture.repo, plan);
    const composed = selectAuthoritativeStatus(
      fixture.repo,
      plan,
      'W1',
      composedSnapshot,
      { recordRootAdmission: admission },
    );
    assert.equal(composed.source, 'composed');
    assert.equal(composed.status.merge.frozen_track_head, frozenTrack);

    assert.equal(
      expectedTrackMaterialization(fixture.repo, plan, 'T2', composedSnapshot).base_commit,
      composedSnapshot.release.head,
    );
    assert.equal(
      expectedTrackMaterialization(fixture.repo, plan, 'T3', composedSnapshot).base_commit,
      composedSnapshot.release.head,
    );

    const completeW1 = selectAuthoritativeStatus(
      fixture.repo,
      plan,
      'W1',
      composedSnapshot,
      { recordRootAdmission: admission },
    ).status;
    const completeW2 = selectAuthoritativeStatus(
      fixture.repo,
      plan,
      'W2',
      composedSnapshot,
      { recordRootAdmission: admission },
    ).status;
    assert.equal(nextWorkForTrack(plan, { W1: completeW1, W2: completeW2 }, 'T1'), null);
  } finally {
    fixture.cleanup();
  }
});

test('dependency-gated materialisation rejects a release that lacks its frozen dependency', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'base\n');
    const base = commitAll(fixture.repo, 'base');
    const plan = parsePlanBytes(makePlanBytes());
    git(fixture.repo, 'switch', '-q', '-c', 'release-wt/v1.0.0', base);
    write(fixture.repo, '.baton/releases/v1.0.0/plan.md', plan.bytes);
    const releaseBase = commitAll(fixture.repo, 'approved plan');
    git(fixture.repo, 'branch', 'track/v1.0.0/T1', base);
    git(fixture.repo, 'switch', '-q', 'track/v1.0.0/T1');
    write(fixture.repo, 'track.txt', 'frozen dependency\n');
    commitAll(fixture.repo, 'advance dependency');
    throwsCode(
      () => expectedTrackMaterialization(
        fixture.repo,
        plan,
        'T3',
        captureRefSnapshot(fixture.repo, plan),
      ),
      'UNMET_TRACK_DEPENDENCY',
    );
    assert.equal(resolveRef(fixture.repo, plan.metadata.release_ref), releaseBase);
  } finally {
    fixture.cleanup();
  }
});

test('compare-and-set record commits admit exactly one same-head writer', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/app.txt', 'product\n');
    write(fixture.repo, '.baton/releases/v1/status.json', '{"state":0}\n');
    const base = commitAll(fixture.repo, 'base');
    git(fixture.repo, 'branch', 'release-wt/v1.0.0', base);
    const admission = testProductExclusionAdmission(fixture.repo);
    const before = productTreeIdentity(fixture.repo, base, admission);

    const first = unsafeCommitRecordTransition(fixture.repo, {
      ref: 'refs/heads/release-wt/v1.0.0',
      expectedHead: base,
      message: 'record transition one',
      recordPathAdmission: admission,
      productExclusionAdmission: admission,
      changes: {
        '.baton/releases/v1/status.json': '{"state":1}\n',
      },
    });
    throwsCode(
      () => unsafeCommitRecordTransition(fixture.repo, {
        ref: 'refs/heads/release-wt/v1.0.0',
        expectedHead: base,
        message: 'record transition two',
        recordPathAdmission: admission,
        productExclusionAdmission: admission,
        changes: {
          '.baton/releases/v1/status.json': '{"state":2}\n',
        },
      }),
      'STALE_WRITER',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/release-wt/v1.0.0'), first);
    assert.equal(
      productTreeIdentity(fixture.repo, first, admission).productTree,
      before.productTree,
    );
    throwsCode(
      () => unsafeCommitRecordTransition(fixture.repo, {
        ref: 'refs/heads/release-wt/v1.0.0',
        expectedHead: first,
        message: 'escape record root',
        recordPathAdmission: admission,
        productExclusionAdmission: admission,
        changes: { 'src/app.txt': 'changed\n' },
      }),
      'NON_RECORD_CHANGE',
    );
  } finally {
    fixture.cleanup();
  }
});

test('Git reads and CAS ignore inherited control environment and replace refs', () => {
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
  const prior = new Map(poisoned.map((key) => [key, process.env[key]]));
  try {
    write(fixture.repo, 'src/app.txt', 'base\n');
    write(fixture.repo, '.baton/releases/status.json', '{"state":0}\n');
    const base = commitAll(fixture.repo, 'base');
    write(fixture.repo, 'src/app.txt', 'candidate\n');
    const candidate = commitAll(fixture.repo, 'candidate');
    const admission = testProductExclusionAdmission(fixture.repo);
    const expectedProduct = productTreeIdentity(
      fixture.repo,
      candidate,
      admission,
    ).productTree;
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
      message: 'poison-safe transition',
      recordPathAdmission: admission,
      productExclusionAdmission: admission,
      changes: {
        '.baton/releases/status.json': '{"state":1}\n',
      },
    });
    assert.equal(resolveRef(fixture.repo, 'refs/heads/poison-safe-cas'), transitioned);
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fixture.cleanup();
  }
});

test('track and release composition admit only exact fast-forward or ordered two-parent topology', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'base.txt', 'base\n');
    const base = commitAll(fixture.repo, 'base');

    git(fixture.repo, 'switch', '-q', '-c', 'candidate', base);
    write(fixture.repo, 'candidate.txt', 'candidate\n');
    const candidate = commitAll(fixture.repo, 'candidate');
    assert.equal(verifyTrackComposition(fixture.repo, base, candidate, candidate).mode, 'fast-forward');

    git(fixture.repo, 'switch', '-q', '-c', 'release', base);
    write(fixture.repo, 'release.txt', 'release\n');
    const expected = commitAll(fixture.repo, 'release movement');
    git(fixture.repo, 'merge', '-q', '--no-ff', '-m', 'exact merge', 'candidate');
    const composed = git(fixture.repo, 'rev-parse', 'HEAD');
    assert.equal(verifyTrackComposition(fixture.repo, expected, candidate, composed).mode, 'two-parent');

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

    assert.equal(verifyReleaseIntegration(fixture.repo, base, candidate, candidate).mode, 'fast-forward');
    git(fixture.repo, 'branch', 'target-moved', unexpected);
    const admission = testProductExclusionAdmission(fixture.repo);
    throwsCode(
      () => verifyReleaseIntegration(fixture.repo, 'refs/heads/target-moved', candidate, candidate),
      'UNEXPECTED_COMPOSITION_TOPOLOGY',
    );
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

test('a conflicting composition leaves the target ref untouched', () => {
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

test('the authored plan has three tracks, serial slices, and independent surfaces', () => {
  const plan = parsePlanBytes(makePlanBytes(makePlanMetadata()));
  assert.deepEqual(plan.metadata.tracks.map((track) => track.id), ['T1', 'T2', 'T3']);
  assert.deepEqual(plan.metadata.tracks[0].work.map((work) => work.id), ['W1', 'W2']);
  assert.deepEqual(plan.metadata.tracks[2].depends_on, ['T1']);
});

test('only the first incomplete work in an owning track may advance', () => {
  const plan = parsePlanBytes(makePlanBytes());
  const W1 = bindStatus(initialWorkStatus({ workId: 'W1', trackId: 'T1' }), plan);
  const W2 = bindStatus(initialWorkStatus({ workId: 'W2', trackId: 'T1' }), plan);
  const statuses = { W1, W2 };
  assert.equal(nextWorkForTrack(plan, statuses, 'T1'), 'W1');
  throwsCode(() => assertWorkMayAdvance(plan, statuses, 'T1', 'W2'), 'OUT_OF_ORDER_WORK');

  statuses.W1 = makePassedStatus(plan, 'W1', 'T1');
  assert.equal(assertWorkMayAdvance(plan, statuses, 'T1', 'W2').id, 'W2');

  const partialTransfer = clone(statuses);
  partialTransfer.W1 = mergedWork(statuses.W1);
  throwsCode(() => nextWorkForTrack(plan, partialTransfer, 'T1'), 'PARTIAL_TRACK_TRANSFER');

  const foreign = bindStatus(initialWorkStatus({ workId: 'W2', trackId: 'T2' }), plan);
  throwsCode(
    () => nextWorkForTrack(plan, { W1: statuses.W1, W2: foreign }, 'T1'),
    'STATUS_IDENTITY_MISMATCH',
  );
});

test('assembly admission covers every exact composed track head and product tree', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'assembly base\n');
    const base = commitAll(fixture.repo, 'base');
    const metadata = makePlanMetadata();
    metadata.tracks[0].work = [metadata.tracks[0].work[0]];
    metadata.tracks[2].work[0].depends_on = ['W1'];
    const plan = parsePlanBytes(makePlanBytes(metadata));

    git(fixture.repo, 'switch', '-q', '-c', 'release-wt/v1.0.0', base);
    write(fixture.repo, '.baton/releases/v1.0.0/plan.md', plan.bytes);
    for (const [workId, trackId] of [['W1', 'T1'], ['W3', 'T2'], ['W4', 'T3']]) {
      writeStatus(
        fixture.repo,
        plan,
        bindStatus(initialWorkStatus({
          workId,
          trackId,
          authority: plan.metadata.release_ref,
        }), plan),
      );
    }
    const approved = commitAll(fixture.repo, 'approved assembly plan');
    const admission = testProductExclusionAdmission(fixture.repo);

    const composeTrack = (trackId, workId, start, productPath) => {
      const beforeMaterialization = captureRefSnapshot(fixture.repo, plan);
      assert.equal(beforeMaterialization.release.head, start);
      const materialization = expectedTrackMaterialization(
        fixture.repo,
        plan,
        trackId,
        beforeMaterialization,
      );
      git(fixture.repo, 'switch', '-q', '-c', `track/v1.0.0/${trackId}`, start);
      const materialized = bindStatus(
        initialWorkStatus({ workId, trackId, materialization }),
        plan,
      );
      writeStatus(
        fixture.repo,
        plan,
        materialized,
      );
      const marker = commitAll(fixture.repo, `materialize ${trackId}`);
      git(fixture.repo, 'update-ref', plan.metadata.release_ref, marker, start);
      const designBytes = Buffer.from(`# ${workId} design\n\nImplement the approved ${trackId} slice.\n`);
      const designed = designReady(materialized, { digest: digestBytes(designBytes) });
      write(fixture.repo, workDesignPath(plan, workId), designBytes);
      writeStatus(fixture.repo, plan, designed);
      commitAll(fixture.repo, `design ${trackId}`);
      const proceeded = captainResult(designed, 'proceed');
      writeStatus(fixture.repo, plan, proceeded);
      commitAll(fixture.repo, `Captain PROCEED ${trackId}`);
      write(fixture.repo, productPath, `${trackId} product\n`);
      const candidate = commitAll(fixture.repo, `implement ${trackId}`);
      const product = productTreeIdentity(fixture.repo, candidate, admission);
      const proofBytes = Buffer.from(`# ${workId} proof\n\nThe acceptance check passed.\n`);
      const implemented = proofReady(proceeded, {
        digest: digestBytes(proofBytes),
        candidate,
        candidateTree: product.candidateTree,
        productTree: product.productTree,
      });
      implemented.proof.base_commit = start;
      write(fixture.repo, workProofPath(plan, workId), proofBytes);
      writeStatus(fixture.repo, plan, implemented);
      commitAll(fixture.repo, `record proof ${trackId}`);
      const passed = verified(implemented, 'pass');
      writeStatus(fixture.repo, plan, passed);
      const frozen = commitAll(fixture.repo, `freeze ${trackId}`);
      const beforeComposition = captureRefSnapshot(fixture.repo, plan);
      const expected = git(fixture.repo, 'rev-parse', 'refs/heads/release-wt/v1.0.0');
      git(fixture.repo, 'switch', '-q', 'main');
      const applied = unsafeApplyExactComposition(fixture.repo, {
        targetRef: 'refs/heads/release-wt/v1.0.0',
        expectedHead: expected,
        candidate: frozen,
        productExclusionAdmission: admission,
      });
      const replay = unsafeApplyExactComposition(fixture.repo, {
        targetRef: 'refs/heads/release-wt/v1.0.0',
        expectedHead: expected,
        candidate: frozen,
        productExclusionAdmission: admission,
      });
      assert.equal(applied.changed, true);
      assert.equal(replay.changed, false);
      assert.equal(replay.result, applied.result);
      const composition = applied.result;
      git(fixture.repo, 'switch', '-q', 'release-wt/v1.0.0');
      const complete = mergedWork(passed);
      complete.merge.frozen_track_head = frozen;
      complete.merge.expected_target = expected;
      complete.merge.observed_target = expected;
      complete.merge.result_commit = composition;
      writeStatus(fixture.repo, plan, complete);
      const transferred = commitAll(fixture.repo, `transfer ${trackId}`);
      const transferSnapshot = captureRefSnapshot(fixture.repo, plan);
      assert.deepEqual(
        validateTrackCompositionTransition(
          fixture.repo,
          plan,
          trackId,
          { [workId]: passed },
          { [workId]: complete },
          {
            beforeSnapshot: beforeComposition,
            afterSnapshot: transferSnapshot,
            recordRootAdmission: admission,
            evidenceAdmissions: { [workId]: evidenceFor(passed) },
            profile: 'guided',
          },
        ),
        {
          track_id: trackId,
          frozen_track_head: frozen,
          composition_commit: composition,
          transfer_commit: transferred,
        },
      );
      return { frozen, transferred };
    };

    const T1 = composeTrack('T1', 'W1', approved, 'src/alpha/one.mjs');
    const afterT1 = T1.transferred;
    const T2 = composeTrack('T2', 'W3', afterT1, 'src/beta/one.mjs');
    const T3 = composeTrack('T3', 'W4', T2.transferred, 'src/gamma/one.mjs');

    const candidate = git(fixture.repo, 'rev-parse', 'refs/heads/release-wt/v1.0.0');
    const beforeAssembly = captureRefSnapshot(fixture.repo, plan);
    const identity = productTreeIdentity(fixture.repo, candidate, admission);
    const assembly = initialAssemblyStatus();
    assembly.plan.digest = plan.digest;
    assembly.plan.approval.ref = plan.metadata.approval_ref;
    assembly.proof.plan_digest = plan.digest;
    assembly.proof.approval_digest = assembly.plan.approval.digest;
    assembly.proof.base_commit = candidate;
    assembly.proof.candidate_commit = candidate;
    assembly.proof.candidate_tree = identity.candidateTree;
    assembly.proof.product_tree = identity.productTree;
    assembly.proof.components = [
      { track_id: 'T1', head: T1.frozen },
      { track_id: 'T2', head: T2.frozen },
      { track_id: 'T3', head: T3.frozen },
    ];
    const assemblyProofBytes = Buffer.from(
      '# Assembly proof\n\nAll composed track outcomes pass together.\n',
    );
    assembly.proof.digest = digestBytes(assemblyProofBytes);
    write(fixture.repo, assemblyProofPath(plan), assemblyProofBytes);
    write(
      fixture.repo,
      assemblyStatusPath(plan),
      `${JSON.stringify(assembly)}\n`,
    );
    const preparationCommit = commitAll(fixture.repo, 'record assembly proof');
    let assemblySnapshot = captureRefSnapshot(fixture.repo, plan);
    const assemblyOptions = () => ({
      snapshot: assemblySnapshot,
      recordRootAdmission: admission,
    });
    assert.equal(validateAssemblyStatus(fixture.repo, plan, assembly, assemblyOptions()), assembly);
    assert.deepEqual(
      validateAssemblyPreparationTransition(
        fixture.repo,
        plan,
        assembly,
        {
          beforeSnapshot: beforeAssembly,
          afterSnapshot: assemblySnapshot,
          recordRootAdmission: admission,
          evidenceAdmission: evidenceFor(assembly),
          profile: 'guided',
        },
      ),
      {
        assembly_candidate: candidate,
        preparation_commit: preparationCommit,
      },
    );
    const targetBasedAssembly = clone(assembly);
    targetBasedAssembly.proof.base_commit = beforeAssembly.target.head;
    throwsCode(
      () => validateAssemblyPreparationTransition(
        fixture.repo,
        plan,
        targetBasedAssembly,
        {
          beforeSnapshot: beforeAssembly,
          afterSnapshot: assemblySnapshot,
          recordRootAdmission: admission,
          evidenceAdmission: evidenceFor(targetBasedAssembly),
          profile: 'guided',
        },
      ),
      'STALE_BINDING',
    );
    const projectedAssembly = selectAssemblyFromSnapshot(
      plan,
      readAuthoritativeRecordSnapshot(
        fixture.repo,
        plan,
        assemblySnapshot,
        { recordRootAdmission: admission },
      ),
    );
    assert.equal(projectedAssembly.source, 'release');
    assert.deepEqual(projectedAssembly.status, assembly);
    assert.equal(Object.isFrozen(projectedAssembly.status), true);

    const missing = clone(assembly);
    missing.proof.components.pop();
    throwsCode(
      () => validateAssemblyStatus(fixture.repo, plan, missing, assemblyOptions()),
      'INCOMPLETE_ASSEMBLY',
    );

    const reordered = clone(assembly);
    [reordered.proof.components[0], reordered.proof.components[1]] = [
      reordered.proof.components[1],
      reordered.proof.components[0],
    ];
    throwsCode(
      () => validateAssemblyStatus(fixture.repo, plan, reordered, assemblyOptions()),
      'INCOMPLETE_ASSEMBLY',
    );

    const staleProduct = clone(assembly);
    staleProduct.proof.product_tree = DIGESTS.p;
    throwsCode(
      () => validateAssemblyStatus(fixture.repo, plan, staleProduct, assemblyOptions()),
      'STALE_BINDING',
    );

    const passedAssembly = verified(assembly, 'pass');
    write(
      fixture.repo,
      assemblyStatusPath(plan),
      `${JSON.stringify(passedAssembly)}\n`,
    );
    commitAll(fixture.repo, 'record assembly PASS');
    const beforeIntegration = captureRefSnapshot(fixture.repo, plan);

    const integration = unsafeApplyExactComposition(fixture.repo, {
      targetRef: plan.metadata.target_ref,
      expectedHead: base,
      candidate,
      productExclusionAdmission: admission,
    });
    const integrationReplay = unsafeApplyExactComposition(fixture.repo, {
      targetRef: plan.metadata.target_ref,
      expectedHead: base,
      candidate,
      productExclusionAdmission: admission,
    });
    assert.equal(integration.changed, true);
    assert.equal(integrationReplay.changed, false);

    const completedAssembly = mergedAssembly(passedAssembly);
    completedAssembly.merge.expected_target = base;
    completedAssembly.merge.observed_target = base;
    completedAssembly.merge.result_commit = integration.result;
    write(
      fixture.repo,
      assemblyStatusPath(plan),
      `${JSON.stringify(completedAssembly)}\n`,
    );
    const finalStatusCommit = commitAll(fixture.repo, 'record release Merge');
    assemblySnapshot = captureRefSnapshot(fixture.repo, plan);
    throwsCode(
      () => validateAssemblyMergeTransition(
        fixture.repo,
        plan,
        passedAssembly,
        completedAssembly,
        {
          beforeSnapshot: beforeIntegration,
          afterSnapshot: assemblySnapshot,
          recordRootAdmission: admission,
        },
      ),
      'EVIDENCE_ADMISSION_REQUIRED',
    );
    assert.deepEqual(
      validateAssemblyMergeTransition(
        fixture.repo,
        plan,
        passedAssembly,
        completedAssembly,
        {
          beforeSnapshot: beforeIntegration,
          afterSnapshot: assemblySnapshot,
          recordRootAdmission: admission,
          evidenceAdmission: evidenceFor(passedAssembly),
          profile: 'guided',
        },
      ),
      {
        assembly_candidate: candidate,
        integration_commit: integration.result,
        status_commit: finalStatusCommit,
      },
    );

    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'after-release.txt', 'target moved\n');
    commitAll(fixture.repo, 'advance target after release');
    git(fixture.repo, 'switch', '-q', 'release-wt/v1.0.0');
    assemblySnapshot = captureRefSnapshot(fixture.repo, plan);
    throwsCode(
      () => validateAssemblyMergeTransition(
        fixture.repo,
        plan,
        passedAssembly,
        completedAssembly,
        {
          beforeSnapshot: beforeIntegration,
          afterSnapshot: assemblySnapshot,
          recordRootAdmission: admission,
          evidenceAdmission: evidenceFor(passedAssembly),
          profile: 'guided',
        },
      ),
      'MOVED_TARGET',
    );
  } finally {
    fixture.cleanup();
  }
});

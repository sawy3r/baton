import assert from 'node:assert/strict';
import test from 'node:test';

import {
  unsafeApplyExactComposition,
  unsafeCommitRecordTransition,
  productTreeIdentity,
} from '../../reference/records/git.mjs';
import {
  RECORD_LIMITS,
  captureRefSnapshot,
  digestBytes,
  expectedTrackMaterialization,
  parsePlanBytes,
  readAuthoritativeRecordSnapshot,
  requireEvidenceAdmission,
  resolveStatusEvidence,
  selectAssemblyFromSnapshot,
  selectAuthoritativeStatusFromSnapshot,
  strictParseJSON,
  validateHeadRef,
  validatePlanMetadata,
  validateRefSnapshot,
  validateWorkCandidate,
  workDesignPath,
  workProofPath,
  workStatusPath,
} from '../../reference/records/records.mjs';
import {
  validateAdmittedTransition,
  validateTrackCompositionTransition,
  validateTrackMaterializationTransition,
} from '../../reference/records/transition.mjs';
import {
  DIGESTS,
  APPROVAL_BYTES,
  DISPATCH_BYTES,
  OIDS,
  captainResult,
  clone,
  commitAll,
  designReady,
  git,
  initialWorkStatus,
  makePlanBytes,
  makePlanMetadata,
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

test('only an admitted immutable plan can mint or consume trusted snapshots', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    const base = commitAll(fixture.repo, 'base');
    git(fixture.repo, 'branch', 'release-wt/v1.0.0', base);
    const bytes = makePlanBytes();
    const plan = parsePlanBytes(bytes);
    const snapshot = captureRefSnapshot(fixture.repo, plan);

    const frozenClone = Object.freeze({
      ...plan,
      metadata: structuredClone(plan.metadata),
    });
    throwsCode(() => captureRefSnapshot(fixture.repo, frozenClone), 'PLAN_ADMISSION_REQUIRED');

    const widened = structuredClone(plan);
    widened.metadata.tracks[0].work[0].scope.include = ['.'];
    Object.freeze(widened);
    throwsCode(() => captureRefSnapshot(fixture.repo, widened), 'PLAN_ADMISSION_REQUIRED');
    throwsCode(
      () => readAuthoritativeRecordSnapshot(fixture.repo, widened, snapshot),
      'PLAN_ADMISSION_REQUIRED',
    );
    throwsCode(
      () => validateTrackMaterializationTransition(
        fixture.repo,
        widened,
        'T1',
        {},
        {},
        {},
      ),
      'PLAN_ADMISSION_REQUIRED',
    );

    const differentMetadata = makePlanMetadata();
    differentMetadata.tracks[0].work[0].outcome = 'A different approved outcome';
    const different = parsePlanBytes(makePlanBytes(differentMetadata));
    throwsCode(() => validateRefSnapshot(different, snapshot), 'INVALID_SNAPSHOT');

    const reparsed = parsePlanBytes(bytes);
    assert.equal(validateRefSnapshot(reparsed, snapshot), snapshot);
  } finally {
    fixture.cleanup();
  }
});

function materializedSerialFixture() {
  const fixture = temporaryRepository();
  write(fixture.repo, 'README.md', 'product\n');
  const base = commitAll(fixture.repo, 'base');
  const plan = parsePlanBytes(makePlanBytes());
  git(fixture.repo, 'switch', '-q', '-c', 'release-wt/v1.0.0', base);
  write(fixture.repo, '.baton/releases/v1.0.0/plan.md', plan.bytes);
  const baselines = {};
  for (const [workId, trackId] of [['W1', 'T1'], ['W2', 'T1'], ['W3', 'T2'], ['W4', 'T3']]) {
    const status = bindStatus(initialWorkStatus({
      workId,
      trackId,
      authority: plan.metadata.release_ref,
    }), plan);
    baselines[workId] = status;
    writeStatus(fixture.repo, plan, status);
  }
  const approved = commitAll(fixture.repo, 'approved baseline');
  const admission = testProductExclusionAdmission(fixture.repo);
  const materialization = expectedTrackMaterialization(
    fixture.repo,
    plan,
    'T1',
    captureRefSnapshot(fixture.repo, plan),
  );
  const owners = {};
  const changes = {};
  for (const workId of ['W1', 'W2']) {
    const owner = clone(baselines[workId]);
    owner.authority_ref = owner.owner_ref;
    owner.materialization = materialization;
    owners[workId] = owner;
    changes[workStatusPath(plan, workId)] = `${JSON.stringify(owner)}\n`;
  }
  git(fixture.repo, 'switch', '-q', 'main');
  unsafeCommitRecordTransition(fixture.repo, {
    ref: plan.metadata.release_ref,
    expectedHead: approved,
    message: 'materialize serial T1',
    recordPathAdmission: admission,
    productExclusionAdmission: admission,
    changes,
    createRef: { ref: plan.metadata.tracks[0].ref },
  });
  git(fixture.repo, 'switch', '-q', 'track/v1.0.0/T1');
  return { fixture, plan, approved, admission, owners };
}

function designedStatus(repo, plan, status, label) {
  const bytes = Buffer.from(`# ${label} design\n`);
  const designed = designReady(status, {
    digest: digestBytes(bytes),
    producer: `${label}-design`,
  });
  write(repo, workDesignPath(plan, status.work_id), bytes);
  writeStatus(repo, plan, designed);
  return designed;
}

function proceededStatus(repo, plan, status, label) {
  const proceeded = captainResult(status, 'proceed');
  proceeded.captain.invocation = `${label}-captain`;
  writeStatus(repo, plan, proceeded);
  return proceeded;
}

function implementedStatus(
  repo,
  plan,
  status,
  label,
  candidate,
  logicalBase,
  admission,
) {
  const identity = productTreeIdentity(repo, candidate, admission);
  const bytes = Buffer.from(`# ${label} proof\n`);
  const implemented = proofReady(status, {
    digest: digestBytes(bytes),
    producer: `${label}-implementer`,
    candidate,
    candidateTree: identity.candidateTree,
    productTree: identity.productTree,
  });
  implemented.proof.base_commit = logicalBase;
  write(repo, workProofPath(plan, status.work_id), bytes);
  writeStatus(repo, plan, implemented);
  return implemented;
}

test('plan scope, fixed root, refs, arrays, byte size, and JSON depth fail closed', () => {
  const outside = makePlanMetadata();
  outside.tracks[0].work[0].scope.include = ['src/beta/stolen.mjs'];
  throwsCode(() => validatePlanMetadata(outside), 'WORK_OUTSIDE_TRACK_SCOPE');

  const invalidExclude = makePlanMetadata();
  invalidExclude.tracks[0].work[0].scope.exclude = ['src/alpha/other'];
  throwsCode(() => validatePlanMetadata(invalidExclude), 'INVALID_WORK_SCOPE');

  const effectiveOverlap = makePlanMetadata();
  effectiveOverlap.tracks[1].touch_surfaces = ['src/alpha'];
  effectiveOverlap.tracks[1].work[0].scope.include = ['src/alpha/one.mjs'];
  throwsCode(() => validatePlanMetadata(effectiveOverlap), 'PARALLEL_WORK_SCOPE_CONFLICT');

  const forgedRoot = makePlanMetadata();
  forgedRoot.record_root = '.records/releases';
  throwsCode(() => validatePlanMetadata(forgedRoot), 'INVALID_RECORD_ROOT');
  throwsCode(() => validateHeadRef('refs/heads/topic/.hidden'), 'INVALID_REF');

  const tooManyTracks = makePlanMetadata();
  tooManyTracks.tracks = Array.from(
    { length: RECORD_LIMITS.tracks + 1 },
    (_, index) => ({ ...clone(tooManyTracks.tracks[0]), id: `T${index}` }),
  );
  throwsCode(() => validatePlanMetadata(tooManyTracks), 'RESOURCE_LIMIT');

  const nested = `${'['.repeat(RECORD_LIMITS.json_depth + 2)}0${']'.repeat(RECORD_LIMITS.json_depth + 2)}`;
  throwsCode(() => strictParseJSON(nested), 'RESOURCE_LIMIT');
  throwsCode(() => strictParseJSON('"\ud800"'), 'INVALID_UNICODE');

  const oversized = Buffer.concat([
    makePlanBytes(),
    Buffer.alloc(RECORD_LIMITS.plan_bytes, 0x20),
  ]);
  throwsCode(() => parsePlanBytes(oversized), 'RESOURCE_LIMIT');
});

test('trusted admission resolves exact protected approval and Verifier dispatch provenance', () => {
  const approvalBytes = Buffer.from('approved plan v1\n');
  const dispatchBytes = Buffer.from('isolated verifier dispatch v1\n');
  const status = verified(proofReady(captainResult(designReady(), 'proceed')), 'pass');
  status.plan.approval.digest = digestBytes(approvalBytes);
  status.proof.approval_digest = status.plan.approval.digest;
  status.verification.attestation_digest = digestBytes(dispatchBytes);

  const approvalProvenance = {
    kind: 'approval',
    ref: status.plan.approval.ref,
    protected: true,
    decision: 'approved',
    plan_digest: status.plan.digest,
    authorizer_isolated: true,
    delivery_writable: false,
  };
  const dispatchProvenance = {
    kind: 'verifier_dispatch',
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
  };
  const requests = [];
  const resolver = (request) => {
    requests.push(structuredClone(request));
    return request.kind === 'approval'
      ? { bytes: approvalBytes, provenance: approvalProvenance }
      : { bytes: dispatchBytes, provenance: dispatchProvenance };
  };
  const admission = resolveStatusEvidence(status, { profile: 'autonomous', resolveEvidence: resolver });
  assert.equal(requireEvidenceAdmission(status, admission, 'autonomous'), admission);
  assert.equal(Object.isFrozen(admission.status.proof), true);
  assert.equal(Object.isFrozen(admission.verification), true);
  assert.deepEqual(requests, [
    {
      kind: 'approval',
      ref: status.plan.approval.ref,
      digest: status.plan.approval.digest,
      plan_digest: status.plan.digest,
    },
    {
      kind: 'verifier_dispatch',
      ref: status.verification.attestation_ref,
      digest: status.verification.attestation_digest,
      invocation: status.verification.invocation,
      plan_digest: status.plan.digest,
      proof_digest: status.proof.digest,
      candidate_commit: status.proof.candidate_commit,
      product_tree: status.proof.product_tree,
    },
  ]);

  status.plan.digest = DIGESTS.p;
  approvalBytes.fill(0x78);
  approvalProvenance.decision = 'rejected';
  dispatchProvenance.role = 'implementer';
  assert.notEqual(admission.status.plan.digest, status.plan.digest);
  assert.equal(admission.approval.decision, 'approved');
  assert.equal(admission.verification.role, 'verifier');
  throwsCode(
    () => requireEvidenceAdmission(admission.status, { ...admission }, 'autonomous'),
    'EVIDENCE_ADMISSION_REQUIRED',
  );
});

test('trusted admission rejects every unresolved, substituted, or untrusted claim', () => {
  const approvalBytes = Buffer.from('approval bytes\n');
  const dispatchBytes = Buffer.from('dispatch bytes\n');
  const makeStatus = () => {
    const status = verified(proofReady(captainResult(designReady(), 'proceed')), 'pass');
    status.plan.approval.digest = digestBytes(approvalBytes);
    status.proof.approval_digest = status.plan.approval.digest;
    status.verification.attestation_digest = digestBytes(dispatchBytes);
    return status;
  };
  const provenanceFor = (status) => ({
    approval: {
      kind: 'approval',
      ref: status.plan.approval.ref,
      protected: true,
      decision: 'approved',
      plan_digest: status.plan.digest,
      authorizer_isolated: true,
      delivery_writable: false,
    },
    verifier_dispatch: {
      kind: 'verifier_dispatch',
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
  });
  const admitWithMutation = (kind, mutate, bytesMutation) => {
    const status = makeStatus();
    const provenance = provenanceFor(status);
    mutate(provenance[kind]);
    return () => resolveStatusEvidence(status, {
      profile: 'autonomous',
      resolveEvidence: (request) => ({
        bytes: request.kind === 'approval'
          ? (bytesMutation?.approval ?? approvalBytes)
          : (bytesMutation?.verifier_dispatch ?? dispatchBytes),
        provenance: provenance[request.kind],
      }),
    });
  };

  throwsCode(
    () => resolveStatusEvidence(makeStatus(), { profile: 'guided' }),
    'EVIDENCE_RESOLVER_REQUIRED',
  );
  throwsCode(
    () => resolveStatusEvidence(makeStatus(), {
      profile: 'guided',
      resolveEvidence() {
        throw new Error('not found');
      },
    }),
    'UNRESOLVED_EVIDENCE',
  );
  throwsCode(
    admitWithMutation('approval', () => {}, { approval: Buffer.from('wrong') }),
    'EVIDENCE_BINDING_MISMATCH',
  );
  for (const [kind, mutate, code] of [
    ['approval', (value) => { value.ref = 'approval://substituted'; }, 'EVIDENCE_BINDING_MISMATCH'],
    ['approval', (value) => { value.protected = false; }, 'UNTRUSTED_EVIDENCE_PROVENANCE'],
    ['approval', (value) => { value.decision = 'rejected'; }, 'UNTRUSTED_EVIDENCE_PROVENANCE'],
    ['approval', (value) => { value.plan_digest = DIGESTS.p; }, 'UNTRUSTED_EVIDENCE_PROVENANCE'],
    ['verifier_dispatch', (value) => { value.role = 'implementer'; }, 'UNTRUSTED_EVIDENCE_PROVENANCE'],
    ['verifier_dispatch', (value) => { value.invocation = 'verifier-other'; }, 'UNTRUSTED_EVIDENCE_PROVENANCE'],
    ['verifier_dispatch', (value) => { value.fresh_context = false; }, 'UNTRUSTED_EVIDENCE_PROVENANCE'],
    ['verifier_dispatch', (value) => { value.read_only = false; }, 'UNTRUSTED_EVIDENCE_PROVENANCE'],
    ['verifier_dispatch', (value) => { value.plan_digest = DIGESTS.p; }, 'UNTRUSTED_EVIDENCE_PROVENANCE'],
    ['verifier_dispatch', (value) => { value.proof_digest = DIGESTS.p; }, 'UNTRUSTED_EVIDENCE_PROVENANCE'],
    ['verifier_dispatch', (value) => { value.candidate_commit = OIDS.f; }, 'UNTRUSTED_EVIDENCE_PROVENANCE'],
    ['verifier_dispatch', (value) => { value.product_tree = DIGESTS.p; }, 'UNTRUSTED_EVIDENCE_PROVENANCE'],
  ]) {
    throwsCode(admitWithMutation(kind, mutate), code);
  }

  const oversized = Buffer.alloc(RECORD_LIMITS.evidence_bytes + 1, 0x61);
  const oversizedStatus = makeStatus();
  oversizedStatus.plan.approval.digest = digestBytes(oversized);
  oversizedStatus.proof.approval_digest = oversizedStatus.plan.approval.digest;
  const provenance = provenanceFor(oversizedStatus);
  throwsCode(
    () => resolveStatusEvidence(oversizedStatus, {
      profile: 'autonomous',
      resolveEvidence: ({ kind }) => ({
        bytes: kind === 'approval' ? oversized : dispatchBytes,
        provenance: provenance[kind],
      }),
    }),
    'RESOURCE_LIMIT',
  );
});

test('action admission rejects missing, other-status, wrong-profile, and forged evidence capabilities', () => {
  const previous = initialWorkStatus();
  const next = designReady(previous);
  const previousAdmission = evidenceFor(previous);
  const nextAdmission = evidenceFor(next);
  assert.equal(
    validateAdmittedTransition(previous, next, 'DESIGN_WRITTEN', {
      previousAdmission,
      nextAdmission,
      profile: 'guided',
    }),
    next,
  );
  for (const options of [
    { nextAdmission, profile: 'guided' },
    { previousAdmission: nextAdmission, nextAdmission, profile: 'guided' },
    { previousAdmission, nextAdmission, profile: 'autonomous' },
    { previousAdmission: { ...previousAdmission }, nextAdmission, profile: 'guided' },
  ]) {
    throwsCode(
      () => validateAdmittedTransition(previous, next, 'DESIGN_WRITTEN', options),
      'EVIDENCE_ADMISSION_REQUIRED',
    );
  }
});

test('atomic materialization leaves a dual-ref marker and batched projection fails closed after owner deletion', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    const base = commitAll(fixture.repo, 'base');
    const plan = parsePlanBytes(makePlanBytes());
    git(fixture.repo, 'switch', '-q', '-c', 'release-wt/v1.0.0', base);
    write(fixture.repo, '.baton/releases/v1.0.0/plan.md', plan.bytes);
    const baselines = {};
    for (const [workId, trackId] of [['W1', 'T1'], ['W2', 'T1'], ['W3', 'T2'], ['W4', 'T3']]) {
      const status = bindStatus(initialWorkStatus({
        workId,
        trackId,
        authority: plan.metadata.release_ref,
      }), plan);
      baselines[workId] = status;
      writeStatus(fixture.repo, plan, status);
    }
    const approved = commitAll(fixture.repo, 'approved baseline');
    const admission = testProductExclusionAdmission(fixture.repo);
    const before = captureRefSnapshot(fixture.repo, plan);
    const materialization = expectedTrackMaterialization(fixture.repo, plan, 'T1', before);
    const owners = {};
    const changes = {};
    for (const workId of ['W1', 'W2']) {
      const owner = clone(baselines[workId]);
      owner.authority_ref = owner.owner_ref;
      owner.materialization = materialization;
      owners[workId] = owner;
      changes[workStatusPath(plan, workId)] = `${JSON.stringify(owner)}\n`;
    }
    const marker = unsafeCommitRecordTransition(fixture.repo, {
      ref: plan.metadata.release_ref,
      expectedHead: approved,
      message: 'materialize T1',
      recordPathAdmission: admission,
      productExclusionAdmission: admission,
      changes,
      createRef: { ref: plan.metadata.tracks[0].ref },
    });
    const after = captureRefSnapshot(fixture.repo, plan);
    assert.equal(after.release.head, marker);
    assert.equal(after.tracks[0].head, marker);
    throwsCode(
      () => validateTrackMaterializationTransition(
        fixture.repo,
        plan,
        'T1',
        { W1: baselines.W1, W2: baselines.W2 },
        owners,
        { beforeSnapshot: before, afterSnapshot: after, recordRootAdmission: admission },
      ),
      'EVIDENCE_ADMISSION_REQUIRED',
    );
    assert.deepEqual(
      validateTrackMaterializationTransition(
        fixture.repo,
        plan,
        'T1',
        { W1: baselines.W1, W2: baselines.W2 },
        owners,
        {
          beforeSnapshot: before,
          afterSnapshot: after,
          recordRootAdmission: admission,
          evidenceAdmissions: {
            W1: evidenceFor(baselines.W1),
            W2: evidenceFor(baselines.W2),
          },
          profile: 'guided',
        },
      ),
      { track_id: 'T1', base_commit: approved, owner_head: marker },
    );

    const structural = readAuthoritativeRecordSnapshot(
      fixture.repo,
      plan,
      after,
      { recordRootAdmission: admission },
    );
    assert.equal(structural.kind, 'baton.structural-authority-snapshot/v1');
    assert.equal(selectAuthoritativeStatusFromSnapshot(plan, 'W1', structural).source, 'owner');
    assert.equal(selectAssemblyFromSnapshot(plan, structural), null);
    assert.equal(Object.isFrozen(structural.refs), true);
    assert.equal(Object.isFrozen(structural.refs[0].statuses[0].status), true);

    unsafeCommitRecordTransition(fixture.repo, {
      ref: plan.metadata.release_ref,
      expectedHead: marker,
      message: 'move release after captured snapshot',
      recordPathAdmission: admission,
      productExclusionAdmission: admission,
      changes: {
        [workStatusPath(plan, 'W3')]: JSON.stringify(baselines.W3),
      },
    });
    assert.equal(
      selectAuthoritativeStatusFromSnapshot(
        plan,
        'W1',
        readAuthoritativeRecordSnapshot(
          fixture.repo,
          plan,
          after,
          { recordRootAdmission: admission },
        ),
      ).source,
      'owner',
    );

    const materializedW3 = bindStatus(initialWorkStatus({
      workId: 'W3',
      trackId: 'T2',
      materialization: { base_commit: approved, dependencies: [] },
    }), plan);
    const terminalW3 = mergedWork(
      verified(proofReady(captainResult(designReady(materializedW3), 'proceed')), 'pass'),
    );
    const releaseHead = captureRefSnapshot(fixture.repo, plan).release.head;
    unsafeCommitRecordTransition(fixture.repo, {
      ref: plan.metadata.release_ref,
      expectedHead: releaseHead,
      message: 'fabricate terminal release copy',
      recordPathAdmission: admission,
      productExclusionAdmission: admission,
      changes: {
        [workStatusPath(plan, 'W3')]: `${JSON.stringify(terminalW3)}\n`,
      },
    });
    const fabricated = captureRefSnapshot(fixture.repo, plan);
    throwsCode(
      () => selectAuthoritativeStatusFromSnapshot(
        plan,
        'W3',
        readAuthoritativeRecordSnapshot(
          fixture.repo,
          plan,
          fabricated,
          { recordRootAdmission: admission },
        ),
      ),
      'INVALID_BASELINE',
    );

    unsafeCommitRecordTransition(fixture.repo, {
      ref: plan.metadata.release_ref,
      expectedHead: fabricated.release.head,
      message: 'erase T1 materialization records',
      recordPathAdmission: admission,
      productExclusionAdmission: admission,
      changes: {
        [workStatusPath(plan, 'W1')]: `${JSON.stringify(baselines.W1)}\n`,
        [workStatusPath(plan, 'W2')]: `${JSON.stringify(baselines.W2)}\n`,
      },
    });
    git(fixture.repo, 'update-ref', '-d', plan.metadata.tracks[0].ref);
    const erased = captureRefSnapshot(fixture.repo, plan);
    throwsCode(
      () => readAuthoritativeRecordSnapshot(
        fixture.repo,
        plan,
        erased,
        { recordRootAdmission: admission },
      ),
      'ERASED_OWNER_MARKER',
    );
  } finally {
    fixture.cleanup();
  }
});

test('candidate replay rejects a product commit before Captain PROCEED', () => {
  const {
    fixture,
    plan,
    approved,
    admission,
    owners,
  } = materializedSerialFixture();
  try {
    write(fixture.repo, 'src/alpha/one.mjs', 'premature product\n');
    const candidate = commitAll(fixture.repo, 'W1 premature candidate');
    const designed = designedStatus(fixture.repo, plan, owners.W1, 'W1');
    commitAll(fixture.repo, 'W1 late design');
    const proceeded = proceededStatus(fixture.repo, plan, designed, 'W1');
    commitAll(fixture.repo, 'W1 late Captain PROCEED');
    const implemented = implementedStatus(
      fixture.repo,
      plan,
      proceeded,
      'W1',
      candidate,
      approved,
      admission,
    );
    commitAll(fixture.repo, 'W1 IMPLEMENTED');
    const passed = verified(implemented, 'pass');
    passed.verification.invocation = 'W1-verifier';
    writeStatus(fixture.repo, plan, passed);
    const authorityHead = commitAll(fixture.repo, 'W1 PASS');
    const syntheticW2 = verified(
      proofReady(captainResult(designReady(owners.W2), 'proceed')),
      'pass',
    );
    const nextW1 = mergedWork(passed);
    const nextW2 = mergedWork(syntheticW2);
    nextW1.merge.frozen_track_head = authorityHead;
    nextW2.merge.frozen_track_head = authorityHead;
    const attemptedSnapshot = captureRefSnapshot(fixture.repo, plan);
    for (const next of [nextW1, nextW2]) {
      next.merge.expected_target = attemptedSnapshot.release.head;
      next.merge.observed_target = attemptedSnapshot.release.head;
    }
    throwsCode(
      () => validateTrackCompositionTransition(
        fixture.repo,
        plan,
        'T1',
        { W1: passed, W2: syntheticW2 },
        { W1: nextW1, W2: nextW2 },
        {
          beforeSnapshot: attemptedSnapshot,
          afterSnapshot: attemptedSnapshot,
          recordRootAdmission: admission,
          evidenceAdmissions: { W1: evidenceFor(passed) },
          profile: 'guided',
        },
      ),
      'PRODUCT_BEFORE_PROCEED',
    );
  } finally {
    fixture.cleanup();
  }
});

test('candidate replay rejects W2 design before W1 PASS', () => {
  const {
    fixture,
    plan,
    approved,
    admission,
    owners,
  } = materializedSerialFixture();
  try {
    const W1Designed = designedStatus(fixture.repo, plan, owners.W1, 'W1');
    commitAll(fixture.repo, 'W1 design');
    const W1Proceeded = proceededStatus(fixture.repo, plan, W1Designed, 'W1');
    commitAll(fixture.repo, 'W1 Captain PROCEED');
    write(fixture.repo, 'src/alpha/one.mjs', 'W1 product\n');
    const W1Candidate = commitAll(fixture.repo, 'W1 candidate');
    const W1Implemented = implementedStatus(
      fixture.repo,
      plan,
      W1Proceeded,
      'W1',
      W1Candidate,
      approved,
      admission,
    );
    commitAll(fixture.repo, 'W1 IMPLEMENTED');

    const W2Designed = designedStatus(fixture.repo, plan, owners.W2, 'W2');
    commitAll(fixture.repo, 'W2 premature design');
    const W1Passed = verified(W1Implemented, 'pass');
    W1Passed.verification.invocation = 'W1-verifier';
    writeStatus(fixture.repo, plan, W1Passed);
    commitAll(fixture.repo, 'W1 PASS');
    const W2Proceeded = proceededStatus(fixture.repo, plan, W2Designed, 'W2');
    commitAll(fixture.repo, 'W2 Captain PROCEED');
    write(fixture.repo, 'src/alpha/two.mjs', 'W2 product\n');
    const W2Candidate = commitAll(fixture.repo, 'W2 candidate');
    const W2Implemented = implementedStatus(
      fixture.repo,
      plan,
      W2Proceeded,
      'W2',
      W2Candidate,
      W1Candidate,
      admission,
    );
    commitAll(fixture.repo, 'W2 IMPLEMENTED');
    const W2Passed = verified(W2Implemented, 'pass');
    W2Passed.verification.invocation = 'W2-verifier';
    writeStatus(fixture.repo, plan, W2Passed);
    const authorityHead = commitAll(fixture.repo, 'W2 PASS');
    const nextW1 = mergedWork(W1Passed);
    const nextW2 = mergedWork(W2Passed);
    nextW1.merge.frozen_track_head = authorityHead;
    nextW2.merge.frozen_track_head = authorityHead;
    const attemptedSnapshot = captureRefSnapshot(fixture.repo, plan);
    for (const next of [nextW1, nextW2]) {
      next.merge.expected_target = attemptedSnapshot.release.head;
      next.merge.observed_target = attemptedSnapshot.release.head;
    }
    throwsCode(
      () => validateTrackCompositionTransition(
        fixture.repo,
        plan,
        'T1',
        { W1: W1Passed, W2: W2Passed },
        { W1: nextW1, W2: nextW2 },
        {
          beforeSnapshot: attemptedSnapshot,
          afterSnapshot: attemptedSnapshot,
          recordRootAdmission: admission,
          evidenceAdmissions: {
            W1: evidenceFor(W1Passed),
            W2: evidenceFor(W2Passed),
          },
          profile: 'guided',
        },
      ),
      'OUT_OF_ORDER_WORK',
    );
  } finally {
    fixture.cleanup();
  }
});

test('candidate replay rejects one record commit spanning W1 and W2', () => {
  const {
    fixture,
    plan,
    approved,
    admission,
    owners,
  } = materializedSerialFixture();
  try {
    const W1Designed = designedStatus(fixture.repo, plan, owners.W1, 'W1');
    commitAll(fixture.repo, 'W1 design');
    const W1Proceeded = proceededStatus(fixture.repo, plan, W1Designed, 'W1');
    commitAll(fixture.repo, 'W1 Captain PROCEED');
    write(fixture.repo, 'src/alpha/one.mjs', 'W1 product\n');
    const W1Candidate = commitAll(fixture.repo, 'W1 candidate');
    const W1Implemented = implementedStatus(
      fixture.repo,
      plan,
      W1Proceeded,
      'W1',
      W1Candidate,
      approved,
      admission,
    );
    commitAll(fixture.repo, 'W1 IMPLEMENTED');

    const W2Designed = designedStatus(fixture.repo, plan, owners.W2, 'W2');
    const W1Passed = verified(W1Implemented, 'pass');
    W1Passed.verification.invocation = 'W1-verifier';
    writeStatus(fixture.repo, plan, W1Passed);
    commitAll(fixture.repo, 'cross-work W1 PASS and W2 design');
    const W2Proceeded = proceededStatus(fixture.repo, plan, W2Designed, 'W2');
    commitAll(fixture.repo, 'W2 Captain PROCEED');
    write(fixture.repo, 'src/alpha/two.mjs', 'W2 product\n');
    const W2Candidate = commitAll(fixture.repo, 'W2 candidate');
    const W2Implemented = implementedStatus(
      fixture.repo,
      plan,
      W2Proceeded,
      'W2',
      W2Candidate,
      W1Candidate,
      admission,
    );
    commitAll(fixture.repo, 'W2 IMPLEMENTED');
    const W2Passed = verified(W2Implemented, 'pass');
    W2Passed.verification.invocation = 'W2-verifier';
    writeStatus(fixture.repo, plan, W2Passed);
    const authorityHead = commitAll(fixture.repo, 'W2 PASS');
    throwsCode(
      () => validateWorkCandidate(
        fixture.repo,
        plan,
        W2Passed,
        W1Passed,
        { authorityHead, recordRootAdmission: admission },
      ),
      'CROSS_WORK_RECORD_COMMIT',
    );
  } finally {
    fixture.cleanup();
  }
});

test('multi-work track replays collective materialization, serial gates, candidates, and tail records', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    const base = commitAll(fixture.repo, 'base');
    const plan = parsePlanBytes(makePlanBytes());
    git(fixture.repo, 'switch', '-q', '-c', 'release-wt/v1.0.0', base);
    write(fixture.repo, '.baton/releases/v1.0.0/plan.md', plan.bytes);
    const baselines = {};
    for (const [workId, trackId] of [['W1', 'T1'], ['W2', 'T1'], ['W3', 'T2'], ['W4', 'T3']]) {
      const status = bindStatus(initialWorkStatus({
        workId,
        trackId,
        authority: plan.metadata.release_ref,
      }), plan);
      baselines[workId] = status;
      writeStatus(fixture.repo, plan, status);
    }
    const approved = commitAll(fixture.repo, 'approved baseline');
    const admission = testProductExclusionAdmission(fixture.repo);
    const before = captureRefSnapshot(fixture.repo, plan);
    const materialization = expectedTrackMaterialization(fixture.repo, plan, 'T1', before);
    const initialOwners = {};
    const markerChanges = {};
    for (const workId of ['W1', 'W2']) {
      const status = clone(baselines[workId]);
      status.authority_ref = status.owner_ref;
      status.materialization = materialization;
      initialOwners[workId] = status;
      markerChanges[workStatusPath(plan, workId)] = `${JSON.stringify(status)}\n`;
    }
    git(fixture.repo, 'switch', '-q', 'main');
    const marker = unsafeCommitRecordTransition(fixture.repo, {
      ref: plan.metadata.release_ref,
      expectedHead: approved,
      message: 'materialize serial T1',
      recordPathAdmission: admission,
      productExclusionAdmission: admission,
      changes: markerChanges,
      createRef: { ref: plan.metadata.tracks[0].ref },
    });
    validateTrackMaterializationTransition(
      fixture.repo,
      plan,
      'T1',
      { W1: baselines.W1, W2: baselines.W2 },
      initialOwners,
      {
        beforeSnapshot: before,
        afterSnapshot: captureRefSnapshot(fixture.repo, plan),
        recordRootAdmission: admission,
        evidenceAdmissions: {
          W1: evidenceFor(baselines.W1),
          W2: evidenceFor(baselines.W2),
        },
        profile: 'guided',
      },
    );

    git(fixture.repo, 'switch', '-q', 'track/v1.0.0/T1');
    const advance = (initial, logicalBase, productPath, label) => {
      const designBytes = Buffer.from(`# ${label} design\n`);
      const designed = designReady(initial, {
        digest: digestBytes(designBytes),
        producer: `${label}-design`,
      });
      write(fixture.repo, workDesignPath(plan, initial.work_id), designBytes);
      writeStatus(fixture.repo, plan, designed);
      commitAll(fixture.repo, `${label} design`);

      const proceeded = captainResult(designed, 'proceed');
      proceeded.captain.invocation = `${label}-captain`;
      writeStatus(fixture.repo, plan, proceeded);
      commitAll(fixture.repo, `${label} Captain PROCEED`);

      write(fixture.repo, productPath, `${label} product\n`);
      const candidate = commitAll(fixture.repo, `${label} candidate`);
      const identity = productTreeIdentity(fixture.repo, candidate, admission);
      const proofBytes = Buffer.from(`# ${label} proof\n`);
      const implemented = proofReady(proceeded, {
        digest: digestBytes(proofBytes),
        producer: `${label}-implementer`,
        candidate,
        candidateTree: identity.candidateTree,
        productTree: identity.productTree,
      });
      implemented.proof.base_commit = logicalBase;
      write(fixture.repo, workProofPath(plan, initial.work_id), proofBytes);
      writeStatus(fixture.repo, plan, implemented);
      commitAll(fixture.repo, `${label} IMPLEMENTED`);

      const passed = verified(implemented, 'pass');
      passed.verification.invocation = `${label}-verifier`;
      writeStatus(fixture.repo, plan, passed);
      const head = commitAll(fixture.repo, `${label} PASS`);
      return { passed, candidate, head };
    };

    const W1 = advance(initialOwners.W1, approved, 'src/alpha/one.mjs', 'W1');
    const W2 = advance(initialOwners.W2, W1.candidate, 'src/alpha/two.mjs', 'W2');
    const frozen = W2.head;
    const expectedRelease = marker;
    const beforeComposition = captureRefSnapshot(fixture.repo, plan);
    git(fixture.repo, 'switch', '-q', 'main');
    const composition = unsafeApplyExactComposition(fixture.repo, {
      targetRef: plan.metadata.release_ref,
      expectedHead: expectedRelease,
      candidate: frozen,
      productExclusionAdmission: admission,
    }).result;
    const completed = {};
    for (const [workId, passed] of [['W1', W1.passed], ['W2', W2.passed]]) {
      const status = mergedWork(passed);
      status.merge.frozen_track_head = frozen;
      status.merge.expected_target = expectedRelease;
      status.merge.observed_target = expectedRelease;
      status.merge.result_commit = composition;
      completed[workId] = status;
    }
    const transfer = unsafeCommitRecordTransition(fixture.repo, {
      ref: plan.metadata.release_ref,
      expectedHead: composition,
      message: 'transfer serial T1',
      recordPathAdmission: admission,
      productExclusionAdmission: admission,
      changes: Object.fromEntries(['W1', 'W2'].map((workId) => [
        workStatusPath(plan, workId),
        `${JSON.stringify(completed[workId])}\n`,
      ])),
    });
    const transferSnapshot = captureRefSnapshot(fixture.repo, plan);
    throwsCode(
      () => validateTrackCompositionTransition(
        fixture.repo,
        plan,
        'T1',
        { W1: W1.passed, W2: W2.passed },
        completed,
        {
          beforeSnapshot: beforeComposition,
          afterSnapshot: transferSnapshot,
          recordRootAdmission: admission,
          profile: 'guided',
        },
      ),
      'EVIDENCE_ADMISSION_REQUIRED',
    );
    assert.deepEqual(
      validateTrackCompositionTransition(
        fixture.repo,
        plan,
        'T1',
        { W1: W1.passed, W2: W2.passed },
        completed,
        {
          beforeSnapshot: beforeComposition,
          afterSnapshot: transferSnapshot,
          recordRootAdmission: admission,
          evidenceAdmissions: {
            W1: evidenceFor(W1.passed),
            W2: evidenceFor(W2.passed),
          },
          profile: 'guided',
        },
      ),
      {
        track_id: 'T1',
        frozen_track_head: frozen,
        composition_commit: composition,
        transfer_commit: transfer,
      },
    );
  } finally {
    fixture.cleanup();
  }
});

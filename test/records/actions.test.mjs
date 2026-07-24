import assert from 'node:assert/strict';
import test from 'node:test';

import { createBatonActions } from '../../reference/records/actions.mjs';
import {
  productTreeIdentity,
  readFileAtOID,
  refExists,
  resolveRef,
  unsafePrepareRecordTransition,
} from '../../reference/records/git.mjs';
import {
  assemblyProofPath,
  assemblyStatusPath,
  captureRefSnapshot,
  digestBytes,
  parsePlanBytes,
  readAuthoritativeRecordSnapshot,
  releasePlanPath,
  selectAssemblyFromSnapshot,
  selectAuthoritativeStatusFromSnapshot,
  workDesignPath,
  workProofPath,
  workStatusPath,
} from '../../reference/records/records.mjs';
import {
  APPROVAL_BYTES,
  DIGESTS,
  DISPATCH_BYTES,
  captainResult,
  clone,
  commitAll,
  designReady,
  git,
  initialWorkStatus,
  makePlanBytes,
  makePlanMetadata,
  proofReady,
  temporaryRepository,
  testProductExclusionAdmission,
  testRecordPathAdmission,
  verified,
  write,
} from './helpers.mjs';

function throwsCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code);
}

function repositoryCommitState(repo) {
  const refs = git(repo, 'for-each-ref', '--format=%(refname) %(objectname)')
    .split('\n')
    .filter(Boolean)
    .sort();
  const commitObjects = git(
    repo,
    'cat-file',
    '--batch-all-objects',
    '--batch-check=%(objecttype) %(objectname)',
  )
    .split('\n')
    .filter((entry) => entry.startsWith('commit '))
    .sort();
  return { refs, commit_objects: commitObjects };
}

function exactRetryWithoutMovement(repo, operation) {
  const before = repositoryCommitState(repo);
  const result = operation();
  assert.deepEqual(repositoryCommitState(repo), before);
  return result;
}

function rejectedWithoutMovement(repo, operation, code) {
  const before = repositoryCommitState(repo);
  throwsCode(operation, code);
  assert.deepEqual(repositoryCommitState(repo), before);
}

function assertJsonOnly(value, label = 'receipt', seen = new Set()) {
  assert.equal(ArrayBuffer.isView(value), false, `${label} contains a typed array`);
  assert.equal(value instanceof ArrayBuffer, false, `${label} contains an ArrayBuffer`);
  if (value === null || typeof value !== 'object') return;
  assert.equal(seen.has(value), false, `${label} contains a cycle`);
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    assertJsonOnly(nested, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

function assertDeepFrozen(value, label = 'receipt', seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  assert.equal(Object.isFrozen(value), true, `${label} is not frozen`);
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    assertDeepFrozen(nested, `${label}.${key}`, seen);
  }
}

function prepareRawRecord(repo, plan, expectedHead, message, changes) {
  return unsafePrepareRecordTransition(repo, {
    expectedHead,
    message,
    recordPathAdmission: testRecordPathAdmission(repo),
    productExclusionAdmission: testProductExclusionAdmission(repo),
    changes,
  }).commit;
}

function encodedStatus(status) {
  return Buffer.from(`${JSON.stringify(status)}\n`);
}

function noncanonicalTwoParent(repo, canonicalCommit, message) {
  const [commit, ...parents] = git(
    repo,
    'rev-list',
    '--parents',
    '-n',
    '1',
    canonicalCommit,
  ).split(' ');
  assert.equal(commit, canonicalCommit);
  assert.equal(parents.length, 2);
  const tree = git(repo, 'rev-parse', `${canonicalCommit}^{tree}`);
  return git(
    repo,
    'commit-tree',
    tree,
    '-p',
    parents[0],
    '-p',
    parents[1],
    '-m',
    message,
  );
}

function oneWorkPlanBytes(mutator = () => {}) {
  const metadata = makePlanMetadata();
  metadata.tracks = [metadata.tracks[0]];
  metadata.tracks[0].work = [metadata.tracks[0].work[0]];
  mutator(metadata);
  return makePlanBytes(metadata);
}

function bindInitialStatus(plan, authority, materialization) {
  const status = initialWorkStatus({
    workId: 'W1',
    trackId: 'T1',
    authority,
    materialization,
  });
  status.plan.digest = plan.digest;
  status.plan.approval.ref = plan.metadata.approval_ref;
  return status;
}

function trustedResolvers(plan, dispatchStatuses = new Map(), evidenceCalls = null) {
  return {
    resolveBehavioralInertness(request) {
      return { ...request, decision: 'inert' };
    },
    resolveEvidence(request) {
      evidenceCalls?.push(structuredClone(request));
      if (request.kind === 'approval') {
        return {
          bytes: APPROVAL_BYTES,
          provenance: {
            kind: 'approval',
            ref: request.ref,
            protected: true,
            decision: 'approved',
            plan_digest: request.plan_digest,
            authorizer_isolated: true,
            delivery_writable: false,
          },
        };
      }
      const status = dispatchStatuses.get(request.ref);
      if (!status) throw new Error(`unknown dispatch ${request.ref}`);
      return {
        bytes: DISPATCH_BYTES,
        provenance: {
          kind: 'verifier_dispatch',
          ref: request.ref,
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
      };
    },
  };
}

function driveOneWorkToPassedAssembly(fixture, plan, actions, dispatchStatuses) {
  actions.installApprovedPlan({ approvalDigest: DIGESTS.b });
  const materialized = actions.materializeTrack({ trackId: 'T1' });
  let current = bindInitialStatus(
    plan,
    plan.metadata.tracks[0].ref,
    { base_commit: materialized.base_commit, dependencies: [] },
  );
  const designBytes = Buffer.from('# W1 design\n');
  current = designReady(current, { digest: digestBytes(designBytes), producer: 'w1-design' });
  actions.recordTransition({
    scope: 'work',
    workId: 'W1',
    result: 'DESIGN_WRITTEN',
    nextStatus: current,
    handoffs: { design: designBytes },
  });
  current = captainResult(current, 'proceed');
  actions.recordTransition({
    scope: 'work',
    workId: 'W1',
    result: 'PROCEED',
    nextStatus: current,
  });
  git(fixture.repo, 'switch', '-q', 'track/v1.0.0/T1');
  write(fixture.repo, 'src/alpha/one.mjs', 'delivered\n');
  const candidate = commitAll(fixture.repo, 'implement W1');
  git(fixture.repo, 'switch', '-q', 'main');
  const admission = testProductExclusionAdmission(fixture.repo);
  const identity = productTreeIdentity(fixture.repo, candidate, admission);
  const proofBytes = Buffer.from('# W1 proof\n');
  current = proofReady(current, {
    digest: digestBytes(proofBytes),
    producer: 'w1-implementer',
    candidate,
    candidateTree: identity.candidateTree,
    productTree: identity.productTree,
  });
  current.proof.base_commit = materialized.base_commit;
  actions.recordTransition({
    scope: 'work',
    workId: 'W1',
    result: 'IMPLEMENTED',
    nextStatus: current,
    handoffs: { proof: proofBytes },
  });
  current = verified(current, 'pass');
  dispatchStatuses.set(current.verification.attestation_ref, clone(current));
  actions.recordTransition({
    scope: 'work',
    workId: 'W1',
    result: 'PASS',
    nextStatus: current,
  });
  actions.composeTrack({ trackId: 'T1' });
  actions.prepareAssembly({
    proofBytes: Buffer.from('# Assembly proof\n'),
    producerInvocation: 'release-merge-assembly',
  });
  const snapshot = captureRefSnapshot(fixture.repo, plan);
  const records = readAuthoritativeRecordSnapshot(
    fixture.repo,
    plan,
    snapshot,
    { recordRootAdmission: testRecordPathAdmission(fixture.repo) },
  );
  const passedAssembly = verified(selectAssemblyFromSnapshot(plan, records).status, 'pass');
  dispatchStatuses.set(passedAssembly.verification.attestation_ref, clone(passedAssembly));
  actions.recordTransition({
    scope: 'assembly',
    result: 'PASS',
    nextStatus: passedAssembly,
  });
}

test('the seven-action facade carries one release through a complete trusted loop', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'base product\n');
    const targetBase = commitAll(fixture.repo, 'base');
    const plan = parsePlanBytes(oneWorkPlanBytes());
    const dispatchStatuses = new Map();
    const actions = createBatonActions({
      repo: fixture.repo,
      plan,
      profile: 'autonomous',
      ...trustedResolvers(plan, dispatchStatuses),
    });

    const installed = actions.installApprovedPlan({ approvalDigest: DIGESTS.b });
    assert.equal(installed.changed, true);
    assert.equal(Object.isFrozen(installed), true);
    assert.equal(Object.isFrozen(installed.after.tracks), true);
    assert.equal(resolveRef(fixture.repo, plan.metadata.target_ref), targetBase);
    const installRetry = exactRetryWithoutMovement(fixture.repo, () => (
      actions.installApprovedPlan({ approvalDigest: DIGESTS.b })
    ));
    assert.equal(installRetry.changed, false);
    assert.equal(installRetry.release_head, installed.release_head);
    const copiedInstall = prepareRawRecord(
      fixture.repo,
      plan,
      installed.release_head,
      'untrusted install namespace copy',
      {
        [`${plan.metadata.record_root}/${plan.metadata.release}/unexpected.txt`]:
          Buffer.from('not plan-bound\n'),
      },
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      copiedInstall,
      installed.release_head,
    );
    rejectedWithoutMovement(
      fixture.repo,
      () => actions.installApprovedPlan({ approvalDigest: DIGESTS.b }),
      'UNBOUND_RECORD_NAMESPACE',
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      installed.release_head,
      copiedInstall,
    );

    const materialized = actions.materializeTrack({ trackId: 'T1' });
    assert.equal(materialized.owner_head, materialized.after.release.head);
    assert.equal(materialized.owner_head, materialized.after.tracks[0].head);
    const materializeRetry = exactRetryWithoutMovement(fixture.repo, () => (
      actions.materializeTrack({ trackId: 'T1' })
    ));
    assert.equal(materializeRetry.changed, false);
    assert.equal(materializeRetry.owner_head, materialized.owner_head);
    assert.equal(materializeRetry.before.release.head, materialized.after.release.head);
    const trackOptionsProxy = new Proxy({ trackId: 'T1' }, {});
    rejectedWithoutMovement(
      fixture.repo,
      () => actions.materializeTrack(trackOptionsProxy),
      'INVALID_ACTION_INPUT',
    );
    let optionGetterReads = 0;
    const accessorOptions = {};
    Object.defineProperty(accessorOptions, 'trackId', {
      enumerable: true,
      get() {
        optionGetterReads += 1;
        return 'T1';
      },
    });
    const symbolOptions = { trackId: 'T1', [Symbol('extra')]: true };
    const nonEnumerableOptions = { trackId: 'T1' };
    Object.defineProperty(nonEnumerableOptions, 'extra', {
      enumerable: false,
      value: true,
    });
    for (const invalidOptions of [
      accessorOptions,
      symbolOptions,
      nonEnumerableOptions,
    ]) {
      rejectedWithoutMovement(
        fixture.repo,
        () => actions.materializeTrack(invalidOptions),
        'INVALID_ACTION_INPUT',
      );
    }
    assert.equal(optionGetterReads, 0);
    let current = bindInitialStatus(
      plan,
      plan.metadata.tracks[0].ref,
      { base_commit: materialized.base_commit, dependencies: [] },
    );
    const copiedMarker = prepareRawRecord(
      fixture.repo,
      plan,
      materialized.owner_head,
      'untrusted copied materialization marker',
      { [workStatusPath(plan, 'W1')]: encodedStatus(current) },
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      copiedMarker,
      materialized.owner_head,
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.tracks[0].ref,
      copiedMarker,
      materialized.owner_head,
    );
    throwsCode(
      () => actions.materializeTrack({ trackId: 'T1' }),
      'ERASED_OWNER_MARKER',
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      materialized.owner_head,
      copiedMarker,
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.tracks[0].ref,
      materialized.owner_head,
      copiedMarker,
    );

    const designBytes = Buffer.from('# W1 design\n');
    current = designReady(current, {
      digest: digestBytes(designBytes),
      producer: 'w1-design',
    });
    for (const invalidWorkId of [null, false, 0, {}, new Date(0)]) {
      rejectedWithoutMovement(
        fixture.repo,
        () => actions.recordTransition({
          scope: 'work',
          workId: invalidWorkId,
          result: 'DESIGN_WRITTEN',
          nextStatus: current,
          handoffs: { design: designBytes },
        }),
        'INVALID_ACTION_INPUT',
      );
    }
    rejectedWithoutMovement(
      fixture.repo,
      () => actions.recordTransition({
        scope: 'work',
        result: 'DESIGN_WRITTEN',
        nextStatus: current,
        handoffs: { design: designBytes },
      }),
      'INVALID_ACTION_INPUT',
    );
    const handoffProxy = new Proxy({ design: designBytes }, {});
    rejectedWithoutMovement(
      fixture.repo,
      () => actions.recordTransition({
        scope: 'work',
        workId: 'W1',
        result: 'DESIGN_WRITTEN',
        nextStatus: current,
        handoffs: handoffProxy,
      }),
      'INVALID_ACTION_INPUT',
    );
    const designed = actions.recordTransition({
      scope: 'work',
      workId: 'W1',
      result: 'DESIGN_WRITTEN',
      nextStatus: current,
      handoffs: { design: designBytes },
    });
    assert.equal(designed.changed, true);
    const designRetry = exactRetryWithoutMovement(fixture.repo, () => (
      actions.recordTransition({
        scope: 'work',
        workId: 'W1',
        result: 'DESIGN_WRITTEN',
        nextStatus: current,
        handoffs: { design: designBytes },
      })
    ));
    assert.equal(designRetry.changed, false);
    assert.equal(designRetry.commit, designed.commit);

    current = captainResult(current, 'proceed');
    const proceeded = actions.recordTransition({
      scope: 'work',
      workId: 'W1',
      result: 'PROCEED',
      nextStatus: current,
    });
    const proceedRetry = exactRetryWithoutMovement(fixture.repo, () => (
      actions.recordTransition({
        scope: 'work',
        workId: 'W1',
        result: 'PROCEED',
        nextStatus: current,
      })
    ));
    assert.equal(proceedRetry.changed, false);
    assert.equal(proceedRetry.commit, proceeded.commit);

    git(fixture.repo, 'switch', '-q', 'track/v1.0.0/T1');
    write(fixture.repo, 'src/alpha/one.mjs', 'delivered\n');
    const candidate = commitAll(fixture.repo, 'implement W1');
    git(fixture.repo, 'switch', '-q', 'main');
    const admission = testProductExclusionAdmission(fixture.repo);
    const identity = productTreeIdentity(fixture.repo, candidate, admission);
    const proofBytes = Buffer.from('# W1 proof\n');
    current = proofReady(current, {
      digest: digestBytes(proofBytes),
      producer: 'w1-implementer',
      candidate,
      candidateTree: identity.candidateTree,
      productTree: identity.productTree,
    });
    current.proof.base_commit = materialized.base_commit;
    const implemented = actions.recordTransition({
      scope: 'work',
      workId: 'W1',
      result: 'IMPLEMENTED',
      nextStatus: current,
      handoffs: { proof: proofBytes },
    });
    const implementedRetry = exactRetryWithoutMovement(fixture.repo, () => (
      actions.recordTransition({
        scope: 'work',
        workId: 'W1',
        result: 'IMPLEMENTED',
        nextStatus: current,
        handoffs: { proof: proofBytes },
      })
    ));
    assert.equal(implementedRetry.changed, false);
    assert.equal(implementedRetry.commit, implemented.commit);
    const noVerdict = exactRetryWithoutMovement(fixture.repo, () => (
      actions.recordTransition({
        scope: 'work',
        workId: 'W1',
        result: 'NO_VERDICT',
        nextStatus: clone(current),
      })
    ));
    assert.equal(noVerdict.changed, false);
    assert.equal(noVerdict.before.tracks[0].head, noVerdict.after.tracks[0].head);

    current = verified(current, 'pass');
    dispatchStatuses.set(current.verification.attestation_ref, clone(current));
    const passed = actions.recordTransition({
      scope: 'work',
      workId: 'W1',
      result: 'PASS',
      nextStatus: current,
    });
    const passRetry = exactRetryWithoutMovement(fixture.repo, () => (
      actions.recordTransition({
        scope: 'work',
        workId: 'W1',
        result: 'PASS',
        nextStatus: current,
      })
    ));
    assert.equal(passRetry.changed, false);
    assert.equal(passRetry.commit, passed.commit);

    const releaseBeforeAdvance = resolveRef(fixture.repo, plan.metadata.release_ref);
    const releaseAdvance = prepareRawRecord(
      fixture.repo,
      plan,
      releaseBeforeAdvance,
      'independent release advance before composition',
      {
        [`${plan.metadata.record_root}/composition-base.txt`]:
          Buffer.from('force deterministic two-parent composition\n'),
      },
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      releaseAdvance,
      releaseBeforeAdvance,
    );
    const composed = actions.composeTrack({ trackId: 'T1' });
    assert.equal(composed.frozen_track_head, composed.before.tracks[0].head);
    assert.equal(composed.transfer_commit, composed.after.release.head);
    const composeRetry = exactRetryWithoutMovement(fixture.repo, () => (
      actions.composeTrack({ trackId: 'T1' })
    ));
    assert.equal(composeRetry.changed, false);
    assert.equal(composeRetry.transfer_commit, composed.transfer_commit);
    const composedSnapshot = captureRefSnapshot(fixture.repo, plan);
    const composedRecords = readAuthoritativeRecordSnapshot(
      fixture.repo,
      plan,
      composedSnapshot,
      { recordRootAdmission: testRecordPathAdmission(fixture.repo) },
    );
    const canonicalComposedStatus = selectAuthoritativeStatusFromSnapshot(
      plan,
      'W1',
      composedRecords,
    ).status;
    const forgedComposition = noncanonicalTwoParent(
      fixture.repo,
      composed.composition_commit,
      'noncanonical composition result',
    );
    assert.notEqual(forgedComposition, composed.composition_commit);
    const forgedComposedStatus = clone(canonicalComposedStatus);
    forgedComposedStatus.merge.result_commit = forgedComposition;
    const forgedTransfer = prepareRawRecord(
      fixture.repo,
      plan,
      forgedComposition,
      'Transfer composed Baton track T1',
      { [workStatusPath(plan, 'W1')]: encodedStatus(forgedComposedStatus) },
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      forgedTransfer,
      composedSnapshot.release.head,
    );
    throwsCode(
      () => actions.composeTrack({ trackId: 'T1' }),
      'INVALID_RECONCILIATION',
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      composedSnapshot.release.head,
      forgedTransfer,
    );
    const copiedComposition = prepareRawRecord(
      fixture.repo,
      plan,
      composedSnapshot.release.head,
      'untrusted copied composition result',
      {
        [workStatusPath(plan, 'W1')]: encodedStatus(canonicalComposedStatus),
      },
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      copiedComposition,
      composedSnapshot.release.head,
    );
    throwsCode(
      () => actions.composeTrack({ trackId: 'T1' }),
      'UNEXPECTED_RECORD_TRANSITION',
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      composedSnapshot.release.head,
      copiedComposition,
    );
    const siblingComposition = prepareRawRecord(
      fixture.repo,
      plan,
      composed.composition_commit,
      'noncanonical composition transfer message',
      {
        [workStatusPath(plan, 'W1')]: encodedStatus(canonicalComposedStatus),
      },
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      siblingComposition,
      composedSnapshot.release.head,
    );
    throwsCode(
      () => actions.composeTrack({ trackId: 'T1' }),
      'INVALID_RECONCILIATION',
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      composedSnapshot.release.head,
      siblingComposition,
    );

    const prepared = actions.prepareAssembly({
      proofBytes: Buffer.from('# Assembly proof\n'),
      producerInvocation: 'release-merge-assembly',
    });
    assert.equal(prepared.assembly_candidate, composed.after.release.head);
    const prepareRetry = exactRetryWithoutMovement(fixture.repo, () => (
      actions.prepareAssembly({
        proofBytes: Buffer.from('# Assembly proof\n'),
        producerInvocation: 'release-merge-assembly',
      })
    ));
    assert.equal(prepareRetry.changed, false);
    assert.equal(prepareRetry.preparation_commit, prepared.preparation_commit);
    const preparedSnapshot = captureRefSnapshot(fixture.repo, plan);
    const preparedRecords = readAuthoritativeRecordSnapshot(
      fixture.repo,
      plan,
      preparedSnapshot,
      { recordRootAdmission: testRecordPathAdmission(fixture.repo) },
    );
    const copiedPreparation = prepareRawRecord(
      fixture.repo,
      plan,
      preparedSnapshot.release.head,
      'untrusted copied assembly preparation',
      {
        [assemblyStatusPath(plan)]: encodedStatus(
          selectAssemblyFromSnapshot(plan, preparedRecords).status,
        ),
      },
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      copiedPreparation,
      preparedSnapshot.release.head,
    );
    throwsCode(
      () => actions.prepareAssembly({
        proofBytes: Buffer.from('# Assembly proof\n'),
        producerInvocation: 'release-merge-assembly',
      }),
      'UNEXPECTED_RECORD_TRANSITION',
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      preparedSnapshot.release.head,
      copiedPreparation,
    );
    const assemblyProofBytes = Buffer.from('# Assembly proof\n');
    const siblingPreparation = prepareRawRecord(
      fixture.repo,
      plan,
      prepared.assembly_candidate,
      'noncanonical assembly preparation message',
      {
        [assemblyProofPath(plan)]: assemblyProofBytes,
        [assemblyStatusPath(plan)]: encodedStatus(
          selectAssemblyFromSnapshot(plan, preparedRecords).status,
        ),
      },
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      siblingPreparation,
      preparedSnapshot.release.head,
    );
    throwsCode(
      () => actions.prepareAssembly({
        proofBytes: assemblyProofBytes,
        producerInvocation: 'release-merge-assembly',
      }),
      'INVALID_RECONCILIATION',
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      preparedSnapshot.release.head,
      siblingPreparation,
    );
    const assemblySnapshot = captureRefSnapshot(fixture.repo, plan);
    const assemblyRecords = readAuthoritativeRecordSnapshot(
      fixture.repo,
      plan,
      assemblySnapshot,
      { recordRootAdmission: testRecordPathAdmission(fixture.repo) },
    );
    const assembly = selectAssemblyFromSnapshot(plan, assemblyRecords).status;
    const passedAssembly = verified(assembly, 'pass');
    dispatchStatuses.set(
      passedAssembly.verification.attestation_ref,
      clone(passedAssembly),
    );
    let workIdDescriptorReads = 0;
    const statefulAssemblyOptions = new Proxy({
      scope: 'assembly',
      workId: new Date(0),
      result: 'PASS',
      nextStatus: passedAssembly,
    }, {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'workId') {
          workIdDescriptorReads += 1;
          if (workIdDescriptorReads > 1) return undefined;
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    rejectedWithoutMovement(
      fixture.repo,
      () => actions.recordTransition(statefulAssemblyOptions),
      'INVALID_ACTION_INPUT',
    );
    assert.equal(workIdDescriptorReads, 0);
    const frozenNestedWorkId = Object.freeze({
      nested: { remains_caller_owned: true },
    });
    for (const invalidAssemblyWorkId of [
      new Date(0),
      frozenNestedWorkId,
      {},
      null,
      false,
      0,
      undefined,
    ]) {
      rejectedWithoutMovement(
        fixture.repo,
        () => actions.recordTransition({
          scope: 'assembly',
          workId: invalidAssemblyWorkId,
          result: 'PASS',
          nextStatus: passedAssembly,
        }),
        'INVALID_ACTION_INPUT',
      );
    }
    assert.equal(Object.isFrozen(frozenNestedWorkId.nested), false);
    const originalWorkId = Object.getOwnPropertyDescriptor(Object.prototype, 'workId');
    const originalHandoffs = Object.getOwnPropertyDescriptor(Object.prototype, 'handoffs');
    let assemblyPassed;
    let assemblyPassRetry;
    let inheritedHandoffsRetry;
    try {
      Object.defineProperty(Object.prototype, 'workId', {
        configurable: true,
        value: new Date(0),
      });
      assemblyPassed = actions.recordTransition({
        scope: 'assembly',
        result: 'PASS',
        nextStatus: passedAssembly,
      });
      assert.equal(assemblyPassed.work_id, null);
      assemblyPassRetry = exactRetryWithoutMovement(fixture.repo, () => (
        actions.recordTransition({
          scope: 'assembly',
          result: 'PASS',
          nextStatus: passedAssembly,
        })
      ));
      assert.equal(assemblyPassRetry.changed, false);
      assert.equal(assemblyPassRetry.commit, assemblyPassed.commit);

      Object.defineProperty(Object.prototype, 'handoffs', {
        configurable: true,
        value: new Date(0),
      });
      inheritedHandoffsRetry = exactRetryWithoutMovement(fixture.repo, () => (
        actions.recordTransition({
          scope: 'assembly',
          result: 'PASS',
          nextStatus: passedAssembly,
        })
      ));
      assert.equal(inheritedHandoffsRetry.changed, false);
      assert.equal(inheritedHandoffsRetry.commit, assemblyPassed.commit);
    } finally {
      if (originalHandoffs) {
        Object.defineProperty(Object.prototype, 'handoffs', originalHandoffs);
      } else {
        delete Object.prototype.handoffs;
      }
      if (originalWorkId) {
        Object.defineProperty(Object.prototype, 'workId', originalWorkId);
      } else {
        delete Object.prototype.workId;
      }
    }

    write(fixture.repo, 'target-note.txt', 'independent target advance\n');
    const targetAdvance = commitAll(fixture.repo, 'advance target before integration');
    rejectedWithoutMovement(
      fixture.repo,
      () => actions.integrateRelease(new Date(0)),
      'INVALID_ACTION_INPUT',
    );
    const integrated = actions.integrateRelease();
    assert.equal(integrated.before.target.head, targetAdvance);
    assert.equal(integrated.integration_commit, integrated.after.target.head);
    assert.equal(integrated.status_commit, integrated.after.release.head);
    assert.equal(Object.isFrozen(integrated.after), true);
    assert.equal(resolveRef(fixture.repo, plan.metadata.target_ref), integrated.integration_commit);
    const integrateRetry = exactRetryWithoutMovement(fixture.repo, () => (
      actions.integrateRelease()
    ));
    assert.equal(integrateRetry.changed, false);
    assert.equal(integrateRetry.integration_commit, integrated.integration_commit);
    assert.equal(integrateRetry.status_commit, integrated.status_commit);
    const integratedSnapshot = captureRefSnapshot(fixture.repo, plan);
    const integratedRecords = readAuthoritativeRecordSnapshot(
      fixture.repo,
      plan,
      integratedSnapshot,
      { recordRootAdmission: testRecordPathAdmission(fixture.repo) },
    );
    const canonicalIntegratedStatus = selectAssemblyFromSnapshot(
      plan,
      integratedRecords,
    ).status;
    const forgedIntegrationResult = noncanonicalTwoParent(
      fixture.repo,
      integrated.integration_commit,
      'noncanonical integration result',
    );
    assert.notEqual(forgedIntegrationResult, integrated.integration_commit);
    const forgedIntegratedStatus = clone(canonicalIntegratedStatus);
    forgedIntegratedStatus.merge.result_commit = forgedIntegrationResult;
    const forgedFinalStatus = prepareRawRecord(
      fixture.repo,
      plan,
      assemblyPassed.commit,
      `Integrate Baton release ${plan.metadata.release}`,
      { [assemblyStatusPath(plan)]: encodedStatus(forgedIntegratedStatus) },
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.target_ref,
      forgedIntegrationResult,
      integratedSnapshot.target.head,
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      forgedFinalStatus,
      integratedSnapshot.release.head,
    );
    rejectedWithoutMovement(
      fixture.repo,
      () => actions.integrateRelease(),
      'INVALID_RECONCILIATION',
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      integratedSnapshot.release.head,
      forgedFinalStatus,
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.target_ref,
      integratedSnapshot.target.head,
      forgedIntegrationResult,
    );
    const copiedIntegration = prepareRawRecord(
      fixture.repo,
      plan,
      integratedSnapshot.release.head,
      'untrusted copied integration result',
      {
        [assemblyStatusPath(plan)]: encodedStatus(canonicalIntegratedStatus),
      },
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      copiedIntegration,
      integratedSnapshot.release.head,
    );
    throwsCode(
      () => actions.integrateRelease(),
      'TERMINAL_REWRITE',
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      integratedSnapshot.release.head,
      copiedIntegration,
    );
    const siblingIntegration = prepareRawRecord(
      fixture.repo,
      plan,
      assemblyPassed.commit,
      'noncanonical integration status message',
      {
        [assemblyStatusPath(plan)]: encodedStatus(canonicalIntegratedStatus),
      },
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      siblingIntegration,
      integratedSnapshot.release.head,
    );
    throwsCode(
      () => actions.integrateRelease(),
      'INVALID_RECONCILIATION',
    );
    git(
      fixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      integratedSnapshot.release.head,
      siblingIntegration,
    );
    for (const actionReceipt of [
      installed,
      installRetry,
      materialized,
      materializeRetry,
      designed,
      designRetry,
      proceeded,
      proceedRetry,
      implemented,
      implementedRetry,
      noVerdict,
      passed,
      passRetry,
      composed,
      composeRetry,
      prepared,
      prepareRetry,
      assemblyPassed,
      assemblyPassRetry,
      inheritedHandoffsRetry,
      integrated,
      integrateRetry,
    ]) {
      assertJsonOnly(actionReceipt);
      assertDeepFrozen(actionReceipt);
    }
  } finally {
    fixture.cleanup();
  }
});

test('install target contention leaves no release and work order fails before a record write', () => {
  const contended = temporaryRepository();
  try {
    write(contended.repo, 'README.md', 'base product\n');
    const base = commitAll(contended.repo, 'base');
    const tree = git(contended.repo, 'rev-parse', `${base}^{tree}`);
    const contender = git(
      contended.repo,
      'commit-tree',
      tree,
      '-p',
      base,
      '-m',
      'concurrent target',
    );
    const plan = parsePlanBytes(oneWorkPlanBytes());
    const resolvers = trustedResolvers(plan);
    let moved = false;
    const actions = createBatonActions({
      repo: contended.repo,
      plan,
      profile: 'autonomous',
      resolveEvidence: resolvers.resolveEvidence,
      resolveBehavioralInertness(request) {
        if (request.commit !== base && !moved) {
          git(
            contended.repo,
            'update-ref',
            plan.metadata.target_ref,
            contender,
            base,
          );
          moved = true;
        }
        return { ...request, decision: 'inert' };
      },
    });
    throwsCode(
      () => actions.installApprovedPlan({ approvalDigest: DIGESTS.b }),
      'ATOMIC_REF_UPDATE_FAILED',
    );
    assert.equal(resolveRef(contended.repo, plan.metadata.target_ref), contender);
    assert.equal(refExists(contended.repo, plan.metadata.release_ref), false);
  } finally {
    contended.cleanup();
  }

  const unboundInstall = temporaryRepository();
  try {
    write(unboundInstall.repo, 'README.md', 'base product\n');
    write(
      unboundInstall.repo,
      '.baton/releases/v1.0.0/unbound.txt',
      'stale release data\n',
    );
    commitAll(unboundInstall.repo, 'base with unbound release namespace');
    const plan = parsePlanBytes(oneWorkPlanBytes());
    const actions = createBatonActions({
      repo: unboundInstall.repo,
      plan,
      profile: 'guided',
      ...trustedResolvers(plan),
    });
    rejectedWithoutMovement(
      unboundInstall.repo,
      () => actions.installApprovedPlan({ approvalDigest: DIGESTS.b }),
      'UNBOUND_RECORD_NAMESPACE',
    );
    assert.equal(refExists(unboundInstall.repo, plan.metadata.release_ref), false);
  } finally {
    unboundInstall.cleanup();
  }

  const ordered = temporaryRepository();
  try {
    write(ordered.repo, 'README.md', 'base product\n');
    commitAll(ordered.repo, 'base');
    const metadata = makePlanMetadata();
    metadata.tracks = [metadata.tracks[0]];
    const plan = parsePlanBytes(makePlanBytes(metadata));
    const evidenceCalls = [];
    const actions = createBatonActions({
      repo: ordered.repo,
      plan,
      profile: 'guided',
      ...trustedResolvers(plan, new Map(), evidenceCalls),
    });
    actions.installApprovedPlan({ approvalDigest: DIGESTS.b });
    assert.equal(evidenceCalls.filter((request) => request.kind === 'approval').length, 1);
    const materialized = actions.materializeTrack({ trackId: 'T1' });
    const ownerHead = materialized.owner_head;
    const preflightRelease = resolveRef(ordered.repo, plan.metadata.release_ref);
    throwsCode(
      () => actions.prepareAssembly({
        proofBytes: Buffer.from('# premature assembly\n'),
        producerInvocation: 'premature-merge',
      }),
      'INCOMPLETE_ASSEMBLY',
    );
    assert.equal(resolveRef(ordered.repo, plan.metadata.release_ref), preflightRelease);

    const W1 = bindInitialStatus(
      plan,
      plan.metadata.tracks[0].ref,
      { base_commit: materialized.base_commit, dependencies: [] },
    );
    const W1DesignBytes = Buffer.from('# W1 design\n');
    const designedW1 = designReady(W1, { digest: digestBytes(W1DesignBytes) });
    throwsCode(
      () => actions.recordTransition({
        scope: 'work',
        workId: 'W1',
        result: 'DESIGN_WRITTEN',
        nextStatus: designedW1,
        handoffs: { design: Buffer.from('wrong bytes\n') },
      }),
      'HANDOFF_DIGEST_MISMATCH',
    );
    assert.equal(resolveRef(ordered.repo, plan.metadata.tracks[0].ref), ownerHead);

    const W2 = initialWorkStatus({
      workId: 'W2',
      trackId: 'T1',
      authority: plan.metadata.tracks[0].ref,
      materialization: { base_commit: materialized.base_commit, dependencies: [] },
    });
    W2.plan.digest = plan.digest;
    W2.plan.approval.ref = plan.metadata.approval_ref;
    const W2DesignBytes = Buffer.from('# W2 design\n');
    const designedW2 = designReady(W2, { digest: digestBytes(W2DesignBytes) });
    throwsCode(
      () => actions.recordTransition({
        scope: 'work',
        workId: 'W2',
        result: 'DESIGN_WRITTEN',
        nextStatus: designedW2,
        handoffs: { design: W2DesignBytes },
      }),
      'OUT_OF_ORDER_WORK',
    );
    assert.equal(resolveRef(ordered.repo, plan.metadata.tracks[0].ref), ownerHead);

    const hostileW2 = prepareRawRecord(
      ordered.repo,
      plan,
      ownerHead,
      'hostile out-of-order W2 retry state',
      {
        [workDesignPath(plan, 'W2')]: W2DesignBytes,
        [workStatusPath(plan, 'W2')]: encodedStatus(designedW2),
      },
    );
    git(
      ordered.repo,
      'update-ref',
      plan.metadata.tracks[0].ref,
      hostileW2,
      ownerHead,
    );
    throwsCode(
      () => actions.recordTransition({
        scope: 'work',
        workId: 'W2',
        result: 'DESIGN_WRITTEN',
        nextStatus: designedW2,
        handoffs: { design: W2DesignBytes },
      }),
      'OUT_OF_ORDER_WORK',
    );
    assert.equal(resolveRef(ordered.repo, plan.metadata.tracks[0].ref), hostileW2);

    throwsCode(
      () => createBatonActions({
        repo: ordered.repo,
        plan,
        profile: 'guided',
        resolveEvidence: trustedResolvers(plan).resolveEvidence,
      }),
      'RECORD_ROOT_POLICY_REQUIRED',
    );
  } finally {
    ordered.cleanup();
  }
});

test('materialization contention cannot partially advance the release ref', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'base product\n');
    commitAll(fixture.repo, 'base');
    const plan = parsePlanBytes(oneWorkPlanBytes());
    const evidence = trustedResolvers(plan);
    let installedHead;
    let contend = false;
    let injected = false;
    const actions = createBatonActions({
      repo: fixture.repo,
      plan,
      profile: 'autonomous',
      resolveEvidence: evidence.resolveEvidence,
      resolveBehavioralInertness(request) {
        if (
          contend
          && !injected
          && request.commit !== installedHead
        ) {
          git(
            fixture.repo,
            'update-ref',
            plan.metadata.tracks[0].ref,
            installedHead,
          );
          injected = true;
        }
        return { ...request, decision: 'inert' };
      },
    });
    installedHead = actions.installApprovedPlan({ approvalDigest: DIGESTS.b }).release_head;
    contend = true;
    throwsCode(
      () => actions.materializeTrack({ trackId: 'T1' }),
      'ATOMIC_REF_UPDATE_FAILED',
    );
    assert.equal(resolveRef(fixture.repo, plan.metadata.release_ref), installedHead);
    assert.equal(resolveRef(fixture.repo, plan.metadata.tracks[0].ref), installedHead);
  } finally {
    fixture.cleanup();
  }
});

test('record reconciliation rejects ineligible unchanged and copied durable states', () => {
  const workFixture = temporaryRepository();
  try {
    write(workFixture.repo, 'README.md', 'base product\n');
    commitAll(workFixture.repo, 'base');
    const plan = parsePlanBytes(oneWorkPlanBytes());
    const actions = createBatonActions({
      repo: workFixture.repo,
      plan,
      profile: 'guided',
      ...trustedResolvers(plan),
    });
    actions.installApprovedPlan({ approvalDigest: DIGESTS.b });
    const materialized = actions.materializeTrack({ trackId: 'T1' });
    let current = bindInitialStatus(
      plan,
      plan.metadata.tracks[0].ref,
      { base_commit: materialized.base_commit, dependencies: [] },
    );
    throwsCode(
      () => actions.recordTransition({
        scope: 'work',
        workId: 'W1',
        result: 'NO_VERDICT',
        nextStatus: current,
      }),
      'INVALID_RECONCILIATION',
    );

    git(workFixture.repo, 'switch', '-q', 'track/v1.0.0/T1');
    write(workFixture.repo, 'src/alpha/one.mjs', 'product before authority\n');
    const prematureCandidate = commitAll(workFixture.repo, 'premature product candidate');
    git(workFixture.repo, 'switch', '-q', 'main');

    const designBytes = Buffer.from('# W1 design\n');
    current = designReady(current, {
      digest: digestBytes(designBytes),
      producer: 'late-design',
    });
    actions.recordTransition({
      scope: 'work',
      workId: 'W1',
      result: 'DESIGN_WRITTEN',
      nextStatus: current,
      handoffs: { design: designBytes },
    });
    current = captainResult(current, 'proceed');
    actions.recordTransition({
      scope: 'work',
      workId: 'W1',
      result: 'PROCEED',
      nextStatus: current,
    });

    const identity = productTreeIdentity(
      workFixture.repo,
      prematureCandidate,
      testProductExclusionAdmission(workFixture.repo),
    );
    const proofBytes = Buffer.from('# Premature proof\n');
    current = proofReady(current, {
      digest: digestBytes(proofBytes),
      producer: 'untrusted-retry-state',
      candidate: prematureCandidate,
      candidateTree: identity.candidateTree,
      productTree: identity.productTree,
    });
    current.proof.base_commit = materialized.base_commit;
    const beforeRawProof = resolveRef(workFixture.repo, plan.metadata.tracks[0].ref);
    const rawProofCommit = prepareRawRecord(
      workFixture.repo,
      plan,
      beforeRawProof,
      'untrusted copied implemented state',
      {
        [workProofPath(plan, 'W1')]: proofBytes,
        [workStatusPath(plan, 'W1')]: encodedStatus(current),
      },
    );
    git(
      workFixture.repo,
      'update-ref',
      plan.metadata.tracks[0].ref,
      rawProofCommit,
      beforeRawProof,
    );
    throwsCode(
      () => actions.recordTransition({
        scope: 'work',
        workId: 'W1',
        result: 'IMPLEMENTED',
        nextStatus: current,
        handoffs: { proof: proofBytes },
      }),
      'PRODUCT_BEFORE_PROCEED',
    );
    assert.equal(
      resolveRef(workFixture.repo, plan.metadata.tracks[0].ref),
      rawProofCommit,
    );
  } finally {
    workFixture.cleanup();
  }

  const assemblyFixture = temporaryRepository();
  try {
    write(assemblyFixture.repo, 'README.md', 'base product\n');
    commitAll(assemblyFixture.repo, 'base');
    const plan = parsePlanBytes(oneWorkPlanBytes());
    const dispatchStatuses = new Map();
    const actions = createBatonActions({
      repo: assemblyFixture.repo,
      plan,
      profile: 'autonomous',
      ...trustedResolvers(plan, dispatchStatuses),
    });
    driveOneWorkToPassedAssembly(assemblyFixture, plan, actions, dispatchStatuses);
    const snapshot = captureRefSnapshot(assemblyFixture.repo, plan);
    const records = readAuthoritativeRecordSnapshot(
      assemblyFixture.repo,
      plan,
      snapshot,
      { recordRootAdmission: testRecordPathAdmission(assemblyFixture.repo) },
    );
    const passed = selectAssemblyFromSnapshot(plan, records).status;
    const copied = prepareRawRecord(
      assemblyFixture.repo,
      plan,
      snapshot.release.head,
      'untrusted copied assembly PASS',
      { [assemblyStatusPath(plan)]: encodedStatus(passed) },
    );
    git(
      assemblyFixture.repo,
      'update-ref',
      plan.metadata.release_ref,
      copied,
      snapshot.release.head,
    );
    throwsCode(
      () => actions.recordTransition({
        scope: 'assembly',
        result: 'PASS',
        nextStatus: passed,
      }),
      'INVALID_TRANSITION',
    );
    assert.equal(resolveRef(assemblyFixture.repo, plan.metadata.release_ref), copied);
  } finally {
    assemblyFixture.cleanup();
  }
});

test('integration contention cannot partially advance the target ref', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'base product\n');
    commitAll(fixture.repo, 'base');
    const plan = parsePlanBytes(oneWorkPlanBytes());
    const dispatchStatuses = new Map();
    const evidence = trustedResolvers(plan, dispatchStatuses);
    let hook;
    const actions = createBatonActions({
      repo: fixture.repo,
      plan,
      profile: 'autonomous',
      resolveEvidence: evidence.resolveEvidence,
      resolveBehavioralInertness(request) {
        hook?.(request);
        return { ...request, decision: 'inert' };
      },
    });
    driveOneWorkToPassedAssembly(fixture, plan, actions, dispatchStatuses);
    const targetBefore = resolveRef(fixture.repo, plan.metadata.target_ref);
    const releaseBefore = resolveRef(fixture.repo, plan.metadata.release_ref);
    const releaseTree = git(fixture.repo, 'rev-parse', `${releaseBefore}^{tree}`);
    const contender = git(
      fixture.repo,
      'commit-tree',
      releaseTree,
      '-p',
      releaseBefore,
      '-m',
      'concurrent release writer',
    );
    let injected = false;
    hook = () => {
      if (injected) return;
      git(
        fixture.repo,
        'update-ref',
        plan.metadata.release_ref,
        contender,
        releaseBefore,
      );
      injected = true;
    };
    throwsCode(() => actions.integrateRelease(), 'ATOMIC_REF_UPDATE_FAILED');
    assert.equal(resolveRef(fixture.repo, plan.metadata.target_ref), targetBefore);
    assert.equal(resolveRef(fixture.repo, plan.metadata.release_ref), contender);
  } finally {
    fixture.cleanup();
  }
});

test('pristine plans rebound only across an identical topology', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'base product\n');
    commitAll(fixture.repo, 'base');
    const previousPlan = parsePlanBytes(oneWorkPlanBytes());
    const previousActions = createBatonActions({
      repo: fixture.repo,
      plan: previousPlan,
      profile: 'guided',
      ...trustedResolvers(previousPlan),
    });
    previousActions.installApprovedPlan({ approvalDigest: DIGESTS.b });

    const nextPlan = parsePlanBytes(oneWorkPlanBytes((metadata) => {
      metadata.tracks[0].work[0].outcome = 'A clarified approved outcome';
    }));
    const nextActions = createBatonActions({
      repo: fixture.repo,
      plan: nextPlan,
      profile: 'guided',
      ...trustedResolvers(nextPlan),
    });
    const pristineHead = resolveRef(fixture.repo, previousPlan.metadata.release_ref);
    const staleNamespaceCases = [
      [
        workDesignPath(previousPlan, 'W1'),
        Buffer.from('# stale design\n'),
      ],
      [
        workProofPath(previousPlan, 'W1'),
        Buffer.from('# stale proof\n'),
      ],
      [
        assemblyStatusPath(previousPlan),
        Buffer.from('stale assembly status\n'),
      ],
      [
        assemblyProofPath(previousPlan),
        Buffer.from('# stale assembly proof\n'),
      ],
      [
        `${previousPlan.metadata.record_root}/${previousPlan.metadata.release}/unknown.bin`,
        Buffer.from([0x00, 0x01, 0x02]),
      ],
    ];
    for (const [relativePath, bytes] of staleNamespaceCases) {
      const unbound = prepareRawRecord(
        fixture.repo,
        previousPlan,
        pristineHead,
        `untrusted pristine namespace ${relativePath}`,
        { [relativePath]: bytes },
      );
      git(
        fixture.repo,
        'update-ref',
        previousPlan.metadata.release_ref,
        unbound,
        pristineHead,
      );
      rejectedWithoutMovement(
        fixture.repo,
        () => nextActions.reboundPristinePlan({
          previousPlan,
          approvalDigest: DIGESTS.b,
        }),
        'UNBOUND_RECORD_NAMESPACE',
      );
      git(
        fixture.repo,
        'update-ref',
        previousPlan.metadata.release_ref,
        pristineHead,
        unbound,
      );
    }
    const rebound = nextActions.reboundPristinePlan({
      previousPlan,
      approvalDigest: DIGESTS.b,
    });
    assert.equal(rebound.changed, true);
    const reboundRetry = exactRetryWithoutMovement(fixture.repo, () => (
      nextActions.reboundPristinePlan({
        previousPlan,
        approvalDigest: DIGESTS.b,
      })
    ));
    assert.equal(reboundRetry.changed, false);
    assert.equal(reboundRetry.release_head, rebound.release_head);
    assertJsonOnly(rebound);
    assertJsonOnly(reboundRetry);
    const installed = parsePlanBytes(
      readFileAtOID(
        fixture.repo,
        rebound.after.release.head,
        releasePlanPath(nextPlan),
      ),
    );
    assert.equal(installed.digest, nextPlan.digest);
    const currentSnapshot = captureRefSnapshot(fixture.repo, nextPlan);
    const currentRecords = readAuthoritativeRecordSnapshot(
      fixture.repo,
      nextPlan,
      currentSnapshot,
      { recordRootAdmission: testRecordPathAdmission(fixture.repo) },
    );
    const copiedRebound = prepareRawRecord(
      fixture.repo,
      nextPlan,
      currentSnapshot.release.head,
      'untrusted copied rebound state',
      {
        [workStatusPath(nextPlan, 'W1')]: encodedStatus(
          selectAuthoritativeStatusFromSnapshot(nextPlan, 'W1', currentRecords).status,
        ),
      },
    );
    git(
      fixture.repo,
      'update-ref',
      nextPlan.metadata.release_ref,
      copiedRebound,
      currentSnapshot.release.head,
    );
    throwsCode(
      () => nextActions.reboundPristinePlan({
        previousPlan,
        approvalDigest: DIGESTS.b,
      }),
      'INVALID_RECONCILIATION',
    );
    git(
      fixture.repo,
      'update-ref',
      nextPlan.metadata.release_ref,
      currentSnapshot.release.head,
      copiedRebound,
    );

    const incompatiblePlan = parsePlanBytes(oneWorkPlanBytes((metadata) => {
      metadata.target_ref = 'refs/heads/production';
    }));
    const incompatible = createBatonActions({
      repo: fixture.repo,
      plan: incompatiblePlan,
      profile: 'guided',
      ...trustedResolvers(incompatiblePlan),
    });
    throwsCode(
      () => incompatible.reboundPristinePlan({
        previousPlan: nextPlan,
        approvalDigest: DIGESTS.b,
      }),
      'EXTERNAL_AUTHORITY_REQUIRED',
    );
  } finally {
    fixture.cleanup();
  }
});

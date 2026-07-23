import assert from 'node:assert/strict';
import test from 'node:test';

import { createBatonActions } from '../../reference/records/actions.mjs';
import {
  productTreeIdentity,
  readFileAtOID,
  refExists,
  resolveRef,
} from '../../reference/records/git.mjs';
import {
  captureRefSnapshot,
  digestBytes,
  parsePlanBytes,
  readAuthoritativeRecordSnapshot,
  releasePlanPath,
  selectAssemblyFromSnapshot,
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

    const materialized = actions.materializeTrack({ trackId: 'T1' });
    assert.equal(materialized.owner_head, materialized.after.release.head);
    assert.equal(materialized.owner_head, materialized.after.tracks[0].head);
    const materializeRetry = exactRetryWithoutMovement(fixture.repo, () => (
      actions.materializeTrack({ trackId: 'T1' })
    ));
    assert.equal(materializeRetry.changed, false);
    assert.equal(materializeRetry.owner_head, materialized.owner_head);
    assert.equal(materializeRetry.before.release.head, materialized.after.release.head);
    let current = bindInitialStatus(
      plan,
      plan.metadata.tracks[0].ref,
      { base_commit: materialized.base_commit, dependencies: [] },
    );

    const designBytes = Buffer.from('# W1 design\n');
    current = designReady(current, {
      digest: digestBytes(designBytes),
      producer: 'w1-design',
    });
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

    const composed = actions.composeTrack({ trackId: 'T1' });
    assert.equal(composed.frozen_track_head, composed.before.tracks[0].head);
    assert.equal(composed.transfer_commit, composed.after.release.head);
    const composeRetry = exactRetryWithoutMovement(fixture.repo, () => (
      actions.composeTrack({ trackId: 'T1' })
    ));
    assert.equal(composeRetry.changed, false);
    assert.equal(composeRetry.transfer_commit, composed.transfer_commit);

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
    const assemblyPassed = actions.recordTransition({
      scope: 'assembly',
      result: 'PASS',
      nextStatus: passedAssembly,
    });
    const assemblyPassRetry = exactRetryWithoutMovement(fixture.repo, () => (
      actions.recordTransition({
        scope: 'assembly',
        result: 'PASS',
        nextStatus: passedAssembly,
      })
    ));
    assert.equal(assemblyPassRetry.changed, false);
    assert.equal(assemblyPassRetry.commit, assemblyPassed.commit);

    const integrated = actions.integrateRelease();
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
      integrated,
      integrateRetry,
    ]) {
      assertJsonOnly(actionReceipt);
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

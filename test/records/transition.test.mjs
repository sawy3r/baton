import assert from 'node:assert/strict';
import test from 'node:test';

import { validateStatusSemantics } from '../../reference/records/records.mjs';
import { unsafeValidateTransition } from '../../reference/records/transition.mjs';
import {
  DIGESTS,
  OIDS,
  captainResult,
  clone,
  designReady,
  initialAssemblyStatus,
  initialWorkStatus,
  mergedAssembly,
  mergedWork,
  proofReady,
  verified,
} from './helpers.mjs';

function throwsCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code);
}

test('the complete positive work lifecycle follows the closed table', () => {
  const initial = initialWorkStatus();
  const designed = designReady(initial);
  const proceeded = captainResult(designed, 'proceed');
  const implemented = proofReady(proceeded);
  const passed = verified(implemented, 'pass');
  const merged = mergedWork(passed);

  assert.equal(unsafeValidateTransition(initial, designed, 'DESIGN_WRITTEN'), designed);
  assert.equal(unsafeValidateTransition(designed, proceeded, 'PROCEED'), proceeded);
  assert.equal(unsafeValidateTransition(proceeded, implemented, 'IMPLEMENTED'), implemented);
  assert.equal(unsafeValidateTransition(implemented, passed, 'PASS'), passed);
  assert.equal(unsafeValidateTransition(passed, merged, 'MERGED'), merged);
});

test('Captain REVISE demands fresh design and ESCALATE blocks for Planner', () => {
  const designed = designReady();
  const revise = captainResult(designed, 'revise');
  unsafeValidateTransition(designed, revise, 'REVISE');
  const redesigned = designReady(revise, { digest: DIGESTS.i, producer: 'implementer-design-2' });
  unsafeValidateTransition(revise, redesigned, 'DESIGN_WRITTEN');

  const escalate = captainResult(redesigned, 'escalate');
  unsafeValidateTransition(redesigned, escalate, 'ESCALATE');

  const staleRedesign = designReady(revise);
  throwsCode(() => unsafeValidateTransition(revise, staleRedesign, 'DESIGN_WRITTEN'), 'EVIDENCE_NOT_REFRESHED');
});

test('Verifier FAIL enables a fresh repair and BLOCKED goes to Planner', () => {
  const implemented = proofReady();
  const failed = verified(implemented, 'fail');
  unsafeValidateTransition(implemented, failed, 'FAIL');

  const repaired = proofReady(failed, {
    digest: DIGESTS.i,
    producer: 'implementer-code-2',
    candidate: OIDS['1'],
    candidateTree: OIDS['2'],
    productTree: DIGESTS.j,
  });
  unsafeValidateTransition(failed, repaired, 'IMPLEMENTED');

  const blocked = verified(repaired, 'blocked');
  unsafeValidateTransition(repaired, blocked, 'BLOCKED');

  const staleRepair = proofReady(failed);
  throwsCode(() => unsafeValidateTransition(failed, staleRepair, 'IMPLEMENTED'), 'EVIDENCE_NOT_REFRESHED');
});

test('assembly persists PASS, BLOCKED, and FAIL while FAIL recovery requires a new release identity', () => {
  const initial = initialAssemblyStatus();
  const passed = verified(initial, 'pass');
  const merged = mergedAssembly(passed);
  unsafeValidateTransition(initial, passed, 'PASS');
  unsafeValidateTransition(passed, merged, 'MERGED');

  const blocked = verified(initial, 'blocked');
  unsafeValidateTransition(initial, blocked, 'BLOCKED');

  const failed = verified(initial, 'fail');
  unsafeValidateTransition(initial, failed, 'FAIL');
  throwsCode(() => unsafeValidateTransition(failed, initial, 'RETRY_ASSEMBLY'), 'UNKNOWN_TRANSITION_RESULT');
  throwsCode(() => unsafeValidateTransition(failed, passed, 'PASS'), 'INVALID_TRANSITION');
});

test('materialisation adds exact ownership evidence and NO_VERDICT changes nothing', () => {
  const baseline = initialWorkStatus({ authority: 'refs/heads/release-wt/v1.0.0' });
  const owner = clone(baseline);
  owner.authority_ref = owner.owner_ref;
  owner.materialization = { base_commit: OIDS.a, dependencies: [] };
  unsafeValidateTransition(baseline, owner, 'MATERIALIZE');
  unsafeValidateTransition(owner, clone(owner), 'NO_VERDICT');

  const changed = clone(owner);
  changed.outcome = 'revise';
  throwsCode(() => unsafeValidateTransition(owner, changed, 'NO_VERDICT'), 'INVALID_STATE_BINDING');

  const progressed = designReady(baseline);
  progressed.authority_ref = progressed.owner_ref;
  progressed.materialization = { base_commit: OIDS.a, dependencies: [] };
  throwsCode(() => unsafeValidateTransition(baseline, progressed, 'MATERIALIZE'), 'IMMUTABLE_BINDING_CHANGED');
});

test('REBOUND changes only a pristine unmaterialised baseline', () => {
  const baseline = initialWorkStatus({ authority: 'refs/heads/release-wt/v1.0.0' });
  const rebound = initialWorkStatus({ authority: 'refs/heads/release-wt/v1.0.0' });
  rebound.plan = {
    digest: DIGESTS.k,
    approval: { ref: 'approval://v1.0.0/2', digest: DIGESTS.l },
  };
  rebound.target_ref = 'refs/heads/release/v2';
  unsafeValidateTransition(baseline, rebound, 'REBOUND');

  const stale = clone(rebound);
  stale.plan = clone(baseline.plan);
  throwsCode(() => unsafeValidateTransition(baseline, stale, 'REBOUND'), 'REPLAN_NOT_CHANGED');

  const ownerChanged = clone(rebound);
  ownerChanged.owner_ref = 'refs/heads/track/v1.0.0/T2';
  ownerChanged.track_id = 'T2';
  ownerChanged.authority_ref = ownerChanged.owner_ref;
  ownerChanged.materialization = { base_commit: OIDS.a, dependencies: [] };
  throwsCode(() => unsafeValidateTransition(baseline, ownerChanged, 'REBOUND'), 'IMMUTABLE_BINDING_CHANGED');

  const materialized = verified(proofReady(), 'fail');
  throwsCode(() => unsafeValidateTransition(materialized, rebound, 'REBOUND'), 'MATERIALIZED_REBOUND');
});

test('stale bindings and reviewer self-identity fail before admission', () => {
  const designed = designReady();
  const proceeded = captainResult(designed);
  const implemented = proofReady(proceeded);
  const mutations = [
    (status) => { status.captain.plan_digest = DIGESTS.m; },
    (status) => { status.proof.approval_digest = DIGESTS.m; },
    (status) => { status.proof.design_digest = DIGESTS.m; },
    (status) => { status.proof.captain_invocation = 'captain-other'; },
  ];
  for (const mutate of mutations) {
    const status = clone(implemented);
    mutate(status);
    throwsCode(() => validateStatusSemantics(status), 'STALE_BINDING');
  }

  const captainSelfReview = clone(proceeded);
  captainSelfReview.captain.invocation = captainSelfReview.design.producer_invocation;
  throwsCode(() => validateStatusSemantics(captainSelfReview), 'SELF_REVIEW');

  const pass = verified(implemented);
  const verifierSelfReview = clone(pass);
  verifierSelfReview.verification.invocation = verifierSelfReview.proof.producer_invocation;
  throwsCode(() => validateStatusSemantics(verifierSelfReview), 'SELF_REVIEW');
});

test('Verifier artifact and proof bindings are exact', () => {
  const pass = verified();
  const cases = [
    ['STALE_BINDING', (status) => { status.verification.plan_digest = DIGESTS.m; }],
    ['STALE_BINDING', (status) => { status.verification.proof_digest = DIGESTS.m; }],
    ['STALE_BINDING', (status) => { status.verification.candidate_commit = OIDS['3']; }],
    ['STALE_BINDING', (status) => { status.verification.product_tree = DIGESTS.m; }],
  ];
  for (const [code, mutate] of cases) {
    const status = clone(pass);
    mutate(status);
    throwsCode(() => validateStatusSemantics(status), code);
  }
});

test('target and previous gates cannot move during a normal transition', () => {
  const implemented = proofReady();
  const pass = verified(implemented);
  pass.target_ref = 'refs/heads/other';
  throwsCode(() => unsafeValidateTransition(implemented, pass, 'PASS'), 'IMMUTABLE_BINDING_CHANGED');

  const changedProof = verified(implemented);
  changedProof.proof.product_tree = DIGESTS.n;
  changedProof.verification.product_tree = DIGESTS.n;
  throwsCode(() => unsafeValidateTransition(implemented, changedProof, 'PASS'), 'IMMUTABLE_BINDING_CHANGED');
});

test('terminal identities and outcomes are write-once', () => {
  const terminal = mergedWork();
  unsafeValidateTransition(terminal, clone(terminal), 'NO_VERDICT');
  const rewritten = clone(terminal);
  rewritten.merge.result_commit = OIDS['4'];
  throwsCode(() => unsafeValidateTransition(terminal, rewritten, 'NO_VERDICT'), 'TERMINAL_REWRITE');
  throwsCode(() => unsafeValidateTransition(terminal, initialWorkStatus(), 'REBOUND'), 'TERMINAL_REWRITE');
});

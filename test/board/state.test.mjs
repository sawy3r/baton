import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BatonStateError,
  readBatonState,
} from '../../reference/records/state.mjs';
import {
  commitAll,
  git,
  write,
} from '../records/helpers.mjs';
import {
  appendReceipt,
  baselineFixture,
  designSlice,
  passSlice,
  revisePlan,
} from './helpers.mjs';

test('approved plan derives missing procedural track state without BLOCKED', () => {
  const fixture = baselineFixture();
  try {
    const state = readBatonState(fixture.repo, 'v1.0.0');
    assert.equal(state.plan.metadata.revision, 1);
    assert.equal(state.plan.approval_oid, fixture.approval.oid);
    assert.equal(state.plan.target_stale, false);
    assert.equal(state.tracks[0].head, null);
    assert.equal(state.slices[0].next_role, 'implementer');
    assert.equal(state.slices[0].attempt, 1);
    assert.equal(state.slices[0].status, 'ready');
    assert.equal(state.diagnostics[0].code, 'TRACK_REF_ABSENT');
  } finally {
    fixture.cleanup();
  }
});

test('canonical role chain selects PASS and the one-track exact merge fast path', () => {
  const fixture = baselineFixture();
  try {
    const passed = passSlice(fixture, 'S1');
    const state = readBatonState(fixture.repo, 'v1.0.0', {
      productExclusionAdmission: fixture.admission,
    });
    assert.equal(state.slices[0].pass.oid, passed.verified.oid);
    assert.equal(state.slices[0].candidate.oid, passed.implemented.oid);
    assert.equal(state.slices[0].next_role, 'merge');
    assert.equal(state.assembly.next_role, 'merge');
    assert.equal(state.assembly.pass.oid, passed.verified.oid);
  } finally {
    fixture.cleanup();
  }
});

test('terminal Merge accepts target advancement only when it contains the recorded result', () => {
  const fixture = baselineFixture();
  try {
    const passed = passSlice(fixture, 'S1');
    git(fixture.repo, 'switch', '-q', `release-wt/${fixture.metadata.release}`);
    const merged = appendReceipt(fixture.repo, {
      version: 1,
      release: fixture.metadata.release,
      role: 'merge',
      result: 'merged',
      plan: fixture.plan,
      binds: passed.verified.oid,
      target: fixture.target,
      candidate: passed.candidate,
      product_tree: passed.identity.productTree,
      result_commit: passed.candidate,
      summary: 'Merged the exact directly passed candidate.',
    });
    git(fixture.repo, 'branch', '-f', 'main', passed.candidate);

    let state = readBatonState(fixture.repo, 'v1.0.0', {
      productExclusionAdmission: fixture.admission,
    });
    assert.equal(state.assembly.current_receipt.oid, merged.oid);
    assert.equal(state.assembly.status, 'complete');
    assert.equal(state.assembly.outcome, 'merged');
    assert.equal(state.plan.target_stale, false);
    assert.equal(state.diagnostics.some(({ code }) => code === 'TARGET_MOVED'), false);

    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'after-merge.txt', 'still contains the recorded result\n');
    commitAll(fixture.repo, 'advance after recorded merge');
    state = readBatonState(fixture.repo, 'v1.0.0', {
      productExclusionAdmission: fixture.admission,
    });
    assert.equal(state.plan.target_stale, false);
    assert.equal(state.diagnostics.some(({ code }) => code === 'TARGET_MOVED'), false);

    git(fixture.repo, 'switch', '-q', `release-wt/${fixture.metadata.release}`);
    git(fixture.repo, 'branch', '-f', 'main', fixture.target);
    assert.throws(
      () => readBatonState(fixture.repo, 'v1.0.0', {
        productExclusionAdmission: fixture.admission,
      }),
      (error) => error instanceof BatonStateError && error.code === 'MOVED_TARGET',
    );
  } finally {
    fixture.cleanup();
  }
});

test('unchanged contracts retain PASS across an approved plan revision', () => {
  const fixture = baselineFixture();
  try {
    const passed = passSlice(fixture, 'S1');
    revisePlan(fixture, null, { moveTarget: true });
    const state = readBatonState(fixture.repo, 'v1.0.0', {
      productExclusionAdmission: fixture.admission,
    });
    assert.equal(state.plan.metadata.revision, 2);
    assert.equal(state.slices[0].pass.oid, passed.verified.oid);
    assert.equal(state.slices[0].retained, true);
    assert.equal(state.assembly.outcome, 'none');
  } finally {
    fixture.cleanup();
  }
});

test('a forged Captain binding is invalid, not a procedural blocker', () => {
  const fixture = baselineFixture();
  try {
    designSlice(fixture, 'S1');
    appendReceipt(fixture.repo, {
      version: 1,
      release: 'v1.0.0',
      slice: 'S1',
      role: 'captain',
      result: 'proceed',
      attempt: 1,
      plan: fixture.plan,
      contract: fixture.parsed.metadata.contracts.S1,
      binds: fixture.approval.oid,
      summary: 'A forged decision binding.',
    });
    assert.throws(
      () => readBatonState(fixture.repo, 'v1.0.0'),
      (error) => error instanceof BatonStateError && error.code === 'STALE_BINDING',
    );
  } finally {
    fixture.cleanup();
  }
});

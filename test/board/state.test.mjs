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
  oneSliceMetadata,
  passSlice,
  revisePlan,
  slice,
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

test('a changed contract resets an unfinished slice to a new design attempt', () => {
  const fixture = baselineFixture();
  try {
    const designed = designSlice(fixture, 'S1');
    const priorContract = fixture.parsed.metadata.contracts.S1;
    revisePlan(fixture, (metadata) => {
      metadata.tracks[0].slices[0].acceptance[0].text = (
        'S1 is observable under its changed contract.'
      );
    });
    const state = readBatonState(fixture.repo, 'v1.0.0');
    assert.notEqual(state.plan.metadata.contracts.S1, priorContract);
    assert.equal(state.slices[0].stage, 'design');
    assert.equal(state.slices[0].next_role, 'implementer');
    assert.equal(state.slices[0].attempt, designed.receipt.attempt + 1);
    assert.equal(state.slices[0].current_receipt.oid, fixture.approval.oid);
  } finally {
    fixture.cleanup();
  }
});

test('an intermediate contract change prevents a reverted digest resurrecting old PASS', () => {
  const fixture = baselineFixture();
  try {
    const originalTracks = structuredClone(fixture.metadata.tracks);
    const originalContract = fixture.parsed.metadata.contracts.S1;
    const passed = passSlice(fixture, 'S1');
    revisePlan(fixture, (metadata) => {
      metadata.tracks[0].slices[0].acceptance[0].text = (
        'S1 is observable under an intermediate changed contract.'
      );
    });
    assert.notEqual(fixture.parsed.metadata.contracts.S1, originalContract);
    revisePlan(fixture, (metadata) => {
      metadata.tracks = structuredClone(originalTracks);
    });
    assert.equal(fixture.parsed.metadata.contracts.S1, originalContract);

    const state = readBatonState(fixture.repo, 'v1.0.0', {
      productExclusionAdmission: fixture.admission,
    });
    assert.equal(state.plan.metadata.revision, 3);
    assert.equal(state.slices[0].pass, null);
    assert.equal(state.slices[0].retained, false);
    assert.equal(state.slices[0].stage, 'design');
    assert.equal(state.slices[0].next_role, 'implementer');
    assert.equal(state.slices[0].attempt, passed.verified.receipt.attempt + 1);
    assert.equal(state.slices[0].current_receipt.oid, fixture.approval.oid);
  } finally {
    fixture.cleanup();
  }
});

test('an inserted serial predecessor invalidates only the affected suffix', () => {
  const metadata = oneSliceMetadata();
  metadata.tracks[0].slices.push(slice('S2', 'src/two.txt'));
  const fixture = baselineFixture(metadata);
  try {
    const first = passSlice(fixture, 'S1');
    const second = passSlice(fixture, 'S2');
    revisePlan(fixture, (revised) => {
      revised.tracks[0].slices.splice(1, 0, slice('S0', 'src/zero.txt'));
    });

    const state = readBatonState(fixture.repo, 'v1.0.0', {
      productExclusionAdmission: fixture.admission,
    });
    const slices = new Map(state.slices.map((entry) => [
      entry.location.slice.id,
      entry,
    ]));
    assert.equal(slices.get('S1').pass.oid, first.verified.oid);
    assert.equal(slices.get('S1').retained, true);
    assert.equal(slices.get('S0').stage, 'design');
    assert.equal(slices.get('S0').status, 'ready');
    assert.equal(slices.get('S2').pass, null);
    assert.equal(slices.get('S2').status, 'waiting');
    assert.equal(slices.get('S2').attempt, second.verified.receipt.attempt + 1);
    assert.equal(slices.get('S2').current_receipt.oid, fixture.approval.oid);
  } finally {
    fixture.cleanup();
  }
});

test('reordering and then restoring a serial prefix cannot resurrect its old PASS', () => {
  const metadata = oneSliceMetadata();
  metadata.tracks[0].slices.push(slice('S2', 'src/two.txt'));
  const original = structuredClone(metadata.tracks[0].slices);
  const fixture = baselineFixture(metadata);
  try {
    passSlice(fixture, 'S1');
    passSlice(fixture, 'S2');
    revisePlan(fixture, (revised) => {
      revised.tracks[0].slices.reverse();
    });
    revisePlan(fixture, (revised) => {
      revised.tracks[0].slices = structuredClone(original);
    });

    const state = readBatonState(fixture.repo, 'v1.0.0', {
      productExclusionAdmission: fixture.admission,
    });
    assert.equal(state.plan.metadata.revision, 3);
    assert.equal(state.slices[0].pass, null);
    assert.equal(state.slices[1].pass, null);
    assert.equal(state.slices[0].status, 'ready');
    assert.equal(state.slices[1].status, 'waiting');
  } finally {
    fixture.cleanup();
  }
});

test('a newer approval resolves an unchanged Captain escalation into a new design attempt', () => {
  const fixture = baselineFixture();
  try {
    const designed = designSlice(fixture, 'S1');
    const escalated = appendReceipt(fixture.repo, {
      version: 1,
      release: fixture.metadata.release,
      slice: 'S1',
      role: 'captain',
      result: 'escalate',
      attempt: designed.receipt.attempt,
      plan: fixture.plan,
      contract: fixture.parsed.metadata.contracts.S1,
      binds: designed.oid,
      summary: 'Planner intervention is required.',
    });
    let state = readBatonState(fixture.repo, 'v1.0.0');
    assert.equal(state.slices[0].current_receipt.oid, escalated.oid);
    assert.equal(state.slices[0].next_role, 'planner');
    assert.equal(state.slices[0].status, 'blocked');

    revisePlan(fixture, null);
    state = readBatonState(fixture.repo, 'v1.0.0');
    assert.equal(state.slices[0].stage, 'design');
    assert.equal(state.slices[0].status, 'ready');
    assert.equal(state.slices[0].next_role, 'implementer');
    assert.equal(state.slices[0].attempt, escalated.receipt.attempt + 1);
    assert.equal(state.slices[0].current_receipt.oid, fixture.approval.oid);
  } finally {
    fixture.cleanup();
  }
});

test('a newer approval resolves an unchanged Verifier blocker into a new design attempt', () => {
  const fixture = baselineFixture();
  try {
    const blocked = passSlice(fixture, 'S1', { verifierResult: 'blocked' });
    let state = readBatonState(fixture.repo, 'v1.0.0', {
      productExclusionAdmission: fixture.admission,
    });
    assert.equal(state.slices[0].current_receipt.oid, blocked.verified.oid);
    assert.equal(state.slices[0].next_role, 'planner');
    assert.equal(state.slices[0].status, 'blocked');

    revisePlan(fixture, null);
    state = readBatonState(fixture.repo, 'v1.0.0', {
      productExclusionAdmission: fixture.admission,
    });
    assert.equal(state.slices[0].stage, 'design');
    assert.equal(state.slices[0].status, 'ready');
    assert.equal(state.slices[0].next_role, 'implementer');
    assert.equal(state.slices[0].attempt, blocked.verified.receipt.attempt + 1);
    assert.equal(state.slices[0].current_receipt.oid, fixture.approval.oid);
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

test('a later same-track slice cannot forge progress before the prior PASS', () => {
  const fixture = baselineFixture(oneSliceMetadata({
    tracks: [{
      id: 'T1',
      depends_on: [],
      slices: [
        oneSliceMetadata().tracks[0].slices[0],
        {
          id: 'S2',
          outcome: 'Deliver S2 after S1.',
          scope: { include: ['src/two.txt'], exclude: [] },
          acceptance: [{ id: 'S2-A1', text: 'S2 is observable.' }],
          checks: ['node --test'],
          constraints: [],
          depends_on: [],
          consumes: [],
        },
      ],
    }],
  }));
  try {
    designSlice(fixture, 'S2');
    assert.throws(
      () => readBatonState(fixture.repo, 'v1.0.0'),
      (error) => (
        error instanceof BatonStateError
        && error.code === 'DEPENDENCIES_NOT_READY'
      ),
    );
  } finally {
    fixture.cleanup();
  }
});

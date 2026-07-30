import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BatonStateError,
  readBatonState,
} from '../../reference/records/state.mjs';
import {
  isAncestor,
  productTreeIdentity,
} from '../../reference/records/git.mjs';
import { createBatonActions } from '../../reference/records/actions.mjs';
import { digestBytes } from '../../reference/records/receipts.mjs';
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
    });
    assert.equal(state.plan.target_stale, false);
    assert.equal(state.diagnostics.some(({ code }) => code === 'TARGET_MOVED'), false);

    git(fixture.repo, 'switch', '-q', `release-wt/${fixture.metadata.release}`);
    git(fixture.repo, 'branch', '-f', 'main', fixture.target);
    assert.throws(
      () => readBatonState(fixture.repo, 'v1.0.0', {
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
    });
    assert.equal(state.slices[0].current_receipt.oid, blocked.verified.oid);
    assert.equal(state.slices[0].next_role, 'planner');
    assert.equal(state.slices[0].status, 'blocked');

    revisePlan(fixture, null);
    state = readBatonState(fixture.repo, 'v1.0.0', {
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

function blockedConsumerFixture() {
  return baselineFixture(oneSliceMetadata({
    tracks: [
      {
        id: 'T1',
        depends_on: [],
        slices: [slice('S1', 'src/producer.txt')],
      },
      {
        id: 'T2',
        depends_on: [],
        slices: [slice('S2', 'src/consumer.txt', {
          depends_on: ['S1'],
          consumes: ['S1'],
        })],
      },
    ],
  }));
}

test('consumed-product drift cannot override Captain escalation', () => {
  const fixture = blockedConsumerFixture();
  try {
    passSlice(fixture, 'S1');
    git(
      fixture.repo,
      'switch',
      '-q',
      '-c',
      'track/v1.0.0/T2',
      fixture.approval.oid,
    );
    const common = {
      version: 1,
      release: fixture.metadata.release,
      slice: 'S2',
      attempt: 1,
      plan: fixture.plan,
      contract: fixture.parsed.metadata.contracts.S2,
    };
    const design = appendReceipt(fixture.repo, {
      ...common,
      role: 'implementer',
      result: 'designed',
      binds: fixture.approval.oid,
      summary: 'Legacy review lacks consumed authority ancestry.',
    });
    const escalated = appendReceipt(fixture.repo, {
      ...common,
      role: 'captain',
      result: 'escalate',
      binds: design.oid,
      summary: 'Planner intervention remains required.',
    });

    let state = readBatonState(fixture.repo, fixture.metadata.release, {
    });
    let consumer = state.slices.find(({ location }) => location.slice.id === 'S2');
    assert.equal(consumer.current_receipt.oid, escalated.oid);
    assert.equal(consumer.status, 'blocked');
    assert.equal(consumer.next_role, 'planner');
    assert.equal(consumer.outcome, 'escalate');

    revisePlan(fixture, null);
    state = readBatonState(fixture.repo, fixture.metadata.release, {
    });
    consumer = state.slices.find(({ location }) => location.slice.id === 'S2');
    assert.equal(consumer.stage, 'design');
    assert.equal(consumer.status, 'ready');
    assert.equal(consumer.next_role, 'implementer');
    assert.equal(consumer.attempt, escalated.receipt.attempt + 1);
    assert.equal(consumer.current_receipt.oid, fixture.approval.oid);
  } finally {
    fixture.cleanup();
  }
});

test('consumed-product drift cannot override Verifier BLOCKED', () => {
  const fixture = blockedConsumerFixture();
  try {
    passSlice(fixture, 'S1');
    const blocked = passSlice(fixture, 'S2', {
      inputs: { S1: `sha256:${'f'.repeat(64)}` },
      legacyConsumed: true,
      verifierResult: 'blocked',
    });

    let state = readBatonState(fixture.repo, fixture.metadata.release, {
    });
    let consumer = state.slices.find(({ location }) => location.slice.id === 'S2');
    assert.equal(consumer.current_receipt.oid, blocked.verified.oid);
    assert.equal(consumer.status, 'blocked');
    assert.equal(consumer.next_role, 'planner');
    assert.equal(consumer.outcome, 'blocked');

    revisePlan(fixture, null);
    state = readBatonState(fixture.repo, fixture.metadata.release, {
    });
    consumer = state.slices.find(({ location }) => location.slice.id === 'S2');
    assert.equal(consumer.stage, 'design');
    assert.equal(consumer.status, 'ready');
    assert.equal(consumer.next_role, 'implementer');
    assert.equal(consumer.attempt, blocked.verified.receipt.attempt + 1);
    assert.equal(consumer.current_receipt.oid, fixture.approval.oid);
  } finally {
    fixture.cleanup();
  }
});

test('a design cannot bind directly to Captain escalation', () => {
  const fixture = baselineFixture();
  try {
    const design = designSlice(fixture, 'S1');
    const escalated = appendReceipt(fixture.repo, {
      version: 1,
      release: fixture.metadata.release,
      slice: 'S1',
      role: 'captain',
      result: 'escalate',
      attempt: design.receipt.attempt,
      plan: fixture.plan,
      contract: fixture.parsed.metadata.contracts.S1,
      binds: design.oid,
      summary: 'Planner intervention is required.',
    });
    appendReceipt(fixture.repo, {
      version: 1,
      release: fixture.metadata.release,
      slice: 'S1',
      role: 'implementer',
      result: 'designed',
      attempt: escalated.receipt.attempt + 1,
      plan: fixture.plan,
      contract: fixture.parsed.metadata.contracts.S1,
      binds: escalated.oid,
      summary: 'Attempt to bypass the planner blocker.',
    });
    assert.throws(
      () => readBatonState(fixture.repo, fixture.metadata.release),
      (error) => (
        error instanceof BatonStateError
        && error.code === 'STALE_BINDING'
        && /has no predecessor/.test(error.message)
      ),
    );
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

for (const legacyMode of ['missing', 'inexact']) {
  test(`legacy ${legacyMode} consuming ancestry remains retainable by product pin`, () => {
    const fixture = baselineFixture(oneSliceMetadata({
      tracks: [
        {
          id: 'T1',
          depends_on: [],
          slices: [slice('S1', 'src/producer.txt')],
        },
        {
          id: 'T2',
          depends_on: [],
          slices: [slice('S2', 'src/consumer.txt', {
            depends_on: ['S1'],
            consumes: ['S1'],
          })],
        },
        {
          id: 'T3',
          depends_on: [],
          slices: [slice('S3', 'src/unrelated.txt')],
        },
      ],
    }));
    try {
      const producer = passSlice(fixture, 'S1');
      const legacy = passSlice(fixture, 'S2', {
        inputs: { S1: producer.identity.productTree },
        legacyConsumed: true,
        legacyBase: legacyMode === 'inexact' ? producer.verified.oid : null,
      });
      passSlice(fixture, 'S3');
      revisePlan(fixture, (metadata) => {
        metadata.tracks[2].slices[0].acceptance[0].text = 'S3 changed independently.';
      });
      const state = readBatonState(fixture.repo, 'v1.0.0', {
      });
      const consumer = state.slices.find(({ location }) => location.slice.id === 'S2');
      assert.equal(legacy.implemented.receipt.base, undefined);
      assert.equal(
        isAncestor(fixture.repo, producer.verified.oid, legacy.candidate),
        legacyMode === 'inexact',
      );
      assert.equal(consumer.pass.oid, legacy.verified.oid);
      assert.equal(consumer.retained, true);
      assert.deepEqual(
        consumer.reviewed_pins,
        legacyMode === 'inexact'
          ? { S1: producer.identity.productTree }
          : null,
      );
    } finally {
      fixture.cleanup();
    }
  });
}

test('marker-present consuming design rejects a forged prior track authority', () => {
  const fixture = baselineFixture(oneSliceMetadata({
    tracks: [
      {
        id: 'T1',
        depends_on: [],
        slices: [slice('S1', 'src/producer.txt')],
      },
      {
        id: 'T2',
        depends_on: [],
        slices: [slice('S2', 'src/consumer.txt', {
          depends_on: ['S1'],
          consumes: ['S1'],
        })],
      },
    ],
  }));
  try {
    const producer = passSlice(fixture, 'S1');
    const engine = createBatonActions({ repo: fixture.repo });
    const prepared = engine.prepareTrackBase({
      release: fixture.metadata.release,
      slice: 'S2',
    });
    git(fixture.repo, 'switch', '-q', 'track/v1.0.0/T2');
    appendReceipt(fixture.repo, {
      version: 1,
      release: fixture.metadata.release,
      slice: 'S2',
      role: 'implementer',
      result: 'designed',
      attempt: 1,
      plan: fixture.plan,
      contract: fixture.parsed.metadata.contracts.S2,
      binds: fixture.approval.oid,
      base: producer.verified.oid,
      inputs: prepared.pins,
      summary: 'Forge the reviewed authority seed.',
    });
    assert.throws(
      () => readBatonState(fixture.repo, fixture.metadata.release, {
      }),
      (error) => (
        error instanceof BatonStateError
        && error.code === 'STALE_BINDING'
        && /wrong prior track authority/.test(error.message)
      ),
    );
  } finally {
    fixture.cleanup();
  }
});

test('marker-present consuming design rejects merely ancestral input authority', () => {
  const fixture = baselineFixture(oneSliceMetadata({
    tracks: [
      {
        id: 'T1',
        depends_on: [],
        slices: [slice('S1', 'src/producer.txt')],
      },
      {
        id: 'T2',
        depends_on: [],
        slices: [slice('S2', 'src/consumer.txt', {
          depends_on: ['S1'],
          consumes: ['S1'],
        })],
      },
    ],
  }));
  try {
    const producer = passSlice(fixture, 'S1');
    git(
      fixture.repo,
      'switch',
      '-q',
      '-c',
      'track/v1.0.0/T2',
      producer.verified.oid,
    );
    git(
      fixture.repo,
      'commit',
      '--allow-empty',
      '-q',
      '-m',
      'forge a non-deterministic reviewed base',
    );
    appendReceipt(fixture.repo, {
      version: 1,
      release: fixture.metadata.release,
      slice: 'S2',
      role: 'implementer',
      result: 'designed',
      attempt: 1,
      plan: fixture.plan,
      contract: fixture.parsed.metadata.contracts.S2,
      binds: fixture.approval.oid,
      base: fixture.approval.oid,
      inputs: { S1: producer.identity.productTree },
      summary: 'Record ancestry without exact composition.',
    });
    assert.throws(
      () => readBatonState(fixture.repo, fixture.metadata.release, {
      }),
      (error) => (
        error instanceof BatonStateError
        && error.code === 'STALE_BINDING'
        && /inexact reviewed base/.test(error.message)
      ),
    );
  } finally {
    fixture.cleanup();
  }
});

test('marker-present review rejects a changed-product retry after Verifier FAIL', () => {
  const fixture = baselineFixture(oneSliceMetadata({
    tracks: [
      {
        id: 'T1',
        depends_on: [],
        slices: [slice('S1', 'src/producer.txt')],
      },
      {
        id: 'T2',
        depends_on: [],
        slices: [slice('S2', 'src/consumer.txt', {
          depends_on: ['S1'],
          consumes: ['S1'],
        })],
      },
    ],
  }));
  try {
    const firstProducer = passSlice(fixture, 'S1');
    const consumer = passSlice(fixture, 'S2', {
      inputs: { S1: firstProducer.identity.productTree },
      verifierResult: 'fail',
    });
    revisePlan(fixture, (metadata) => {
      metadata.tracks[0].slices[0].acceptance[0].text = 'The producer changes.';
    });
    const secondProducer = passSlice(fixture, 'S1', {
      attempt: 2,
      productValue: 'S1 changed product\n',
    });
    const engine = createBatonActions({ repo: fixture.repo });
    const prepared = engine.prepareTrackBase({
      release: fixture.metadata.release,
      slice: 'S2',
    });
    git(fixture.repo, 'switch', '-q', 'track/v1.0.0/T2');
    write(fixture.repo, 'src/consumer.txt', 'forged changed-input retry\n');
    const candidate = commitAll(fixture.repo, 'forge changed-input retry');
    const identity = productTreeIdentity(fixture.repo, candidate);
    appendReceipt(fixture.repo, {
      version: 1,
      release: fixture.metadata.release,
      slice: 'S2',
      role: 'implementer',
      result: 'candidate',
      attempt: 2,
      plan: fixture.plan,
      contract: fixture.parsed.metadata.contracts.S2,
      binds: consumer.verified.oid,
      base: prepared.base,
      candidate,
      product_tree: identity.productTree,
      inputs: { S1: secondProducer.identity.productTree },
      checks: digestBytes(Buffer.from('forged retry checks')),
      summary: 'Retry without a fresh reviewed design.',
    });
    assert.throws(
      () => readBatonState(fixture.repo, fixture.metadata.release, {
      }),
      (error) => (
        error instanceof BatonStateError
        && error.code === 'STALE_BINDING'
        && /differs from its reviewed inputs/.test(error.message)
      ),
    );
  } finally {
    fixture.cleanup();
  }
});

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';

import {
  createBatonActions,
  referenceNames,
} from '../../reference/records/actions.mjs';
import {
  productTreeIdentity,
  readFileAtOID,
  resolveRef,
  unsafeAtomicUpdateRefs,
  unsafePrepareApprovedTargetBase,
  unsafePrepareMetadataCommit,
} from '../../reference/records/git.mjs';
import {
  digestBytes,
  parsePlanBytes,
  parseReceiptCommitMessage,
  renderReceiptCommit,
} from '../../reference/records/receipts.mjs';
import {
  readBatonState,
  unsafeProductBaseEvidence,
} from '../../reference/records/state.mjs';
import {
  commitAll,
  git,
  temporaryRepository,
  write,
} from './helpers.mjs';

function metadata(revision = 1, previousPlan = null, overrides = {}) {
  return {
    schema_version: 'baton.plan/v2',
    release: 'actions-v2',
    revision,
    previous_plan: previousPlan,
    repository: 'example/actions-v2',
    target_ref: 'refs/heads/main',
    approval_ref: `approval://actions-v2/${revision}`,
    tracks: [
      {
        id: 'T1',
        depends_on: [],
        slices: [
          {
            id: 'S1',
            outcome: 'Deliver one observable product change.',
            scope: { include: ['src/product.txt'], exclude: [] },
            acceptance: [{ id: 'A1', text: 'The product change is observable.' }],
            checks: ['node --test'],
            constraints: [],
            depends_on: [],
            consumes: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function planBytes(value = metadata()) {
  return Buffer.from(
    `\`\`\`baton-plan-v2\n${JSON.stringify(value, null, 2)}\n\`\`\`\n\n# Actions v2\n`,
  );
}

function unrelatedTrack() {
  return {
    id: 'T2',
    depends_on: [],
    slices: [{
      id: 'S2',
      outcome: 'Deliver an unrelated observable product change.',
      scope: { include: ['src/unrelated.txt'], exclude: [] },
      acceptance: [{ id: 'A2', text: 'The unrelated product change is observable.' }],
      checks: ['node --test'],
      constraints: [],
      depends_on: [],
      consumes: [],
    }],
  };
}

function actions(repo) {
  return createBatonActions({ repo });
}

function appendMetadataReceipt(repo, expectedHead, subject, receipt) {
  return unsafePrepareMetadataCommit(repo, {
    expectedHead,
    message: renderReceiptCommit({
      subject,
      detail: Buffer.alloc(0),
      receipt: {
        ...receipt,
        detail: digestBytes(Buffer.alloc(0)),
      },
    }),
  }).commit;
}

function appendDesign(engine, detail = 'Approach: make the smallest product change.') {
  return engine.appendReceipt({
    release: 'actions-v2',
    slice: 'S1',
    role: 'implementer',
    result: 'designed',
    summary: 'Small scoped design ready for Captain review.',
    detail,
  });
}

function appendCaptain(engine, result = 'proceed') {
  return engine.appendReceipt({
    release: 'actions-v2',
    slice: 'S1',
    role: 'captain',
    result,
    summary: result === 'proceed'
      ? 'The design covers the approved contract.'
      : 'The design needs one bounded revision.',
    detail: result === 'proceed' ? 'PROCEED' : 'REVISE',
  });
}

function candidateAwaitingVerdict() {
  const fixture = temporaryRepository();
  write(fixture.repo, 'README.md', 'product\n');
  commitAll(fixture.repo, 'base');
  const engine = actions(fixture.repo);
  engine.recordPlanRevision({
    planBytes: planBytes(),
    summary: 'Plan approved.',
  });
  appendDesign(engine);
  appendCaptain(engine);
  git(fixture.repo, 'switch', '-q', 'track/actions-v2/T1');
  write(fixture.repo, 'src/product.txt', 'first candidate\n');
  const candidate = commitAll(fixture.repo, 'feat: first candidate');
  const implemented = engine.appendReceipt({
    release: 'actions-v2',
    slice: 'S1',
    role: 'implementer',
    result: 'candidate',
    summary: 'First exact candidate.',
    candidate,
    checkResults: 'implementer PASS\n',
  });
  return { fixture, engine, candidate, implemented };
}

function deliverSlice(engine, repo, {
  slice,
  track,
  file,
  value,
  allowEmpty = false,
  extraWrites = {},
  deletePaths = [],
}) {
  engine.prepareTrackBase({
    release: 'actions-v2',
    slice,
  });
  const designed = engine.appendReceipt({
    release: 'actions-v2',
    slice,
    role: 'implementer',
    result: 'designed',
    summary: `${slice} has one bounded implementation approach.`,
    detail: `Touch only ${file}.`,
  });
  engine.appendReceipt({
    release: 'actions-v2',
    slice,
    role: 'captain',
    result: 'proceed',
    summary: `${slice} design covers its contract.`,
    detail: 'PROCEED',
  });
  const prepared = engine.prepareTrackBase({
    release: 'actions-v2',
    slice,
  });
  git(repo, 'switch', '-q', `track/actions-v2/${track}`);
  write(repo, file, value);
  for (const [relativePath, contents] of Object.entries(extraWrites)) {
    write(repo, relativePath, contents);
  }
  for (const relativePath of deletePaths) {
    rmSync(`${repo}/${relativePath}`, { force: true });
  }
  const candidate = allowEmpty
    ? (
      git(repo, 'add', '-A'),
      git(repo, 'commit', '--allow-empty', '-q', '-m', `test: reverify ${slice}`),
      git(repo, 'rev-parse', 'HEAD')
    )
    : commitAll(repo, `feat: deliver ${slice}`);
  const implemented = engine.appendReceipt({
    release: 'actions-v2',
    slice,
    role: 'implementer',
    result: 'candidate',
    summary: `${slice} candidate passed focused checks.`,
    candidate,
    ...(prepared.authorities.length > 0 ? { base: prepared.base } : {}),
    checkResults: `${slice} implementer PASS\n`,
  });
  const passed = engine.appendReceipt({
    release: 'actions-v2',
    slice,
    role: 'verifier',
    result: 'pass',
    summary: `${slice} passed fresh verification.`,
    candidate,
    checkResults: `${slice} verifier PASS\n`,
  });
  return { designed, implemented, passed, candidate };
}

test('recordPlanRevision creates one approved plan and exact retry is inert', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    const target = commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const input = {
      planBytes: planBytes(),
      summary: 'Brad approved the exact plan.',
      detail: 'Protected approval reference checked.',
    };
    const recorded = engine.recordPlanRevision(input);
    assert.equal(recorded.changed, true);
    assert.equal(recorded.target, target);
    assert.equal(recorded.receipt.role, 'planner');
    assert.equal(recorded.receipt.result, 'approved');
    assert.equal(recorded.receipt.target, target);
    assert.equal(resolveRef(fixture.repo, recorded.ref), recorded.receipt_commit);
    assert.deepEqual(
      readFileAtOID(
        fixture.repo,
        recorded.receipt_commit,
        referenceNames.planPath('actions-v2'),
      ),
      planBytes(),
    );

    const message = Buffer.from(
      git(fixture.repo, 'show', '-s', '--format=%B', recorded.receipt_commit),
    );
    const parsed = parseReceiptCommitMessage(Buffer.concat([message, Buffer.from('\n')]));
    assert.equal(parsed.receipt.plan, recorded.plan);
    assert.equal(parsed.receipt.binds, git(
      fixture.repo,
      'rev-parse',
      `${recorded.receipt_commit}^`,
    ));

    const retry = engine.recordPlanRevision(input);
    assert.equal(retry.changed, false);
    assert.equal(retry.receipt_commit, recorded.receipt_commit);
    assert.equal(
      resolveRef(fixture.repo, referenceNames.releaseRef('actions-v2')),
      recorded.receipt_commit,
    );
  } finally {
    fixture.cleanup();
  }
});

test('same-plan retry keeps its approved target while an explicit revision may repin', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const first = engine.recordPlanRevision({
      planBytes: planBytes(),
      summary: 'Initial plan approved.',
    });

    write(fixture.repo, 'README.md', 'product moved independently\n');
    const movedTarget = commitAll(fixture.repo, 'move target');
    const retry = engine.recordPlanRevision({
      planBytes: planBytes(),
      summary: 'Initial plan approved.',
    });
    assert.equal(retry.changed, false);
    assert.equal(retry.target, first.target);
    assert.equal(retry.receipt.target, first.receipt.target);
    assert.equal(retry.receipt_commit, first.receipt_commit);

    const nextBytes = planBytes(metadata(2, first.plan));
    const revised = engine.recordPlanRevision({
      planBytes: nextBytes,
      summary: 'Revision approved against the current target.',
    });
    assert.equal(revised.changed, true);
    assert.equal(revised.revision, 2);
    assert.equal(revised.target, movedTarget);
    assert.equal(parsePlanBytes(nextBytes).metadata.previous_plan, first.plan);
    assert.equal(
      resolveRef(fixture.repo, referenceNames.releaseRef('actions-v2')),
      revised.receipt_commit,
    );
  } finally {
    fixture.cleanup();
  }
});

test('a repinned target is composed into a zero-input track before design', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product before maintenance bridge\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const first = engine.recordPlanRevision({
      planBytes: planBytes(),
      summary: 'Initial plan approved.',
    });

    write(fixture.repo, 'README.md', 'product after maintenance bridge\n');
    const movedTarget = commitAll(fixture.repo, 'merge maintenance bridge');
    const nextBytes = planBytes(metadata(2, first.plan));
    const revised = engine.recordPlanRevision({
      planBytes: nextBytes,
      summary: 'Revision approved against the maintenance-bridge target.',
    });
    const track = referenceNames.trackRef('actions-v2', 'T1');

    assert.throws(
      () => appendDesign(engine),
      (error) => error?.code === 'TRACK_BASE_NOT_PREPARED',
    );
    assert.throws(
      () => resolveRef(fixture.repo, track),
      /resolve refs\/heads\/track\/actions-v2\/T1 failed/,
    );

    const prepared = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S1',
    });
    assert.equal(prepared.changed, true);
    assert.equal(resolveRef(fixture.repo, track), prepared.base);
    assert.equal(isDescendant(fixture.repo, revised.head, prepared.base), true);
    assert.equal(isDescendant(fixture.repo, movedTarget, prepared.base), true);
    assert.deepEqual(
      git(fixture.repo, 'rev-list', '--parents', '-n', '1', prepared.base).split(' '),
      [prepared.base, revised.head, movedTarget],
    );
    assert.equal(
      readFileAtOID(fixture.repo, prepared.base, 'README.md').toString(),
      'product after maintenance bridge\n',
    );
    assert.deepEqual(
      readFileAtOID(
        fixture.repo,
        prepared.base,
        referenceNames.planPath('actions-v2'),
      ),
      nextBytes,
    );

    const designed = appendDesign(engine);
    assert.equal(designed.receipt.binds, revised.receipt_commit);
    assert.equal(
      git(fixture.repo, 'rev-parse', `${designed.receipt_commit}^`),
      prepared.base,
    );
    assert.equal(Object.hasOwn(designed.receipt, 'base'), false);
    assert.equal(Object.hasOwn(designed.receipt, 'inputs'), false);
  } finally {
    fixture.cleanup();
  }
});

test('state rejects a forged zero-input design that omits its repinned target', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product before maintenance bridge\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const first = engine.recordPlanRevision({
      planBytes: planBytes(),
      summary: 'Initial plan approved.',
    });
    write(fixture.repo, 'README.md', 'product after maintenance bridge\n');
    commitAll(fixture.repo, 'merge maintenance bridge');
    const nextBytes = planBytes(metadata(2, first.plan));
    const revised = engine.recordPlanRevision({
      planBytes: nextBytes,
      summary: 'Revision approved against the maintenance-bridge target.',
    });
    const parsed = parsePlanBytes(nextBytes);
    const message = renderReceiptCommit({
      subject: 'forge design without approved target',
      detail: Buffer.alloc(0),
      receipt: {
        version: 1,
        release: 'actions-v2',
        slice: 'S1',
        role: 'implementer',
        result: 'designed',
        attempt: 1,
        plan: revised.plan,
        contract: parsed.metadata.contracts.S1,
        binds: revised.receipt_commit,
        detail: digestBytes(Buffer.alloc(0)),
        summary: 'Forged design omits the approved target.',
      },
    });
    const forged = unsafePrepareMetadataCommit(fixture.repo, {
      expectedHead: revised.head,
      message,
    });
    const track = referenceNames.trackRef('actions-v2', 'T1');
    unsafeAtomicUpdateRefs(fixture.repo, [{
      kind: 'create',
      ref: track,
      newHead: forged.commit,
    }]);

    assert.throws(
      () => readBatonState(fixture.repo, 'actions-v2', {
      }),
      (error) => (
        error?.code === 'STALE_BINDING'
        && /inexact approved-target base/.test(error.message)
      ),
    );
  } finally {
    fixture.cleanup();
  }
});

test('a non-consuming candidate cannot bypass a repinned target after PROCEED', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product before target repin\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const first = engine.recordPlanRevision({
      planBytes: planBytes(),
      summary: 'Initial plan approved.',
    });
    engine.prepareTrackBase({ release: 'actions-v2', slice: 'S1' });
    appendDesign(engine);
    const captain = appendCaptain(engine);

    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'README.md', 'product after target repin\n');
    const movedTarget = commitAll(fixture.repo, 'move approved target');
    const nextBytes = planBytes(metadata(2, first.plan));
    const revised = engine.recordPlanRevision({
      planBytes: nextBytes,
      summary: 'Reapprove the unchanged slice against the moved target.',
    });

    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T1');
    write(fixture.repo, 'src/product.txt', 'candidate from stale pre-repin base\n');
    const bypass = commitAll(fixture.repo, 'test: candidate omits repinned target');
    assert.equal(isDescendant(fixture.repo, movedTarget, bypass), false);
    assert.throws(
      () => engine.appendReceipt({
        release: 'actions-v2',
        slice: 'S1',
        role: 'implementer',
        result: 'candidate',
        summary: 'Unsafe candidate from the pre-repin Captain receipt.',
        candidate: bypass,
        checkResults: 'focused checks PASS\n',
      }),
      (error) => error?.code === 'CHANGED_CANDIDATE',
    );
    assert.equal(
      resolveRef(fixture.repo, referenceNames.trackRef('actions-v2', 'T1')),
      bypass,
    );
    assert.equal(captain.receipt.result, 'proceed');

    const track = referenceNames.trackRef('actions-v2', 'T1');
    const exactBase = unsafePrepareApprovedTargetBase(fixture.repo, {
      targetRef: track,
      expectedHead: captain.receipt_commit,
      approvedTarget: movedTarget,
    });
    const arbitraryBase = git(
      fixture.repo,
      'commit-tree',
      git(fixture.repo, 'rev-parse', `${exactBase}^{tree}`),
      '-p',
      captain.receipt_commit,
      '-p',
      movedTarget,
      '-m',
      'arbitrary non-Baton merge',
    );
    assert.notEqual(arbitraryBase, exactBase);
    git(fixture.repo, 'switch', '-q', '--detach', arbitraryBase);
    write(fixture.repo, 'src/product.txt', 'candidate from arbitrary merge\n');
    const arbitraryCandidate = commitAll(fixture.repo, 'test: candidate from arbitrary merge');
    assert.equal(isDescendant(fixture.repo, captain.receipt_commit, arbitraryCandidate), true);
    assert.equal(isDescendant(fixture.repo, movedTarget, arbitraryCandidate), true);
    assert.equal(isDescendant(fixture.repo, exactBase, arbitraryCandidate), false);
    unsafeAtomicUpdateRefs(fixture.repo, [{
      kind: 'update',
      ref: track,
      expectedHead: bypass,
      newHead: arbitraryCandidate,
    }]);

    const product = productTreeIdentity(fixture.repo, arbitraryCandidate);
    const forgedMessage = renderReceiptCommit({
      subject: 'forge candidate from arbitrary merge',
      detail: Buffer.alloc(0),
      receipt: {
        version: 1,
        release: 'actions-v2',
        slice: 'S1',
        role: 'implementer',
        result: 'candidate',
        attempt: 1,
        plan: revised.plan,
        contract: parsePlanBytes(nextBytes).metadata.contracts.S1,
        binds: captain.receipt_commit,
        candidate: arbitraryCandidate,
        product_tree: product.productTree,
        inputs: {},
        checks: digestBytes(Buffer.from('focused checks PASS\n')),
        detail: digestBytes(Buffer.alloc(0)),
        summary: 'Forged candidate bypasses the exact prepared base.',
      },
    });
    const forged = unsafePrepareMetadataCommit(fixture.repo, {
      expectedHead: arbitraryCandidate,
      message: forgedMessage,
    });
    unsafeAtomicUpdateRefs(fixture.repo, [{
      kind: 'update',
      ref: track,
      expectedHead: arbitraryCandidate,
      newHead: forged.commit,
    }]);
    assert.throws(
      () => readBatonState(fixture.repo, 'actions-v2', {
      }),
      (error) => (
        error?.code === 'CHANGED_CANDIDATE'
        && /omits its exact prepared base/.test(error.message)
      ),
    );
  } finally {
    fixture.cleanup();
  }
});

test('a consuming candidate remains valid after retained PROCEED and target repin', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product before target repin\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const initial = consumedPlan();
    const first = engine.recordPlanRevision({
      planBytes: planBytes(initial),
      summary: 'Approve one producer and consumer.',
    });
    const producer = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'producer v1\n',
    });
    const review = designConsumer(engine, 'proceed');

    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'README.md', 'product after target repin\n');
    const movedTarget = commitAll(fixture.repo, 'move approved target');
    const revised = engine.recordPlanRevision({
      planBytes: planBytes(metadata(2, first.plan, { tracks: initial.tracks })),
      summary: 'Retain the reviewed consumer against the moved target.',
    });
    const prepared = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S2',
    });
    assert.equal(prepared.changed, true);
    assert.equal(isDescendant(fixture.repo, movedTarget, prepared.base), true);
    assert.equal(
      isDescendant(fixture.repo, producer.passed.receipt_commit, prepared.base),
      true,
    );

    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T2');
    write(fixture.repo, 'src/consumer.txt', 'consumer after target repin\n');
    const candidate = commitAll(fixture.repo, 'feat: consume after target repin');
    const implemented = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S2',
      role: 'implementer',
      result: 'candidate',
      summary: 'Consumer includes its exact repinned target and input base.',
      base: prepared.base,
      candidate,
      checkResults: 'consumer checks PASS\n',
    });
    const state = readBatonState(fixture.repo, 'actions-v2', {
    });
    const consumer = state.slices.find(({ location }) => location.slice.id === 'S2');
    assert.equal(consumer.current_receipt.oid, implemented.receipt_commit);
    assert.equal(implemented.receipt.plan, revised.plan);
    assert.equal(implemented.receipt.binds, review.captain.receipt_commit);
  } finally {
    fixture.cleanup();
  }
});

test('revision cannot silently replace release authority', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const first = engine.recordPlanRevision({
      planBytes: planBytes(),
      summary: 'Initial plan approved.',
    });
    const replacement = metadata(2, first.plan, {
      repository: 'other/repository',
    });
    assert.throws(
      () => engine.recordPlanRevision({
        planBytes: planBytes(replacement),
        summary: 'Invalid replacement.',
      }),
      (error) => error?.code === 'REPLACED_RELEASE_AUTHORITY',
    );
  } finally {
    fixture.cleanup();
  }
});

test('an approved removal writes one compact retirement under the same release', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const secondSlice = {
      id: 'S2',
      outcome: 'Deliver a temporary second outcome.',
      scope: { include: ['src/temporary.txt'], exclude: [] },
      acceptance: [{ id: 'A2', text: 'The temporary outcome is observable.' }],
      checks: ['node --test'],
      constraints: [],
      depends_on: [],
      consumes: [],
    };
    const initial = metadata(1, null, {
      tracks: [{
        ...metadata().tracks[0],
        slices: [...metadata().tracks[0].slices, secondSlice],
      }],
    });
    const first = engine.recordPlanRevision({
      planBytes: planBytes(initial),
      summary: 'Initial two-slice plan approved.',
    });
    const revised = metadata(2, first.plan);
    const result = engine.recordPlanRevision({
      planBytes: planBytes(revised),
      summary: 'Revision retaining S1 and retiring S2 approved.',
    });
    assert.equal(result.changed, true);
    assert.equal(result.retirements.length, 1);
    assert.equal(result.retirements[0].slice, 'S2');
    assert.equal(result.retirements[0].receipt.role, 'planner');
    assert.equal(result.retirements[0].receipt.result, 'retired');
    assert.equal(result.retirements[0].receipt.plan, result.plan);
    assert.equal(result.retirements[0].receipt.binds, result.receipt_commit);
    assert.equal(
      resolveRef(fixture.repo, referenceNames.releaseRef('actions-v2')),
      result.head,
    );
    const state = readBatonState(fixture.repo, 'actions-v2');
    assert.deepEqual(
      state.slices.map(({ location }) => location.slice.id),
      ['S1'],
    );

    const carried = engine.recordPlanRevision({
      planBytes: planBytes(metadata(3, result.plan)),
      summary: 'The retired slice remains absent without another retirement.',
    });
    assert.equal(carried.changed, true);
    assert.equal(carried.retirements.length, 0);
    assert.deepEqual(
      readBatonState(fixture.repo, 'actions-v2').slices.map(
        ({ location }) => location.slice.id,
      ),
      ['S1'],
    );

    const head = resolveRef(fixture.repo, referenceNames.releaseRef('actions-v2'));
    assert.throws(
      () => engine.recordPlanRevision({
        planBytes: planBytes(metadata(4, carried.plan, { tracks: initial.tracks })),
        summary: 'Invalidly reuse the retired slice identity.',
      }),
      (error) => error?.code === 'INVALID_RETIREMENT',
    );
    assert.equal(
      resolveRef(fixture.repo, referenceNames.releaseRef('actions-v2')),
      head,
    );
  } finally {
    fixture.cleanup();
  }
});

test('final assembly preserves the exact Planner retirement authority', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const temporarySlice = {
      id: 'S2',
      outcome: 'Deliver a temporary outcome.',
      scope: { include: ['src/temporary.txt'], exclude: [] },
      acceptance: [{ id: 'A2', text: 'The temporary outcome is observable.' }],
      checks: ['node --test'],
      constraints: [],
      depends_on: [],
      consumes: [],
    };
    const initial = metadata(1, null, {
      tracks: [{
        ...metadata().tracks[0],
        slices: [...metadata().tracks[0].slices, temporarySlice],
      }],
    });
    const first = engine.recordPlanRevision({
      planBytes: planBytes(initial),
      summary: 'Approve one retained and one temporary slice.',
    });
    const revised = engine.recordPlanRevision({
      planBytes: planBytes(metadata(2, first.plan)),
      summary: 'Retire the temporary slice.',
    });
    assert.equal(revised.retirements.length, 1);
    const passed = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'retained product\n',
    });
    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'upstream.txt', 'advanced\n');
    commitAll(fixture.repo, 'advance target after retirement');

    const assembled = engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'Assemble from the retirement-complete release authority.',
    });
    assert.equal(assembled.receipt.binds, revised.head);
    assert.equal(isDescendant(fixture.repo, revised.head, assembled.candidate), true);
    assert.equal(isDescendant(fixture.repo, passed.passed.receipt_commit, assembled.candidate), true);
    assert.equal(readBatonState(fixture.repo, 'actions-v2').assembly.next_role, 'verifier');
  } finally {
    fixture.cleanup();
  }
});

test('one slice advances through concise receipts and merges the exact fresh PASS', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    const target = commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    engine.recordPlanRevision({
      planBytes: planBytes(),
      summary: 'Plan approved.',
    });

    const design = appendDesign(engine);
    assert.equal(design.receipt.attempt, 1);
    assert.equal(appendDesign(engine).changed, false);
    const proceed = appendCaptain(engine);
    assert.equal(proceed.receipt.binds, design.receipt_commit);

    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T1');
    write(fixture.repo, 'src/product.txt', 'delivered\n');
    const candidate = commitAll(fixture.repo, 'feat: deliver product');
    const implemented = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'candidate',
      summary: 'The exact candidate satisfies its focused checks.',
      detail: 'A1: src/product.txt contains the delivered outcome.',
      candidate,
      checkResults: 'implementer: node --test PASS\n',
    });
    assert.equal(implemented.receipt.candidate, candidate);
    assert.equal(implemented.receipt.binds, proceed.receipt_commit);

    const passed = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'verifier',
      result: 'pass',
      summary: 'Fresh verification passed the approved contract.',
      detail: 'A1 independently observed. PASS.',
      candidate,
      checkResults: 'verifier: independently rerun node --test PASS\n',
    });
    assert.notEqual(passed.receipt.checks, implemented.receipt.checks);

    const direct = engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'The one-track candidate needs no extra assembly.',
    });
    assert.equal(direct.changed, false);
    assert.equal(direct.direct, true);
    assert.equal(direct.candidate, candidate);
    assert.equal(resolveRef(fixture.repo, 'refs/heads/main'), target);
    const beforeMerge = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(beforeMerge.plan.approval.receipt.target, target);
    assert.equal(beforeMerge.plan.target_stale, false);
    assert.equal(resolveRef(fixture.repo, 'refs/heads/main'), target);

    const merged = engine.mergePassedCandidate({
      release: 'actions-v2',
      summary: 'Merged the exact candidate covered by fresh PASS.',
    });
    assert.equal(merged.changed, true);
    assert.equal(merged.candidate, candidate);
    assert.equal(merged.result_commit, candidate);
    assert.equal(resolveRef(fixture.repo, 'refs/heads/main'), candidate);
    const afterMerge = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(afterMerge.assembly.outcome, 'merged');
    assert.equal(afterMerge.plan.target_stale, false);
    assert.equal(
      afterMerge.diagnostics.some(({ code }) => code === 'TARGET_DIVERGED'),
      false,
    );
    const retry = engine.mergePassedCandidate({
      release: 'actions-v2',
      summary: 'Merged the exact candidate covered by fresh PASS.',
    });
    assert.equal(retry.changed, false);
    assert.equal(retry.result_commit, candidate);
    assert.equal(isDescendant(fixture.repo, target, candidate), true);
  } finally {
    fixture.cleanup();
  }
});

test('candidate validation rejects reserved-root mutation without changing refs', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const approved = engine.recordPlanRevision({
      planBytes: planBytes(),
      summary: 'Plan approved.',
    });
    appendDesign(engine);
    const proceed = appendCaptain(engine);
    const prepared = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S1',
    });
    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T1');
    write(
      fixture.repo,
      referenceNames.planPath('actions-v2'),
      Buffer.concat([planBytes(), Buffer.from('\nreserved mutation\n')]),
    );
    const candidate = commitAll(fixture.repo, 'forge reserved record mutation');
    assert.equal(
      productTreeIdentity(fixture.repo, candidate).productTree,
      productTreeIdentity(fixture.repo, prepared.base).productTree,
    );
    const refsBefore = git(
      fixture.repo,
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads',
    );

    assert.throws(
      () => engine.appendReceipt({
        release: 'actions-v2',
        slice: 'S1',
        role: 'implementer',
        result: 'candidate',
        summary: 'Attempt to admit a candidate that changed reserved records.',
        candidate,
        checkResults: 'focused checks PASS\n',
      }),
      (error) => error?.code === 'RESERVED_RECORD_ROOT_CHANGED',
    );
    assert.equal(
      git(
        fixture.repo,
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads',
      ),
      refsBefore,
    );

    const product = productTreeIdentity(fixture.repo, candidate);
    const forged = appendMetadataReceipt(
      fixture.repo,
      candidate,
      'forge reserved-root candidate receipt',
      {
        version: 1,
        release: 'actions-v2',
        slice: 'S1',
        role: 'implementer',
        result: 'candidate',
        attempt: 1,
        plan: approved.plan,
        contract: parsePlanBytes(planBytes()).metadata.contracts.S1,
        binds: proceed.receipt_commit,
        candidate,
        product_tree: product.productTree,
        inputs: {},
        checks: digestBytes(Buffer.from('forged checks')),
        summary: 'Forge structurally invalid candidate evidence.',
      },
    );
    unsafeAtomicUpdateRefs(fixture.repo, [{
      kind: 'update',
      ref: referenceNames.trackRef('actions-v2', 'T1'),
      newHead: forged,
      expectedHead: candidate,
    }]);
    assert.throws(
      () => readBatonState(fixture.repo, 'actions-v2'),
      (error) => error?.code === 'RESERVED_RECORD_ROOT_CHANGED',
    );
  } finally {
    fixture.cleanup();
  }
});

test('ancillary paths, extra checks, and evidence correction repair one commitment forward', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    const target = commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const approved = engine.recordPlanRevision({
      planBytes: planBytes(),
      summary: 'The observable product commitment is approved.',
    });
    const contract = parsePlanBytes(planBytes()).metadata.contracts.S1;

    appendDesign(
      engine,
      'Deliver src/product.txt and discover any ancillary test or oracle support needed.',
    );
    appendCaptain(engine);
    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T1');
    write(fixture.repo, 'src/product.txt', 'delivered\n');
    write(fixture.repo, 'test/product.test.mjs', 'assert delivered behavior\n');
    write(fixture.repo, 'test/oracles/product.mjs', 'observe delivered behavior\n');
    write(fixture.repo, 'scripts/maintain-product.mjs', 'maintain test evidence\n');
    const candidate = commitAll(fixture.repo, 'feat: deliver product with discovered support');
    const candidateInput = {
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'candidate',
      summary: 'The outcome and discovered support pass required and focused checks.',
      detail: (
        'A1: src/product.txt is delivered. '
        + 'Discovered test/product.test.mjs, test/oracles/product.mjs, '
        + 'and scripts/maintain-product.mjs as ancillary evidence.'
      ),
      candidate,
      checkResults: (
        'required: node --test PASS\n'
        + 'additional: node --test test/product.test.mjs PASS\n'
      ),
    };
    const implemented = engine.appendReceipt(candidateInput);
    const retry = engine.appendReceipt(candidateInput);
    assert.equal(retry.changed, false);
    assert.equal(retry.receipt_commit, implemented.receipt_commit);
    assert.equal(implemented.receipt.plan, approved.plan);
    assert.equal(implemented.receipt.contract, contract);
    assert.equal(implemented.receipt.attempt, 1);

    const changed = git(fixture.repo, 'diff', '--name-only', target, candidate)
      .trim().split('\n');
    for (const path of [
      'src/product.txt',
      'test/product.test.mjs',
      'test/oracles/product.mjs',
      'scripts/maintain-product.mjs',
    ]) {
      assert.equal(changed.includes(path), true, path);
    }
    let state = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(state.plan.oid, approved.plan);
    assert.equal(state.plan.metadata.revision, 1);
    assert.equal(state.slices[0].location.slice.id, 'S1');
    assert.equal(state.slices[0].attempt, 1);
    assert.equal(state.slices[0].next_role, 'verifier');

    const failed = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'verifier',
      result: 'fail',
      summary: 'The contract is adequate but the oracle observation is incomplete.',
      detail: 'A1 needs one corrected oracle observation; no plan change is required.',
      candidate,
      checkResults: 'required: node --test PASS\nadditional oracle evidence INCOMPLETE\n',
    });
    assert.equal(failed.receipt.plan, approved.plan);
    assert.equal(failed.receipt.attempt, 1);

    git(fixture.repo, 'commit', '--allow-empty', '-q', '-m', 'test: correct oracle evidence');
    const correctedCandidate = git(fixture.repo, 'rev-parse', 'HEAD');
    const corrected = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'candidate',
      summary: 'The same product has corrected acceptance evidence.',
      detail: 'A1: corrected oracle observation binds the unchanged delivered product.',
      candidate: correctedCandidate,
      checkResults: (
        'required: node --test PASS\n'
        + 'additional: node --test test/product.test.mjs PASS\n'
        + 'additional oracle observation PASS\n'
      ),
    });
    assert.equal(corrected.receipt.plan, approved.plan);
    assert.equal(corrected.receipt.binds, failed.receipt_commit);
    assert.equal(corrected.receipt.attempt, 2);
    assert.equal(corrected.receipt.product_tree, implemented.receipt.product_tree);

    engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'verifier',
      result: 'pass',
      summary: 'Fresh verification observed the committed behavior and corrected evidence.',
      candidate: correctedCandidate,
      checkResults: 'required and additional checks independently PASS\n',
    });
    state = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(state.plan.oid, approved.plan);
    assert.equal(state.plan.metadata.revision, 1);
    assert.equal(state.release, 'actions-v2');
    assert.equal(state.slices[0].location.slice.id, 'S1');
    assert.equal(state.slices[0].attempt, 2);
    assert.ok(state.slices[0].pass);
  } finally {
    fixture.cleanup();
  }
});

function isDescendant(repo, ancestor, descendant) {
  try {
    git(repo, 'merge-base', '--is-ancestor', ancestor, descendant);
    return true;
  } catch {
    return false;
  }
}

test('Captain revision and Verifier failure keep one slice identity with new attempts', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    engine.recordPlanRevision({
      planBytes: planBytes(),
      summary: 'Plan approved.',
    });
    appendDesign(engine, 'First design attempt.');
    appendCaptain(engine, 'revise');
    const revisedDesign = appendDesign(engine, 'Second design attempt fixes the named issue.');
    assert.equal(revisedDesign.receipt.attempt, 2);
    appendCaptain(engine, 'proceed');

    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T1');
    write(fixture.repo, 'src/product.txt', 'first candidate\n');
    const firstCandidate = commitAll(fixture.repo, 'feat: first candidate');
    const first = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'candidate',
      summary: 'First exact candidate.',
      candidate: firstCandidate,
      checkResults: 'implementer PASS\n',
    });
    assert.equal(first.receipt.attempt, 2);
    const failed = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'verifier',
      result: 'fail',
      summary: 'The candidate violates A1.',
      detail: 'A1 observed the wrong value.',
      candidate: firstCandidate,
      checkResults: 'verifier FAIL\n',
    });
    assert.equal(failed.receipt.attempt, 2);

    write(fixture.repo, 'src/product.txt', 'repaired candidate\n');
    const repaired = commitAll(fixture.repo, 'fix: repair candidate');
    const second = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'candidate',
      summary: 'Repaired exact candidate.',
      candidate: repaired,
      checkResults: 'implementer PASS after repair\n',
    });
    assert.equal(second.receipt.attempt, 3);
    assert.equal(second.receipt.binds, failed.receipt_commit);
  } finally {
    fixture.cleanup();
  }
});

test('a linear head move before verification is recorded refreshes the exact candidate', () => {
  const { fixture, engine, implemented } = candidateAwaitingVerdict();
  try {
    write(fixture.repo, 'src/product.txt', 'corrected candidate\n');
    const corrected = commitAll(fixture.repo, 'fix: correct candidate before verification');

    let state = readBatonState(fixture.repo, 'actions-v2');
    let sliceState = state.slices[0];
    assert.equal(sliceState.stage, 'implement');
    assert.equal(sliceState.status, 'ready');
    assert.equal(sliceState.next_role, 'implementer');
    assert.equal(sliceState.outcome, 'stale');
    assert.equal(sliceState.attempt, implemented.receipt.attempt + 1);
    assert.equal(sliceState.current_receipt.oid, implemented.receipt_commit);
    const prepared = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S1',
    });
    assert.equal(prepared.changed, false);
    assert.equal(prepared.base, implemented.receipt_commit);
    assert.equal(
      resolveRef(fixture.repo, referenceNames.trackRef('actions-v2', 'T1')),
      corrected,
    );

    const refreshed = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'candidate',
      summary: 'The corrected head passed focused checks.',
      candidate: corrected,
      checkResults: 'implementer PASS after correction\n',
    });
    assert.equal(refreshed.receipt.binds, implemented.receipt_commit);
    assert.equal(refreshed.receipt.attempt, implemented.receipt.attempt + 1);
    assert.equal(refreshed.receipt.candidate, corrected);

    state = readBatonState(fixture.repo, 'actions-v2');
    [sliceState] = state.slices;
    assert.equal(sliceState.stage, 'verify');
    assert.equal(sliceState.next_role, 'verifier');
    assert.equal(sliceState.current_receipt.oid, refreshed.receipt_commit);

    const passed = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'verifier',
      result: 'pass',
      summary: 'The refreshed candidate passes independent verification.',
      candidate: corrected,
      checkResults: 'verifier PASS\n',
    });
    assert.equal(passed.receipt.binds, refreshed.receipt_commit);
  } finally {
    fixture.cleanup();
  }
});

test('a repaired candidate can refresh again before its own Verifier verdict', () => {
  const {
    fixture, engine, candidate, implemented,
  } = candidateAwaitingVerdict();
  try {
    const failed = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'verifier',
      result: 'fail',
      summary: 'The first candidate violates A1.',
      candidate,
      checkResults: 'verifier FAIL\n',
    });
    write(fixture.repo, 'src/product.txt', 'second candidate\n');
    const secondCandidate = commitAll(fixture.repo, 'fix: repair first candidate');
    const second = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'candidate',
      summary: 'The repaired candidate passes focused checks.',
      candidate: secondCandidate,
      checkResults: 'implementer PASS after verifier FAIL\n',
    });
    assert.equal(second.receipt.binds, failed.receipt_commit);
    assert.equal(second.receipt.attempt, implemented.receipt.attempt + 1);

    write(fixture.repo, 'src/product.txt', 'third candidate\n');
    const thirdCandidate = commitAll(
      fixture.repo,
      'fix: correct repaired candidate before re-verification',
    );
    let state = readBatonState(fixture.repo, 'actions-v2');
    assert.equal(state.slices[0].stage, 'implement');
    assert.equal(state.slices[0].next_role, 'implementer');
    assert.equal(state.slices[0].attempt, second.receipt.attempt + 1);
    assert.equal(state.slices[0].current_receipt.oid, second.receipt_commit);
    const prepared = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S1',
    });
    assert.equal(prepared.changed, false);
    assert.equal(prepared.base, second.receipt_commit);
    assert.equal(
      resolveRef(fixture.repo, referenceNames.trackRef('actions-v2', 'T1')),
      thirdCandidate,
    );

    const third = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'candidate',
      summary: 'The exact third candidate passes focused checks.',
      candidate: thirdCandidate,
      checkResults: 'implementer PASS on refreshed repair\n',
    });
    assert.equal(third.receipt.binds, second.receipt_commit);
    assert.equal(third.receipt.attempt, second.receipt.attempt + 1);

    state = readBatonState(fixture.repo, 'actions-v2');
    assert.equal(state.slices[0].stage, 'verify');
    assert.equal(state.slices[0].next_role, 'verifier');
    assert.equal(state.slices[0].current_receipt.oid, third.receipt_commit);
  } finally {
    fixture.cleanup();
  }
});

test('a same-product linear head move refreshes identity without inventing a verdict', () => {
  const { fixture, engine, implemented } = candidateAwaitingVerdict();
  try {
    git(fixture.repo, 'commit', '--allow-empty', '-q', '-m', 'chore: retain exact evidence');
    const movedHead = git(fixture.repo, 'rev-parse', 'HEAD');
    const state = readBatonState(fixture.repo, 'actions-v2');
    assert.equal(state.slices[0].next_role, 'implementer');
    assert.equal(state.slices[0].attempt, implemented.receipt.attempt + 1);

    const refreshed = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'candidate',
      summary: 'The exact same-product head passed focused checks.',
      candidate: movedHead,
      checkResults: 'implementer PASS on exact head\n',
    });
    assert.equal(refreshed.receipt.product_tree, implemented.receipt.product_tree);
    assert.equal(refreshed.receipt.binds, implemented.receipt_commit);
    assert.equal(
      readBatonState(fixture.repo, 'actions-v2').slices[0].next_role,
      'verifier',
    );
  } finally {
    fixture.cleanup();
  }
});

test('a consuming slice prepares its existing base without resetting a moved candidate', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const initial = consumedPlan();
    const approved = engine.recordPlanRevision({
      planBytes: planBytes(initial),
      summary: 'Approve one producer and consumer.',
    });
    deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'producer\n',
    });
    designConsumer(engine, 'proceed');
    const initialBase = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S2',
    });
    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T2');
    write(fixture.repo, 'src/consumer.txt', 'first consumer candidate\n');
    const firstCandidate = commitAll(fixture.repo, 'feat: first consumer candidate');
    const implemented = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S2',
      role: 'implementer',
      result: 'candidate',
      summary: 'The first consumer candidate passes focused checks.',
      base: initialBase.base,
      candidate: firstCandidate,
      checkResults: 'consumer implementer PASS\n',
    });

    write(fixture.repo, 'src/consumer.txt', 'corrected consumer candidate\n');
    const corrected = commitAll(
      fixture.repo,
      'fix: correct consumer candidate before verification',
    );
    const prepared = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S2',
    });
    assert.equal(prepared.changed, false);
    assert.equal(prepared.base, implemented.receipt_commit);
    assert.equal(
      resolveRef(fixture.repo, referenceNames.trackRef('actions-v2', 'T2')),
      corrected,
    );

    const refreshed = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S2',
      role: 'implementer',
      result: 'candidate',
      summary: 'The corrected consumer candidate passes focused checks.',
      base: prepared.base,
      candidate: corrected,
      checkResults: 'consumer implementer PASS after correction\n',
    });
    assert.equal(refreshed.receipt.binds, implemented.receipt_commit);
    const state = readBatonState(fixture.repo, 'actions-v2');
    const consumer = state.slices.find(({ location }) => location.slice.id === 'S2');
    assert.equal(consumer.stage, 'verify');
    assert.equal(consumer.next_role, 'verifier');

    write(fixture.repo, 'src/consumer.txt', 'consumer with stale input authority\n');
    const drifted = commitAll(fixture.repo, 'test: move consumer before input changes');
    reviseProducer(
      engine,
      approved.plan,
      initial.tracks,
      'Change the producer contract and product.',
    );
    deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'changed producer\n',
    });
    assert.throws(
      () => engine.prepareTrackBase({
        release: 'actions-v2',
        slice: 'S2',
      }),
      (error) => error?.code === 'CHANGED_OWNER_HEAD',
    );
    assert.equal(
      resolveRef(fixture.repo, referenceNames.trackRef('actions-v2', 'T2')),
      drifted,
    );
  } finally {
    fixture.cleanup();
  }
});

test('candidate refresh rejects merge, receipt, reserved-record, and post-PASS movement', async (t) => {
  await t.test('merge movement', () => {
    const { fixture, implemented, candidate } = candidateAwaitingVerdict();
    try {
      const tree = git(fixture.repo, 'rev-parse', `${candidate}^{tree}`);
      const merge = git(
        fixture.repo,
        'commit-tree',
        tree,
        '-p',
        implemented.receipt_commit,
        '-p',
        candidate,
        '-m',
        'forge merged candidate head',
      );
      unsafeAtomicUpdateRefs(fixture.repo, [{
        kind: 'update',
        ref: referenceNames.trackRef('actions-v2', 'T1'),
        expectedHead: implemented.receipt_commit,
        newHead: merge,
      }]);
      assert.throws(
        () => readBatonState(fixture.repo, 'actions-v2'),
        (error) => error?.code === 'CHANGED_CANDIDATE',
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('reserved-record movement', () => {
    const { fixture } = candidateAwaitingVerdict();
    try {
      write(
        fixture.repo,
        referenceNames.planPath('actions-v2'),
        Buffer.concat([planBytes(), Buffer.from('\nreserved mutation\n')]),
      );
      commitAll(fixture.repo, 'forge reserved record movement');
      assert.throws(
        () => readBatonState(fixture.repo, 'actions-v2'),
        (error) => error?.code === 'RESERVED_RECORD_ROOT_CHANGED',
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('intervening Baton receipt', () => {
    const {
      fixture, implemented, candidate,
    } = candidateAwaitingVerdict();
    try {
      const intervening = appendMetadataReceipt(
        fixture.repo,
        implemented.receipt_commit,
        'forge intervening Baton receipt',
        {
          version: 1,
          release: 'actions-v2',
          role: 'planner',
          result: 'approved',
          plan: implemented.receipt.plan,
          binds: implemented.receipt_commit,
          target: candidate,
          summary: 'A receipt cannot intervene in candidate refresh history.',
        },
      );
      unsafeAtomicUpdateRefs(fixture.repo, [{
        kind: 'update',
        ref: referenceNames.trackRef('actions-v2', 'T1'),
        expectedHead: implemented.receipt_commit,
        newHead: intervening,
      }]);
      write(fixture.repo, 'src/product.txt', 'changed after intervening receipt\n');
      commitAll(fixture.repo, 'forge product after intervening receipt');
      assert.throws(
        () => readBatonState(fixture.repo, 'actions-v2'),
        (error) => error?.code === 'CHANGED_CANDIDATE',
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('post-PASS movement', () => {
    const {
      fixture, engine, candidate,
    } = candidateAwaitingVerdict();
    try {
      engine.appendReceipt({
        release: 'actions-v2',
        slice: 'S1',
        role: 'verifier',
        result: 'pass',
        summary: 'The exact candidate passes.',
        candidate,
        checkResults: 'verifier PASS\n',
      });
      write(fixture.repo, 'src/product.txt', 'changed after PASS\n');
      commitAll(fixture.repo, 'forge post-PASS movement');
      assert.throws(
        () => readBatonState(fixture.repo, 'actions-v2'),
        (error) => error?.code === 'CHANGED_CANDIDATE',
      );
    } finally {
      fixture.cleanup();
    }
  });
});

test('material behavior discovered in design still escalates before implementation', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const approved = engine.recordPlanRevision({
      planBytes: planBytes(),
      summary: 'The original observable behavior is approved.',
    });
    const design = appendDesign(
      engine,
      'Discovery shows the requested behavior would replace the approved product contract.',
    );
    const escalated = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'captain',
      result: 'escalate',
      summary: 'The material behavior needs a revised externally approved contract.',
      detail: 'ESCALATE: this is not ancillary support or an evidence correction.',
    });
    assert.equal(escalated.receipt.binds, design.receipt_commit);
    assert.equal(escalated.receipt.plan, approved.plan);

    const state = readBatonState(fixture.repo, 'actions-v2');
    assert.equal(state.plan.metadata.revision, 1);
    assert.equal(state.slices[0].location.slice.id, 'S1');
    assert.equal(state.slices[0].attempt, 1);
    assert.equal(state.slices[0].status, 'blocked');
    assert.equal(state.slices[0].next_role, 'planner');
    assert.equal(state.slices[0].outcome, 'escalate');

    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T1');
    write(fixture.repo, 'src/product.txt', 'unapproved replacement behavior\n');
    const candidate = commitAll(fixture.repo, 'feat: unapproved replacement');
    assert.throws(
      () => engine.appendReceipt({
        release: 'actions-v2',
        slice: 'S1',
        role: 'implementer',
        result: 'candidate',
        summary: 'This candidate must not bypass escalation.',
        candidate,
        checkResults: 'node --test PASS\n',
      }),
      (error) => error?.code === 'ROLE_NOT_ELIGIBLE',
    );
  } finally {
    fixture.cleanup();
  }
});

test('an unchanged design crosses an unrelated plan revision into Captain review', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const initial = metadata(1, null, {
      tracks: [metadata().tracks[0], unrelatedTrack()],
    });
    const first = engine.recordPlanRevision({
      planBytes: planBytes(initial),
      summary: 'Two independent slices approved.',
    });
    const designed = appendDesign(engine);

    const revisedTracks = structuredClone(initial.tracks);
    revisedTracks[1].slices[0].acceptance[0].text = (
      'The unrelated product change is independently observable.'
    );
    const revised = engine.recordPlanRevision({
      planBytes: planBytes(metadata(2, first.plan, { tracks: revisedTracks })),
      summary: 'Only the unrelated slice contract changed.',
    });
    const waiting = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(waiting.slices[0].next_role, 'captain');
    assert.equal(waiting.slices[0].current_receipt.oid, designed.receipt_commit);

    const captain = appendCaptain(engine);
    assert.equal(captain.receipt.plan, revised.plan);
    assert.equal(captain.receipt.binds, designed.receipt_commit);
    assert.equal(captain.receipt.attempt, designed.receipt.attempt);
  } finally {
    fixture.cleanup();
  }
});

test('Verifier FAIL repairs across an unrelated plan revision', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const initial = metadata(1, null, {
      tracks: [metadata().tracks[0], unrelatedTrack()],
    });
    const first = engine.recordPlanRevision({
      planBytes: planBytes(initial),
      summary: 'Two independent slices approved.',
    });
    appendDesign(engine);
    appendCaptain(engine);

    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T1');
    write(fixture.repo, 'src/product.txt', 'first candidate\n');
    const firstCandidate = commitAll(fixture.repo, 'feat: first candidate');
    const implemented = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'candidate',
      summary: 'First exact candidate.',
      candidate: firstCandidate,
      checkResults: 'implementer PASS\n',
    });
    const failed = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'verifier',
      result: 'fail',
      summary: 'The first candidate violates A1.',
      candidate: firstCandidate,
      checkResults: 'verifier FAIL\n',
    });
    assert.equal(failed.receipt.binds, implemented.receipt_commit);

    const revisedTracks = structuredClone(initial.tracks);
    revisedTracks[1].slices[0].checks = ['node --test test/unrelated.test.mjs'];
    const revised = engine.recordPlanRevision({
      planBytes: planBytes(metadata(2, first.plan, { tracks: revisedTracks })),
      summary: 'Only the unrelated slice checks changed.',
    });
    const repairState = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(repairState.slices[0].stage, 'implement');
    assert.equal(repairState.slices[0].outcome, 'fail');
    assert.equal(repairState.slices[0].current_receipt.oid, failed.receipt_commit);

    write(fixture.repo, 'src/product.txt', 'repaired candidate\n');
    const repairedCandidate = commitAll(fixture.repo, 'fix: repair candidate');
    const repaired = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'candidate',
      summary: 'Repaired exact candidate.',
      candidate: repairedCandidate,
      checkResults: 'implementer PASS after repair\n',
    });
    assert.equal(repaired.receipt.plan, revised.plan);
    assert.equal(repaired.receipt.binds, failed.receipt_commit);
    assert.equal(repaired.receipt.attempt, failed.receipt.attempt + 1);
  } finally {
    fixture.cleanup();
  }
});

test('one track advances only its first incomplete slice', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const serialPlan = metadata(1, null, {
      tracks: [{
        ...metadata().tracks[0],
        slices: [
          metadata().tracks[0].slices[0],
          {
            id: 'S2',
            outcome: 'Deliver the ordered follow-up.',
            scope: { include: ['src/second.txt'], exclude: [] },
            acceptance: [{ id: 'A2', text: 'The follow-up is observable.' }],
            checks: ['node --test'],
            constraints: [],
            depends_on: [],
            consumes: [],
          },
        ],
      }],
    });
    engine.recordPlanRevision({
      planBytes: planBytes(serialPlan),
      summary: 'Serial plan approved.',
    });

    const waiting = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(waiting.slices[0].next_role, 'implementer');
    assert.equal(waiting.slices[1].status, 'waiting');
    assert.equal(waiting.slices[1].next_role, 'none');
    assert.throws(
      () => engine.appendReceipt({
        release: 'actions-v2',
        slice: 'S2',
        role: 'implementer',
        result: 'designed',
        summary: 'Out-of-order design.',
      }),
      (error) => error?.code === 'DEPENDENCIES_NOT_READY',
    );

    deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'first\n',
    });
    const designed = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S2',
      role: 'implementer',
      result: 'designed',
      summary: 'The ordered follow-up is now eligible.',
    });
    assert.equal(designed.receipt.slice, 'S2');
  } finally {
    fixture.cleanup();
  }
});

test('a multi-slice track requires a fresh assembly PASS before Merge', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    const target = commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const serialPlan = metadata(1, null, {
      tracks: [{
        ...metadata().tracks[0],
        slices: [
          metadata().tracks[0].slices[0],
          {
            id: 'S2',
            outcome: 'Deliver the ordered follow-up.',
            scope: { include: ['src/second.txt'], exclude: [] },
            acceptance: [{ id: 'A2', text: 'The follow-up is observable.' }],
            checks: ['node --test'],
            constraints: [],
            depends_on: [],
            consumes: [],
          },
        ],
      }],
    });
    engine.recordPlanRevision({
      planBytes: planBytes(serialPlan),
      summary: 'Serial plan approved.',
    });
    const firstSlice = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'first\n',
    });
    const finalSlice = deliverSlice(engine, fixture.repo, {
      slice: 'S2',
      track: 'T1',
      file: 'src/second.txt',
      value: 'second\n',
    });

    let state = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(state.assembly.pass, null);
    assert.equal(state.assembly.next_role, 'merge');
    assert.throws(
      () => engine.mergePassedCandidate({
        release: 'actions-v2',
        summary: 'Unsafe direct Merge attempt.',
      }),
      (error) => error?.code === 'ASSEMBLY_PASS_REQUIRED',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/main'), target);

    const assembled = engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'Bind the complete serial track as an assembly candidate.',
    });
    assert.equal(assembled.changed, true);
    assert.equal(assembled.direct, false);
    assert.equal(assembled.candidate, finalSlice.passed.receipt_commit);
    assert.equal(
      isDescendant(fixture.repo, firstSlice.passed.receipt_commit, assembled.candidate),
      true,
    );
    assert.throws(
      () => engine.mergePassedCandidate({
        release: 'actions-v2',
        summary: 'Merge before fresh assembly verification.',
      }),
      (error) => error?.code === 'ASSEMBLY_PASS_REQUIRED',
    );
    const passed = engine.appendReceipt({
      release: 'actions-v2',
      role: 'verifier',
      result: 'pass',
      summary: 'Fresh verification passed the complete serial assembly.',
      candidate: assembled.candidate,
      checkResults: 'assembly verifier PASS\n',
    });
    assert.equal(passed.receipt.binds, assembled.receipt_commit);

    const merged = engine.mergePassedCandidate({
      release: 'actions-v2',
      summary: 'Merge the freshly verified serial assembly.',
    });
    assert.equal(merged.candidate, assembled.candidate);
    state = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(state.assembly.outcome, 'merged');
  } finally {
    fixture.cleanup();
  }
});

test('two passed tracks produce one exact assembly, one fresh verdict, and one merge', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    const target = commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const twoTracks = metadata(1, null, {
      tracks: [
        metadata().tracks[0],
        {
          id: 'T2',
          depends_on: [],
          slices: [{
            id: 'S2',
            outcome: 'Deliver a second independent change.',
            scope: { include: ['src/second.txt'], exclude: [] },
            acceptance: [{ id: 'A2', text: 'The second change is observable.' }],
            checks: ['node --test'],
            constraints: [],
            depends_on: [],
            consumes: [],
          }],
        },
      ],
    });
    engine.recordPlanRevision({
      planBytes: planBytes(twoTracks),
      summary: 'Two-track plan approved.',
    });
    const firstTrack = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'first\n',
    });
    const secondTrack = deliverSlice(engine, fixture.repo, {
      slice: 'S2',
      track: 'T2',
      file: 'src/second.txt',
      value: 'second\n',
    });

    const assembled = engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'Composed the two exact passed track candidates.',
    });
    assert.equal(assembled.changed, true);
    assert.equal(assembled.direct, false);
    assert.deepEqual(Object.keys(assembled.inputs), ['T1', 'T2']);
    assert.deepEqual(
      git(fixture.repo, 'rev-list', '--parents', '-n', '1', assembled.candidate).split(' '),
      [
        assembled.candidate,
        firstTrack.passed.receipt_commit,
        secondTrack.passed.receipt_commit,
      ],
    );
    const assemblyPass = engine.appendReceipt({
      release: 'actions-v2',
      role: 'verifier',
      result: 'pass',
      summary: 'Fresh verification passed the complete assembly.',
      detail: 'Both track outcomes and their interaction passed.',
      candidate: assembled.candidate,
      checkResults: 'assembly verifier PASS\n',
    });
    assert.equal(assemblyPass.receipt.binds, assembled.receipt_commit);

    const merged = engine.mergePassedCandidate({
      release: 'actions-v2',
      summary: 'Merged the exact assembly covered by fresh PASS.',
    });
    assert.equal(merged.changed, true);
    assert.equal(merged.candidate, assembled.candidate);
    assert.equal(merged.result_commit, assembled.candidate);
    assert.equal(resolveRef(fixture.repo, 'refs/heads/main'), assembled.candidate);
    assert.equal(isDescendant(fixture.repo, target, merged.result_commit), true);
    const afterMerge = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(afterMerge.plan.target_stale, false);
    assert.equal(
      afterMerge.diagnostics.some(({ code }) => code === 'TARGET_DIVERGED'),
      false,
    );
  } finally {
    fixture.cleanup();
  }
});

test('target advances stay out of track work and rebuild only the final assembly', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    const approvedTarget = commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const producer = metadata().tracks[0];
    const consumer = {
      id: 'T2',
      depends_on: ['T1'],
      slices: [{
        id: 'S2',
        outcome: 'Consume the verified first change.',
        scope: { include: ['src/second.txt'], exclude: [] },
        acceptance: [{ id: 'A2', text: 'The consumed change is observable.' }],
        checks: ['node --test'],
        constraints: [],
        depends_on: ['S1'],
        consumes: ['S1'],
      }],
    };
    engine.recordPlanRevision({
      planBytes: planBytes(metadata(1, null, { tracks: [producer, consumer] })),
      summary: 'Dependent tracks approved.',
    });
    const first = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'first\n',
    });

    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'upstream.txt', 'advanced once\n');
    const firstAdvance = commitAll(fixture.repo, 'advance target once');
    const prepared = engine.prepareTrackBase({ release: 'actions-v2', slice: 'S2' });
    assert.equal(isDescendant(fixture.repo, approvedTarget, prepared.base), true);
    assert.equal(isDescendant(fixture.repo, first.passed.receipt_commit, prepared.base), true);
    assert.equal(isDescendant(fixture.repo, firstAdvance, prepared.base), false);
    let state = readBatonState(fixture.repo, 'actions-v2');
    assert.equal(state.plan.target_stale, false);
    assert.equal(state.slices.find(({ location }) => location.slice.id === 'S2').next_role, 'implementer');

    const second = deliverSlice(engine, fixture.repo, {
      slice: 'S2',
      track: 'T2',
      file: 'src/second.txt',
      value: 'second\n',
    });
    const assembled = engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'Combine the latest target and exact passed tracks.',
    });
    assert.equal(assembled.receipt.target, firstAdvance);
    assert.equal(isDescendant(fixture.repo, firstAdvance, assembled.candidate), true);
    assert.equal(isDescendant(fixture.repo, first.passed.receipt_commit, assembled.candidate), true);
    assert.equal(isDescendant(fixture.repo, second.passed.receipt_commit, assembled.candidate), true);
    assert.equal(
      git(fixture.repo, 'rev-list', '--first-parent', assembled.candidate)
        .split('\n').includes(assembled.receipt.binds),
      true,
    );
    engine.appendReceipt({
      release: 'actions-v2',
      role: 'verifier',
      result: 'pass',
      summary: 'Fresh verification passed the first assembly.',
      candidate: assembled.candidate,
      checkResults: 'assembly PASS\n',
    });

    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'upstream-two.txt', 'advanced twice\n');
    const secondAdvance = commitAll(fixture.repo, 'advance target after assembly PASS');
    state = readBatonState(fixture.repo, 'actions-v2');
    assert.equal(state.assembly.outcome, 'stale');
    assert.equal(state.assembly.pass, null);
    assert.equal(state.assembly.next_role, 'merge');

    const rebuilt = engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'Rebuild only the final assembly against the latest target.',
    });
    assert.notEqual(rebuilt.candidate, assembled.candidate);
    assert.equal(rebuilt.receipt.target, secondAdvance);
    assert.equal(isDescendant(fixture.repo, secondAdvance, rebuilt.candidate), true);
    const freshPass = engine.appendReceipt({
      release: 'actions-v2',
      role: 'verifier',
      result: 'pass',
      summary: 'Fresh verification passed the rebuilt assembly.',
      candidate: rebuilt.candidate,
      checkResults: 'rebuilt assembly PASS\n',
    });
    const merged = engine.mergePassedCandidate({
      release: 'actions-v2',
      summary: 'Merge the rebuilt exact assembly.',
    });
    assert.equal(merged.receipt.binds, freshPass.receipt_commit);
    assert.equal(resolveRef(fixture.repo, 'refs/heads/main'), rebuilt.candidate);
    assert.equal(readBatonState(fixture.repo, 'actions-v2').assembly.outcome, 'merged');
  } finally {
    fixture.cleanup();
  }
});

test('changed middle slice restarts from a conflicting target and remains replayable', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/shared.txt', 'original target\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const firstPlan = metadata(1, null, {
      tracks: [{
        id: 'T1',
        depends_on: [],
        slices: [
          metadata().tracks[0].slices[0],
          {
            id: 'S2',
            outcome: 'Deliver the case domain on the current target.',
            scope: { include: ['src/shared.txt'], exclude: [] },
            acceptance: [{ id: 'A2', text: 'The case domain is observable.' }],
            checks: ['node --test'],
            constraints: [],
            depends_on: ['S1'],
            consumes: ['S1'],
          },
          {
            id: 'S3',
            outcome: 'Deliver one successor over the case domain.',
            scope: { include: ['src/successor.txt'], exclude: [] },
            acceptance: [{ id: 'A3', text: 'The successor observes the case domain.' }],
            checks: ['node --test'],
            constraints: [],
            depends_on: ['S2'],
            consumes: ['S2'],
          },
        ],
      }],
    });
    const approved = engine.recordPlanRevision({
      planBytes: planBytes(firstPlan),
      summary: 'Serial plan approved.',
    });
    const foundation = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'retained foundation\n',
    });
    const oldTail = deliverSlice(engine, fixture.repo, {
      slice: 'S2',
      track: 'T1',
      file: 'src/shared.txt',
      value: 'old case domain\n',
    });
    deliverSlice(engine, fixture.repo, {
      slice: 'S3',
      track: 'T1',
      file: 'src/successor.txt',
      value: 'old successor\n',
    });

    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'src/shared.txt', 'current target behaviour\n');
    const advancedTarget = commitAll(fixture.repo, 'advance target with conflicting behaviour');
    const revisedTracks = structuredClone(firstPlan.tracks);
    revisedTracks[0].slices[1].acceptance[0].text = (
      'The case domain preserves current target behaviour.'
    );
    engine.recordPlanRevision({
      planBytes: planBytes(metadata(2, approved.plan, { tracks: revisedTracks })),
      summary: 'Tail contract revised against the current target.',
    });

    const prepared = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S2',
    });
    assert.equal(prepared.changed, true);
    assert.deepEqual(
      readFileAtOID(fixture.repo, prepared.base, 'src/shared.txt'),
      Buffer.from('current target behaviour\n'),
    );
    assert.deepEqual(
      readFileAtOID(fixture.repo, prepared.base, 'src/product.txt'),
      Buffer.from('retained foundation\n'),
    );
    assert.equal(isDescendant(fixture.repo, advancedTarget, prepared.base), true);
    assert.equal(isDescendant(fixture.repo, foundation.passed.receipt_commit, prepared.base), true);
    assert.equal(isDescendant(fixture.repo, oldTail.passed.receipt_commit, prepared.base), true);

    engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S2',
      role: 'implementer',
      result: 'designed',
      summary: 'Resolve the case domain against the current target behaviour.',
      detail: 'Preserve the target and reapply the approved case-domain outcome.',
    });
    engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S2',
      role: 'captain',
      result: 'proceed',
      summary: 'The revised design covers the exact changed contract.',
      detail: 'PROCEED',
    });
    const implementationBase = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S2',
    });
    assert.equal(implementationBase.changed, false);
    assert.equal(
      productTreeIdentity(fixture.repo, implementationBase.base).productTree,
      productTreeIdentity(fixture.repo, prepared.base).productTree,
    );

    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T1');
    write(fixture.repo, 'src/shared.txt', 'current target plus case domain\n');
    const candidate = commitAll(fixture.repo, 'fix: reconcile revised tail');
    const implemented = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S2',
      role: 'implementer',
      result: 'candidate',
      summary: 'The revised tail preserves both products.',
      candidate,
      base: implementationBase.base,
      checkResults: 'revised tail implementer PASS\n',
    });
    engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S2',
      role: 'verifier',
      result: 'pass',
      summary: 'The revised tail passes independent verification.',
      candidate,
      checkResults: 'revised tail verifier PASS\n',
    });
    deliverSlice(engine, fixture.repo, {
      slice: 'S3',
      track: 'T1',
      file: 'src/successor.txt',
      value: 'successor over revised case domain\n',
    });
    const state = readBatonState(fixture.repo, 'actions-v2');
    const tail = state.slices.find(({ location }) => location.slice.id === 'S2');
    const successor = state.slices.find(({ location }) => location.slice.id === 'S3');
    assert.equal(tail.pass.receipt.binds, implemented.receipt_commit);
    assert.equal(tail.retained, false);
    assert.ok(successor.pass);
    const assembled = engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'Prepare the recovered serial release.',
    });
    const retried = engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'Prepare the recovered serial release.',
    });
    assert.equal(retried.changed, false);
    assert.equal(retried.candidate, assembled.candidate);
  } finally {
    fixture.cleanup();
  }
});

test('target replacement refuses to discard an undeclared predecessor product', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/shared.txt', 'original target\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const firstPlan = metadata(1, null, {
      tracks: [{
        id: 'T1',
        depends_on: [],
        slices: [
          metadata().tracks[0].slices[0],
          {
            id: 'S2',
            outcome: 'Deliver an independent tail change.',
            scope: { include: ['src/shared.txt'], exclude: [] },
            acceptance: [{ id: 'A2', text: 'The tail change is observable.' }],
            checks: ['node --test'],
            constraints: [],
            depends_on: [],
            consumes: [],
          },
        ],
      }],
    });
    const approved = engine.recordPlanRevision({
      planBytes: planBytes(firstPlan),
      summary: 'Independent serial plan approved.',
    });
    deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'undeclared predecessor\n',
    });
    deliverSlice(engine, fixture.repo, {
      slice: 'S2',
      track: 'T1',
      file: 'src/shared.txt',
      value: 'old tail\n',
    });
    const oldAuthority = resolveRef(fixture.repo, 'refs/heads/track/actions-v2/T1');

    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'src/shared.txt', 'conflicting target\n');
    commitAll(fixture.repo, 'advance target with conflict');
    const revisedTracks = structuredClone(firstPlan.tracks);
    revisedTracks[0].slices[1].acceptance[0].text = 'The revised tail is observable.';
    engine.recordPlanRevision({
      planBytes: planBytes(metadata(2, approved.plan, { tracks: revisedTracks })),
      summary: 'Independent tail contract revised.',
    });

    assert.throws(
      () => engine.prepareTrackBase({ release: 'actions-v2', slice: 'S2' }),
      (error) => error?.code === 'COMPOSITION_CONFLICT',
    );
    assert.equal(resolveRef(fixture.repo, 'refs/heads/track/actions-v2/T1'), oldAuthority);
  } finally {
    fixture.cleanup();
  }
});

test('one passed slice assembles an advanced target and binds that exact base', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    const approvedTarget = commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    engine.recordPlanRevision({
      planBytes: planBytes(),
      summary: 'One-slice plan approved.',
    });
    const passed = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'delivered\n',
    });
    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'upstream.txt', 'new target work\n');
    const advancedTarget = commitAll(fixture.repo, 'advance target');

    const assembled = engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'Assemble the latest target and passed slice.',
    });
    assert.equal(assembled.direct, false);
    assert.equal(assembled.receipt.base, advancedTarget);
    assert.equal(assembled.receipt.target, advancedTarget);
    assert.equal(isDescendant(fixture.repo, advancedTarget, assembled.candidate), true);
    assert.equal(isDescendant(fixture.repo, passed.passed.receipt_commit, assembled.candidate), true);
    assert.equal(readBatonState(fixture.repo, 'actions-v2').assembly.next_role, 'verifier');

    const forgedReceipt = {
      ...assembled.receipt,
      base: approvedTarget,
      summary: 'Falsely claim the old approved base for the advanced target.',
    };
    const forged = appendMetadataReceipt(
      fixture.repo,
      assembled.candidate,
      'forge assembly base',
      forgedReceipt,
    );
    unsafeAtomicUpdateRefs(fixture.repo, [{
      kind: 'update',
      ref: referenceNames.releaseRef('actions-v2'),
      newHead: forged,
      expectedHead: assembled.receipt_commit,
    }]);
    assert.throws(
      () => readBatonState(fixture.repo, 'actions-v2'),
      (error) => error?.code === 'STALE_BINDING' && /invalid evidence/.test(error.message),
    );
  } finally {
    fixture.cleanup();
  }
});

test('assembly replays false history across serial multi-attempt tracks at one exact OID', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'shared.txt', 'obsolete history\n');
    commitAll(fixture.repo, 'obsolete assembly history');
    const engine = actions(fixture.repo);
    const slice = (id, file, consumes = []) => ({
      id,
      outcome: `Deliver ${id}.`,
      scope: { include: [file], exclude: [] },
      acceptance: [{ id: `${id}-A1`, text: `${id} is observable.` }],
      checks: ['node --test'],
      constraints: [],
      depends_on: [...consumes],
      consumes: [...consumes],
    });
    const assemblyPlan = metadata(1, null, {
      tracks: [
        { id: 'T2', depends_on: [], slices: [slice('S2', 'src/producer.txt', ['S0'])] },
        {
          id: 'T1',
          depends_on: [],
          slices: [
            slice('S1', 'src/consumer.txt', ['S0']),
            slice('S1B', 'src/serial.txt'),
          ],
        },
        { id: 'T0', depends_on: [], slices: [slice('S0', 'shared.txt')] },
      ],
    });
    const approved = engine.recordPlanRevision({
      planBytes: planBytes(assemblyPlan),
      summary: 'Approve false-history assembly coverage.',
    });
    const foundation = deliverSlice(engine, fixture.repo, {
      slice: 'S0',
      track: 'T0',
      file: 'shared.txt',
      value: 'reviewed foundation\n',
    });
    const producer = deliverSlice(engine, fixture.repo, {
      slice: 'S2',
      track: 'T2',
      file: 'src/producer.txt',
      value: 'exact producer delta\n',
      extraWrites: { 'shared.txt': 'current consumer foundation\n' },
    });

    const parsed = parsePlanBytes(planBytes(assemblyPlan));
    const common = {
      version: 1,
      release: 'actions-v2',
      slice: 'S1',
      plan: approved.plan,
      contract: parsed.metadata.contracts.S1,
      attempt: 1,
    };
    const design = appendMetadataReceipt(
      fixture.repo,
      approved.receipt_commit,
      'legacy assembly consumer design',
      {
        ...common,
        role: 'implementer',
        result: 'designed',
        binds: approved.receipt_commit,
        summary: 'Legacy consumer design predates exact base evidence.',
      },
    );
    const captain = appendMetadataReceipt(
      fixture.repo,
      design,
      'legacy assembly consumer PROCEED',
      {
        ...common,
        role: 'captain',
        result: 'proceed',
        binds: design,
        summary: 'Proceed with the retained legacy consumer.',
      },
    );
    git(fixture.repo, 'switch', '-q', '--detach', captain);
    write(fixture.repo, 'shared.txt', 'reviewed foundation\n');
    write(fixture.repo, 'src/consumer.txt', 'retained consumer delta\n');
    const legacyCandidate = commitAll(fixture.repo, 'legacy consumer false history');
    const legacyIdentity = productTreeIdentity(
      fixture.repo,
      legacyCandidate
    );
    const pins = { S0: foundation.passed.receipt.product_tree };
    const candidateReceipt = appendMetadataReceipt(
      fixture.repo,
      legacyCandidate,
      'legacy assembly consumer candidate',
      {
        ...common,
        role: 'implementer',
        result: 'candidate',
        binds: captain,
        candidate: legacyCandidate,
        product_tree: legacyIdentity.productTree,
        inputs: pins,
        checks: digestBytes(Buffer.from('legacy assembly candidate PASS\n')),
        summary: 'Legacy consumer binds the reviewed foundation digest.',
      },
    );
    const legacyPass = appendMetadataReceipt(
      fixture.repo,
      candidateReceipt,
      'legacy assembly consumer PASS',
      {
        ...common,
        role: 'verifier',
        result: 'pass',
        binds: candidateReceipt,
        candidate: legacyCandidate,
        product_tree: legacyIdentity.productTree,
        inputs: pins,
        checks: digestBytes(Buffer.from('legacy assembly verifier PASS\n')),
        summary: 'Legacy consumer passed fresh verification.',
      },
    );
    unsafeAtomicUpdateRefs(fixture.repo, [{
      kind: 'create',
      ref: referenceNames.trackRef('actions-v2', 'T1'),
      newHead: legacyPass,
    }]);

    engine.prepareTrackBase({ release: 'actions-v2', slice: 'S1B' });
    engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1B',
      role: 'implementer',
      result: 'designed',
      summary: 'Serial follow-up has one bounded design.',
    });
    engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1B',
      role: 'captain',
      result: 'proceed',
      summary: 'Proceed with the serial follow-up.',
    });
    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T1');
    write(fixture.repo, 'src/serial.txt', 'first attempt\n');
    const firstSerialCandidate = commitAll(fixture.repo, 'serial first attempt');
    engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1B',
      role: 'implementer',
      result: 'candidate',
      summary: 'First serial candidate passed focused checks.',
      candidate: firstSerialCandidate,
      checkResults: 'serial attempt one implementer PASS\n',
    });
    const failed = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1B',
      role: 'verifier',
      result: 'fail',
      summary: 'First serial candidate needs one correction.',
      candidate: firstSerialCandidate,
      checkResults: 'serial attempt one verifier FAIL\n',
    });
    write(fixture.repo, 'src/serial.txt', 'second attempt\n');
    const finalSerialCandidate = commitAll(fixture.repo, 'serial second attempt');
    const repaired = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1B',
      role: 'implementer',
      result: 'candidate',
      summary: 'Second serial candidate repairs the finding.',
      candidate: finalSerialCandidate,
      checkResults: 'serial attempt two implementer PASS\n',
    });
    assert.equal(repaired.receipt.attempt, 2);
    assert.equal(repaired.receipt.binds, failed.receipt_commit);
    const serialPass = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1B',
      role: 'verifier',
      result: 'pass',
      summary: 'Second serial candidate passed fresh verification.',
      candidate: finalSerialCandidate,
      checkResults: 'serial attempt two verifier PASS\n',
    });
    assert.equal(
      isDescendant(fixture.repo, legacyPass, serialPass.receipt_commit),
      true,
    );
    assert.throws(
      () => git(
        fixture.repo,
        'merge-tree',
        '--write-tree',
        '--no-messages',
        producer.passed.receipt_commit,
        serialPass.receipt_commit,
      ),
    );
    const assembled = engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'Compose ordered tracks from their exact product authorities.',
    });
    assert.deepEqual(Object.keys(assembled.inputs), ['T2', 'T1', 'T0']);
    assert.deepEqual(
      git(fixture.repo, 'rev-list', '--parents', '-n', '1', assembled.candidate).split(' '),
      [assembled.candidate, producer.passed.receipt_commit, serialPass.receipt_commit],
    );
    assert.deepEqual(
      readFileAtOID(fixture.repo, assembled.candidate, 'shared.txt'),
      Buffer.from('current consumer foundation\n'),
    );
    assert.deepEqual(
      readFileAtOID(fixture.repo, assembled.candidate, 'src/producer.txt'),
      Buffer.from('exact producer delta\n'),
    );
    assert.deepEqual(
      readFileAtOID(fixture.repo, assembled.candidate, 'src/consumer.txt'),
      Buffer.from('retained consumer delta\n'),
    );
    assert.deepEqual(
      readFileAtOID(fixture.repo, assembled.candidate, 'src/serial.txt'),
      Buffer.from('second attempt\n'),
    );
    const retry = engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'Compose ordered tracks from their exact product authorities.',
    });
    assert.equal(retry.changed, false);
    assert.equal(retry.candidate, assembled.candidate);
    const replayed = readBatonState(fixture.repo, 'actions-v2', {
    });
    const replayedEvidence = unsafeProductBaseEvidence(replayed);
    assert.equal(replayedEvidence.track('T1'), foundation.candidate);
    assert.notEqual(replayedEvidence.track('T1'), finalSerialCandidate);
    assert.equal(replayed.assembly.candidate.receipt.candidate, assembled.candidate);
    assert.equal(replayed.assembly.current_receipt.oid, assembled.receipt_commit);
  } finally {
    fixture.cleanup();
  }
});

test('changed contract invalidates only its consumer, and equal product restores its PASS', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const dependentPlan = metadata(1, null, {
      tracks: [
        metadata().tracks[0],
        {
          id: 'T2',
          depends_on: ['T1'],
          slices: [{
            id: 'S2',
            outcome: 'Consume the exact S1 product.',
            scope: { include: ['src/consumer.txt'], exclude: [] },
            acceptance: [{ id: 'A2', text: 'The consumer observes S1.' }],
            checks: ['node --test'],
            constraints: [],
            depends_on: ['S1'],
            consumes: ['S1'],
          }],
        },
        {
          id: 'T3',
          depends_on: ['T2'],
          slices: [{
            id: 'S3',
            outcome: 'Consume the exact retained S2 product.',
            scope: { include: ['src/downstream.txt'], exclude: [] },
            acceptance: [{ id: 'A3', text: 'The downstream observes S2.' }],
            checks: ['node --test'],
            constraints: [],
            depends_on: ['S2'],
            consumes: ['S2'],
          }],
        },
      ],
    });
    const approved = engine.recordPlanRevision({
      planBytes: planBytes(dependentPlan),
      summary: 'Dependent plan approved.',
    });
    const first = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'stable product\n',
    });
    const consumer = deliverSlice(engine, fixture.repo, {
      slice: 'S2',
      track: 'T2',
      file: 'src/consumer.txt',
      value: 'consumes stable product\n',
    });

    const revisedTracks = structuredClone(dependentPlan.tracks);
    revisedTracks[0].slices[0].acceptance[0].text = 'The stable product is independently observable.';
    engine.recordPlanRevision({
      planBytes: planBytes(metadata(2, approved.plan, { tracks: revisedTracks })),
      summary: 'S1 contract clarification approved without replacing either slice.',
    });
    const invalidated = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(invalidated.slices[0].pass, null);
    assert.equal(invalidated.slices[0].next_role, 'implementer');
    assert.equal(invalidated.slices[1].pass, null);
    assert.equal(invalidated.slices[1].outcome, 'stale');

    engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'designed',
      summary: 'The clarified contract needs no product change.',
      detail: 'Re-establish evidence over the same product tree.',
    });
    engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'captain',
      result: 'proceed',
      summary: 'The evidence-only design covers the clarified contract.',
    });
    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T1');
    git(fixture.repo, 'commit', '--allow-empty', '-q', '-m', 'test: re-establish S1 candidate');
    const sameProduct = git(fixture.repo, 'rev-parse', 'HEAD');
    const implemented = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'implementer',
      result: 'candidate',
      summary: 'S1 candidate retains the exact product tree.',
      candidate: sameProduct,
      checkResults: 'S1 clarified checks PASS\n',
    });
    assert.equal(implemented.receipt.product_tree, first.implemented.receipt.product_tree);
    engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S1',
      role: 'verifier',
      result: 'pass',
      summary: 'S1 passes the clarified contract.',
      candidate: sameProduct,
      checkResults: 'S1 clarified verifier PASS\n',
    });

    const restored = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.ok(restored.slices[0].pass);
    assert.equal(restored.slices[1].pass.oid, consumer.passed.receipt_commit);
    assert.equal(restored.slices[1].retained, true);
    assert.equal(restored.slices[2].consumed_inputs[0].pass_receipt, consumer.passed.receipt_commit);
    const evidence = unsafeProductBaseEvidence(restored);
    assert.equal(evidence.pass('S2', consumer.passed.receipt_commit), first.candidate);
    assert.notEqual(evidence.pass('S2', consumer.passed.receipt_commit), sameProduct);
    const downstream = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S3',
    });
    assert.equal(
      isDescendant(fixture.repo, consumer.passed.receipt_commit, downstream.base),
      true,
    );
    assert.equal(
      engine.prepareTrackBase({ release: 'actions-v2', slice: 'S3' }).changed,
      false,
    );
  } finally {
    fixture.cleanup();
  }
});

function consumedPlan() {
  return metadata(1, null, {
    tracks: [
      metadata().tracks[0],
      {
        id: 'T2',
        depends_on: [],
        slices: [{
          id: 'S2',
          outcome: 'Consume the exact S1 product.',
          scope: { include: ['src/consumer.txt'], exclude: [] },
          acceptance: [{ id: 'A2', text: 'The consumer observes S1.' }],
          checks: ['node --test'],
          constraints: [],
          depends_on: ['S1'],
          consumes: ['S1'],
        }],
      },
    ],
  });
}

function transitiveReplayPlan() {
  const slice = (id, file, consumes = []) => ({
    id,
    outcome: `Deliver ${id}.`,
    scope: { include: [file], exclude: [] },
    acceptance: [{ id: `${id}-A1`, text: `${id} is observable.` }],
    checks: ['node --test'],
    constraints: [],
    depends_on: [...consumes],
    consumes: [...consumes],
  });
  return metadata(1, null, {
    tracks: [
      { id: 'T1', depends_on: [], slices: [slice('S01', 'src/s01.txt')] },
      { id: 'T2', depends_on: [], slices: [slice('S02', 'src/s02.txt', ['S01'])] },
      {
        id: 'T3',
        depends_on: [],
        slices: [
          slice('S03', 'src/t3.txt', ['S02']),
          slice('S04', 'src/t3.txt', ['S02']),
        ],
      },
      {
        id: 'T4',
        depends_on: [],
        slices: [
          slice('S05', 'src/t4.txt', ['S04']),
          slice('S06', 'src/t4.txt', ['S04']),
        ],
      },
      {
        id: 'T5',
        depends_on: [],
        slices: [slice('S07', 'src/conflict.txt', ['S02', 'S04', 'S06'])],
      },
    ],
  });
}

function transitiveReplayFixture({
  invalidateTransitive = false,
  staleAssemblyAuthority = false,
} = {}) {
  const fixture = temporaryRepository();
  write(fixture.repo, 'src/conflict.txt', 'approved target\n');
  commitAll(fixture.repo, 'base');
  const engine = actions(fixture.repo);
  const initial = transitiveReplayPlan();
  const approved = engine.recordPlanRevision({
    planBytes: planBytes(initial),
    summary: 'Approve a transitive consumed-product topology.',
  });
  const delivered = new Map();
  const deliver = (slice, track, file, value) => {
    const result = deliverSlice(engine, fixture.repo, { slice, track, file, value });
    delivered.set(slice, result);
  };
  deliver('S01', 'T1', 'src/s01.txt', 'S01 product\n');
  deliver('S02', 'T2', 'src/s02.txt', 'S02 product\n');
  deliver('S03', 'T3', 'src/t3.txt', 'S03 foundation\n');
  deliver('S04', 'T3', 'src/t3.txt', 'S03 foundation\nS04 delta\n');
  deliver('S05', 'T4', 'src/t4.txt', 'S05 foundation\n');
  deliver('S06', 'T4', 'src/t4.txt', 'S05 foundation\nS06 delta\n');
  deliver('S07', 'T5', 'src/conflict.txt', 'old S07 product\n');

  if (staleAssemblyAuthority) {
    engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'Record the obsolete assembly product before replanning.',
    });
  }

  git(fixture.repo, 'switch', '-q', 'main');
  write(fixture.repo, 'src/conflict.txt', 'current target product\n');
  const target = commitAll(fixture.repo, 'advance target with conflicting S07 behavior');
  const tracks = structuredClone(initial.tracks);
  tracks[4].slices[0].acceptance[0].text = 'S07 preserves the current target product.';
  if (invalidateTransitive) {
    tracks[2].slices[0].acceptance[0].text = 'S03 requires a fresh product.';
  }
  engine.recordPlanRevision({
    planBytes: planBytes(metadata(2, approved.plan, { tracks })),
    summary: 'Revise S07 against the conflicting current target.',
  });
  return { fixture, engine, delivered, target };
}

test('target replacement replays the deterministic transitive product closure', () => {
  const context = transitiveReplayFixture();
  try {
    const prepared = context.engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S07',
    });
    assert.equal(prepared.changed, true);
    assert.deepEqual(
      prepared.authorities.map(({ slice }) => slice),
      ['S02', 'S04', 'S06'],
    );
    assert.deepEqual(Object.keys(prepared.pins), ['S02', 'S04', 'S06']);
    assert.equal(isDescendant(context.fixture.repo, context.target, prepared.base), true);
    for (const slice of ['S01', 'S02', 'S03', 'S04', 'S05', 'S06']) {
      assert.equal(
        isDescendant(
          context.fixture.repo,
          context.delivered.get(slice).passed.receipt_commit,
          prepared.base,
        ),
        true,
      );
    }
    assert.equal(
      readFileAtOID(context.fixture.repo, prepared.base, 'src/t3.txt').toString(),
      'S03 foundation\nS04 delta\n',
    );
    assert.equal(
      readFileAtOID(context.fixture.repo, prepared.base, 'src/t4.txt').toString(),
      'S05 foundation\nS06 delta\n',
    );
    const retry = context.engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S07',
    });
    assert.equal(retry.changed, false);
    assert.equal(retry.base, prepared.base);
    context.engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S07',
      role: 'implementer',
      result: 'designed',
      summary: 'The replacement design retains the transitive product closure.',
      detail: 'Implement S07 from the exact prepared replacement base.',
    });
    const proceeded = context.engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S07',
      role: 'captain',
      result: 'proceed',
      summary: 'The replacement design binds the declared inputs exactly.',
      detail: 'PROCEED',
    });
    assert.equal(proceeded.changed, true);
  } finally {
    context.fixture.cleanup();
  }
});

test('target replacement refuses a missing transitive current PASS without moving its ref', () => {
  const context = transitiveReplayFixture({ invalidateTransitive: true });
  try {
    const ref = 'refs/heads/track/actions-v2/T5';
    const before = resolveRef(context.fixture.repo, ref);
    assert.throws(
      () => context.engine.prepareTrackBase({ release: 'actions-v2', slice: 'S07' }),
      (error) => (
        error?.code === 'DEPENDENCIES_NOT_READY'
        && error.message.includes('S03')
      ),
    );
    assert.equal(resolveRef(context.fixture.repo, ref), before);
  } finally {
    context.fixture.cleanup();
  }
});

test('assembly reuses one target-based authority that contains every current track product', () => {
  const context = transitiveReplayFixture({ staleAssemblyAuthority: true });
  try {
    const delivered = deliverSlice(context.engine, context.fixture.repo, {
      slice: 'S07',
      track: 'T5',
      file: 'src/conflict.txt',
      value: 'current target product\nnew S07 product\n',
    });
    const assembled = context.engine.prepareAssembly({
      release: 'actions-v2',
      summary: 'Assemble the revised target-based transitive product.',
    });
    assert.equal(assembled.changed, true);
    assert.equal(isDescendant(context.fixture.repo, context.target, assembled.candidate), true);
    assert.equal(
      isDescendant(
        context.fixture.repo,
        delivered.passed.receipt_commit,
        assembled.candidate,
      ),
      true,
    );
    assert.equal(
      readFileAtOID(context.fixture.repo, assembled.candidate, 'src/conflict.txt').toString(),
      'current target product\nnew S07 product\n',
    );
    assert.equal(
      readFileAtOID(context.fixture.repo, assembled.candidate, 'src/t3.txt').toString(),
      'S03 foundation\nS04 delta\n',
    );
    assert.equal(
      readFileAtOID(context.fixture.repo, assembled.candidate, 'src/t4.txt').toString(),
      'S05 foundation\nS06 delta\n',
    );
    assert.equal(
      readBatonState(context.fixture.repo, 'actions-v2').assembly.candidate.receipt.candidate,
      assembled.candidate,
    );
  } finally {
    context.fixture.cleanup();
  }
});

test('consumed-track preparation replays a retained PASS from its whole-slice product base', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/shared.txt', 'obsolete history\n');
    commitAll(fixture.repo, 'obsolete target history');
    const engine = actions(fixture.repo);
    const slice = (id, file, consumes = []) => ({
      id,
      outcome: `Deliver ${id}.`,
      scope: { include: [file], exclude: [] },
      acceptance: [{ id: `${id}-A1`, text: `${id} is observable.` }],
      checks: ['node --test'],
      constraints: [],
      depends_on: [...consumes],
      consumes: [...consumes],
    });
    const legacyPlan = metadata(1, null, {
      tracks: [
        { id: 'T1', depends_on: [], slices: [slice('S1', 'src/shared.txt')] },
        { id: 'T2', depends_on: [], slices: [slice('S2', 'src/producer.txt', ['S1'])] },
        {
          id: 'T3',
          depends_on: [],
          slices: [
            slice('S3', 'src/consumer.txt'),
            slice('S4', 'src/result.txt', ['S2']),
          ],
        },
      ],
    });
    const approved = engine.recordPlanRevision({
      planBytes: planBytes(legacyPlan),
      summary: 'Approve a retained false-history topology.',
    });
    const foundation = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/shared.txt',
      value: 'reviewed foundation\n',
    });

    const parsed = parsePlanBytes(planBytes(legacyPlan));
    const appendMetadata = (expectedHead, subject, receipt) => appendMetadataReceipt(
      fixture.repo,
      expectedHead,
      subject,
      receipt,
    );
    const common = {
      version: 1,
      release: 'actions-v2',
      slice: 'S2',
      plan: approved.plan,
      contract: parsed.metadata.contracts.S2,
      attempt: 1,
    };
    const design = appendMetadata(
      approved.receipt_commit,
      'legacy consuming design',
      {
        ...common,
        role: 'implementer',
        result: 'designed',
        binds: approved.receipt_commit,
        summary: 'Legacy design predates explicit prepared-base evidence.',
      },
    );
    const captain = appendMetadata(design, 'legacy Captain PROCEED', {
      ...common,
      role: 'captain',
      result: 'proceed',
      binds: design,
      summary: 'The retained legacy design may proceed.',
    });
    git(fixture.repo, 'switch', '-q', '--detach', captain);
    write(fixture.repo, 'src/shared.txt', 'reviewed foundation\n');
    write(fixture.repo, 'src/producer.txt', 'exact retained producer delta\n');
    const candidate = commitAll(fixture.repo, 'legacy producer candidate');
    const product = productTreeIdentity(
      fixture.repo,
      candidate
    );
    const pins = { S1: foundation.passed.receipt.product_tree };
    const candidateReceipt = appendMetadata(candidate, 'legacy producer candidate receipt', {
      ...common,
      role: 'implementer',
      result: 'candidate',
      binds: captain,
      candidate,
      product_tree: product.productTree,
      inputs: pins,
      checks: digestBytes(Buffer.from('legacy candidate checks PASS\n')),
      summary: 'Legacy producer candidate passed its checks.',
    });
    const pass = appendMetadata(candidateReceipt, 'legacy producer PASS', {
      ...common,
      role: 'verifier',
      result: 'pass',
      binds: candidateReceipt,
      candidate,
      product_tree: product.productTree,
      inputs: pins,
      checks: digestBytes(Buffer.from('legacy verifier checks PASS\n')),
      summary: 'Legacy producer passed fresh verification.',
    });
    unsafeAtomicUpdateRefs(fixture.repo, [{
      kind: 'create',
      ref: referenceNames.trackRef('actions-v2', 'T2'),
      newHead: pass,
    }]);

    const consumer = deliverSlice(engine, fixture.repo, {
      slice: 'S3',
      track: 'T3',
      file: 'src/shared.txt',
      value: 'current consumer foundation\n',
      extraWrites: { 'src/consumer.txt': 'current consumer authority\n' },
    });
    assert.throws(
      () => git(
        fixture.repo,
        'merge-tree',
        '--write-tree',
        '--no-messages',
        consumer.passed.receipt_commit,
        pass,
      ),
    );

    const prepared = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S4',
    });
    assert.deepEqual(
      git(fixture.repo, 'rev-list', '--parents', '-n', '1', prepared.base).split(' '),
      [prepared.base, consumer.passed.receipt_commit, pass],
    );
    assert.equal(
      readFileAtOID(fixture.repo, prepared.base, 'src/shared.txt').toString(),
      'current consumer foundation\n',
    );
    assert.equal(
      readFileAtOID(fixture.repo, prepared.base, 'src/producer.txt').toString(),
      'exact retained producer delta\n',
    );
    const designed = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S4',
      role: 'implementer',
      result: 'designed',
      summary: 'Replay derives the same retained product base.',
    });
    assert.equal(git(fixture.repo, 'rev-parse', `${designed.receipt_commit}^`), prepared.base);
    assert.throws(
      () => engine.prepareTrackBase({
        release: 'actions-v2',
        slice: 'S4',
        productBase: foundation.candidate,
      }),
      (error) => error?.code === 'INVALID_ACTION_INPUT',
    );
  } finally {
    fixture.cleanup();
  }
});

test('retained legacy composition stops when multiple PASS authorities share one product', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'stable target\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const plannedSlice = (id, file, consumes = []) => ({
      id,
      outcome: `Deliver ${id}.`,
      scope: { include: [file], exclude: [] },
      acceptance: [{ id: `${id}-A1`, text: `${id} is observable.` }],
      checks: ['node --test'],
      constraints: [],
      depends_on: [...consumes],
      consumes: [...consumes],
    });
    const initial = metadata(1, null, {
      tracks: [
        { id: 'T1', depends_on: [], slices: [plannedSlice('S1', 'src/stable.txt')] },
        { id: 'T2', depends_on: [], slices: [plannedSlice('S2', 'src/consumer.txt', ['S1'])] },
        {
          id: 'T3',
          depends_on: [],
          slices: [
            plannedSlice('S3', 'src/t3.txt'),
            plannedSlice('S4', 'src/downstream.txt', ['S2']),
          ],
        },
      ],
    });
    const approved = engine.recordPlanRevision({
      planBytes: planBytes(initial),
      summary: 'Approve legacy ambiguity proof.',
    });
    const firstProducer = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/stable.txt',
      value: 'stable producer output\n',
    });

    const parsed = parsePlanBytes(planBytes(initial));
    const producerCommon = {
      version: 1,
      release: 'actions-v2',
      slice: 'S1',
      plan: approved.plan,
      contract: parsed.metadata.contracts.S1,
      attempt: 2,
    };
    const repeatedDesign = appendMetadataReceipt(
      fixture.repo,
      firstProducer.passed.receipt_commit,
      'same-baseline repeated design',
      {
        ...producerCommon,
        role: 'implementer',
        result: 'designed',
        binds: firstProducer.passed.receipt_commit,
        summary: 'Historical retry over the same exact baseline.',
      },
    );
    const repeatedCaptain = appendMetadataReceipt(
      fixture.repo,
      repeatedDesign,
      'same-baseline repeated PROCEED',
      {
        ...producerCommon,
        role: 'captain',
        result: 'proceed',
        binds: repeatedDesign,
        summary: 'Proceed with the historical same-baseline retry.',
      },
    );
    git(fixture.repo, 'switch', '-q', '--detach', repeatedCaptain);
    git(fixture.repo, 'commit', '--allow-empty', '-q', '-m', 'same product candidate');
    const repeatedCandidate = resolveRef(fixture.repo, 'HEAD');
    const repeatedIdentity = productTreeIdentity(
      fixture.repo,
      repeatedCandidate
    );
    const repeatedCandidateReceipt = appendMetadataReceipt(
      fixture.repo,
      repeatedCandidate,
      'same-baseline repeated candidate',
      {
        ...producerCommon,
        role: 'implementer',
        result: 'candidate',
        binds: repeatedCaptain,
        candidate: repeatedCandidate,
        product_tree: repeatedIdentity.productTree,
        inputs: {},
        checks: digestBytes(Buffer.from('repeated candidate checks PASS\n')),
        summary: 'Historical retry retained the exact producer product.',
      },
    );
    const repeatedPass = appendMetadataReceipt(
      fixture.repo,
      repeatedCandidateReceipt,
      'same-baseline repeated PASS',
      {
        ...producerCommon,
        role: 'verifier',
        result: 'pass',
        binds: repeatedCandidateReceipt,
        candidate: repeatedCandidate,
        product_tree: repeatedIdentity.productTree,
        inputs: {},
        checks: digestBytes(Buffer.from('repeated verifier checks PASS\n')),
        summary: 'Historical retry passed over the same product and baseline.',
      },
    );
    unsafeAtomicUpdateRefs(fixture.repo, [{
      kind: 'update',
      ref: referenceNames.trackRef('actions-v2', 'T1'),
      expectedHead: firstProducer.passed.receipt_commit,
      newHead: repeatedPass,
    }]);
    assert.equal(
      repeatedIdentity.productTree,
      firstProducer.passed.receipt.product_tree,
    );
    const repeatedState = readBatonState(fixture.repo, 'actions-v2', {
    });
    const repeatedEvidence = unsafeProductBaseEvidence(repeatedState);
    assert.equal(
      repeatedEvidence.pass('S1', firstProducer.passed.receipt_commit),
      repeatedEvidence.pass('S1', repeatedPass),
    );

    const common = {
      version: 1,
      release: 'actions-v2',
      slice: 'S2',
      plan: approved.plan,
      contract: parsed.metadata.contracts.S2,
      attempt: 1,
    };
    const design = appendMetadataReceipt(
      fixture.repo,
      approved.receipt_commit,
      'ambiguous legacy design',
      {
        ...common,
        role: 'implementer',
        result: 'designed',
        binds: approved.receipt_commit,
        summary: 'Legacy design records no prepared authority.',
      },
    );
    const captain = appendMetadataReceipt(fixture.repo, design, 'ambiguous legacy PROCEED', {
      ...common,
      role: 'captain',
      result: 'proceed',
      binds: design,
      summary: 'Proceed with the legacy fixture.',
    });
    git(fixture.repo, 'switch', '-q', '--detach', captain);
    write(fixture.repo, 'src/stable.txt', 'stable producer output\n');
    write(fixture.repo, 'src/consumer.txt', 'legacy consumer\n');
    const candidate = commitAll(fixture.repo, 'ambiguous legacy candidate');
    const identity = productTreeIdentity(
      fixture.repo,
      candidate
    );
    const pins = { S1: firstProducer.passed.receipt.product_tree };
    const candidateReceipt = appendMetadataReceipt(
      fixture.repo,
      candidate,
      'ambiguous legacy candidate receipt',
      {
        ...common,
        role: 'implementer',
        result: 'candidate',
        binds: captain,
        candidate,
        product_tree: identity.productTree,
        inputs: pins,
        checks: digestBytes(Buffer.from('legacy candidate checks PASS\n')),
        summary: 'Legacy candidate binds only the shared product digest.',
      },
    );
    const pass = appendMetadataReceipt(fixture.repo, candidateReceipt, 'ambiguous legacy PASS', {
      ...common,
      role: 'verifier',
      result: 'pass',
      binds: candidateReceipt,
      candidate,
      product_tree: identity.productTree,
      inputs: pins,
      checks: digestBytes(Buffer.from('legacy verifier checks PASS\n')),
      summary: 'Legacy candidate passed verification.',
    });
    const ref = referenceNames.trackRef('actions-v2', 'T2');
    unsafeAtomicUpdateRefs(fixture.repo, [{ kind: 'create', ref, newHead: pass }]);

    deliverSlice(engine, fixture.repo, {
      slice: 'S3',
      track: 'T3',
      file: 'src/t3.txt',
      value: 'current downstream authority\n',
      extraWrites: { 'src/stable.txt': 'current downstream foundation\n' },
    });
    const downstreamRef = referenceNames.trackRef('actions-v2', 'T3');
    const downstreamHead = resolveRef(fixture.repo, downstreamRef);
    assert.throws(
      () => engine.prepareTrackBase({
        release: 'actions-v2',
        slice: 'S4',
      }),
      (error) => (
        error?.code === 'AMBIGUOUS_AUTHORITY'
        && /ambiguous S1 PASS authorities/.test(error.message)
      ),
    );
    assert.equal(resolveRef(fixture.repo, ref), pass);
    assert.equal(resolveRef(fixture.repo, downstreamRef), downstreamHead);
  } finally {
    fixture.cleanup();
  }
});

function designConsumer(engine, decision = null) {
  const prepared = engine.prepareTrackBase({
    release: 'actions-v2',
    slice: 'S2',
  });
  const designInput = {
    release: 'actions-v2',
    slice: 'S2',
    role: 'implementer',
    result: 'designed',
    summary: 'Design S2 against its exact consumed product.',
  };
  const designed = engine.appendReceipt(designInput);
  assert.deepEqual(designed.receipt.inputs, prepared.pins);
  assert.match(designed.receipt.base, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
  const retried = engine.appendReceipt(designInput);
  assert.equal(retried.changed, false);
  assert.equal(retried.receipt_commit, designed.receipt_commit);
  const captain = decision === null ? null : engine.appendReceipt({
    release: 'actions-v2',
    slice: 'S2',
    role: 'captain',
    result: decision,
    summary: `Captain ${decision} for S2.`,
  });
  return { prepared, designed, captain };
}

function reviseProducer(engine, plan, tracks, summary) {
  const revised = structuredClone(tracks);
  revised[0].slices[0].acceptance[0].text = summary;
  return {
    tracks: revised,
    result: engine.recordPlanRevision({
      planBytes: planBytes(metadata(2, plan, { tracks: revised })),
      summary,
    }),
  };
}

for (const stage of ['before design', 'after design', 'after PROCEED']) {
  test(`changed producer ${stage} requires a freshly prepared design`, () => {
    const fixture = temporaryRepository();
    try {
      write(fixture.repo, 'README.md', 'product\n');
      commitAll(fixture.repo, 'base');
      const engine = actions(fixture.repo);
      const initial = consumedPlan();
      const approved = engine.recordPlanRevision({
        planBytes: planBytes(initial),
        summary: 'Approve one producer and consumer.',
      });
      deliverSlice(engine, fixture.repo, {
        slice: 'S1',
        track: 'T1',
        file: 'src/product.txt',
        value: 'producer v1\n',
      });
      let prior = null;
      if (stage === 'after design') prior = designConsumer(engine);
      if (stage === 'after PROCEED') prior = designConsumer(engine, 'proceed');
      const revised = reviseProducer(
        engine,
        approved.plan,
        initial.tracks,
        `Producer contract changed ${stage}.`,
      );
      let waiting = readBatonState(fixture.repo, 'actions-v2', {
      });
      const consumer = waiting.slices.find(({ location }) => location.slice.id === 'S2');
      assert.equal(consumer.status, 'waiting');
      if (prior) assert.equal(consumer.outcome, 'stale');

      const producer = deliverSlice(engine, fixture.repo, {
        slice: 'S1',
        track: 'T1',
        file: 'src/product.txt',
        value: 'producer v2\n',
      });
      waiting = readBatonState(fixture.repo, 'actions-v2', {
      });
      const ready = waiting.slices.find(({ location }) => location.slice.id === 'S2');
      assert.equal(ready.next_role, 'implementer');
      assert.equal(ready.stage, 'design');
      const prepared = engine.prepareTrackBase({
        release: 'actions-v2',
        slice: 'S2',
      });
      assert.equal(prepared.pins.S1, producer.passed.receipt.product_tree);
      assert.equal(prepared.authorities[0].pass_receipt, producer.passed.receipt_commit);
      const fresh = engine.appendReceipt({
        release: 'actions-v2',
        slice: 'S2',
        role: 'implementer',
        result: 'designed',
        summary: `Fresh S2 design ${stage}.`,
      });
      assert.equal(fresh.receipt.plan, revised.result.plan);
      if (prior) {
        assert.equal(fresh.receipt.attempt, prior.designed.receipt.attempt + 1);
        assert.equal(
          fresh.receipt.binds,
          stage === 'after design'
            ? prior.designed.receipt_commit
            : prior.captain.receipt_commit,
        );
      }
    } finally {
      fixture.cleanup();
    }
  });
}

test('same-product producer PASS retains review and exact retries require candidate and base', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const initial = consumedPlan();
    const approved = engine.recordPlanRevision({
      planBytes: planBytes(initial),
      summary: 'Approve same-product continuity.',
    });
    const first = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'stable producer\n',
    });
    const review = designConsumer(engine, 'proceed');
    reviseProducer(
      engine,
      approved.plan,
      initial.tracks,
      'Clarify producer acceptance without changing product.',
    );
    const second = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'stable producer\n',
      allowEmpty: true,
    });
    assert.equal(
      second.implemented.receipt.product_tree,
      first.implemented.receipt.product_tree,
    );
    let state = readBatonState(fixture.repo, 'actions-v2', {
    });
    const retained = state.slices.find(({ location }) => location.slice.id === 'S2');
    assert.equal(retained.current_receipt.oid, review.captain.receipt_commit);
    assert.equal(retained.stage, 'implement');
    assert.deepEqual(retained.reviewed_pins, retained.input_pins);

    const prepared = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S2',
    });
    assert.equal(prepared.changed, true);
    assert.equal(
      engine.prepareTrackBase({
        release: 'actions-v2',
        slice: 'S2',
      }).changed,
      false,
    );
    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T2');
    write(fixture.repo, 'src/consumer.txt', 'consumer candidate\n');
    const candidate = commitAll(fixture.repo, 'feat: consume stable producer');
    const candidateInput = {
      release: 'actions-v2',
      slice: 'S2',
      role: 'implementer',
      result: 'candidate',
      summary: 'S2 exact candidate.',
      base: prepared.base,
      candidate,
      checkResults: 'S2 checks PASS\n',
    };
    const implemented = engine.appendReceipt(candidateInput);
    const retry = engine.appendReceipt(candidateInput);
    assert.equal(retry.changed, false);
    assert.equal(retry.receipt_commit, implemented.receipt_commit);
    const head = resolveRef(fixture.repo, referenceNames.trackRef('actions-v2', 'T2'));
    assert.throws(
      () => engine.appendReceipt({
        ...candidateInput,
        base: undefined,
      }),
      (error) => error?.code === 'INVALID_ACTION_INPUT',
    );
    assert.throws(
      () => engine.appendReceipt({
        ...candidateInput,
        base: review.captain.receipt_commit,
      }),
      (error) => error?.code === 'ROLE_NOT_ELIGIBLE',
    );
    assert.equal(resolveRef(fixture.repo, referenceNames.trackRef('actions-v2', 'T2')), head);

    const verifierInput = {
      release: 'actions-v2',
      slice: 'S2',
      role: 'verifier',
      result: 'pass',
      summary: 'S2 exact PASS.',
      candidate,
      checkResults: 'fresh S2 PASS\n',
    };
    const passed = engine.appendReceipt(verifierInput);
    assert.equal(engine.appendReceipt(verifierInput).changed, false);
    assert.throws(
      () => engine.appendReceipt({
        ...verifierInput,
        candidate: undefined,
      }),
      (error) => error?.code === 'INVALID_ACTION_INPUT',
    );
    assert.equal(passed.receipt.inputs.S1, second.passed.receipt.product_tree);
    state = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(
      state.slices.find(({ location }) => location.slice.id === 'S2').pass.oid,
      passed.receipt_commit,
    );
  } finally {
    fixture.cleanup();
  }
});

test('changed candidate pins require a fresh reviewed design and exact prepared candidate', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const initial = consumedPlan();
    const approved = engine.recordPlanRevision({
      planBytes: planBytes(initial),
      summary: 'Approve candidate pin retry.',
    });
    deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'producer v1\n',
    });
    const firstConsumer = deliverSlice(engine, fixture.repo, {
      slice: 'S2',
      track: 'T2',
      file: 'src/consumer.txt',
      value: 'consumer v1\n',
    });
    reviseProducer(
      engine,
      approved.plan,
      initial.tracks,
      'Producer changes after consumer PASS.',
    );
    const producer = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'producer v2\n',
    });
    let state = readBatonState(fixture.repo, 'actions-v2', {
    });
    const stale = state.slices.find(({ location }) => location.slice.id === 'S2');
    assert.equal(stale.stage, 'design');
    assert.equal(stale.outcome, 'stale');
    assert.equal(stale.current_receipt.oid, firstConsumer.passed.receipt_commit);

    const review = designConsumer(engine, 'proceed');
    const prepared = engine.prepareTrackBase({ release: 'actions-v2', slice: 'S2' });
    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T2');
    write(fixture.repo, 'src/consumer.txt', 'consumer v2\n');
    const candidate = commitAll(fixture.repo, 'fix: consume producer v2');
    const repaired = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S2',
      role: 'implementer',
      result: 'candidate',
      summary: 'Exact candidate-pin stale retry.',
      base: prepared.base,
      candidate,
      checkResults: 'S2 retry checks PASS\n',
    });
    assert.equal(repaired.receipt.binds, review.captain.receipt_commit);
    assert.equal(repaired.receipt.attempt, firstConsumer.passed.receipt.attempt + 1);
    assert.equal(repaired.receipt.inputs.S1, producer.passed.receipt.product_tree);
    assert.notEqual(
      repaired.receipt.inputs.S1,
      firstConsumer.passed.receipt.inputs.S1,
    );
    state = readBatonState(fixture.repo, 'actions-v2', {
    });
    assert.equal(
      state.slices.find(({ location }) => location.slice.id === 'S2').current_receipt.oid,
      repaired.receipt_commit,
    );
  } finally {
    fixture.cleanup();
  }
});

test('track-base preparation is zero-input inert and serial same-ref ancestral', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const serial = metadata(1, null, {
      tracks: [{
        id: 'T1',
        depends_on: [],
        slices: [
          metadata().tracks[0].slices[0],
          {
            id: 'S2',
            outcome: 'Consume S1 serially.',
            scope: { include: ['src/serial.txt'], exclude: [] },
            acceptance: [{ id: 'A2', text: 'Serial input is observed.' }],
            checks: ['node --test'],
            constraints: [],
            depends_on: ['S1'],
            consumes: ['S1'],
          },
        ],
      }],
    });
    engine.recordPlanRevision({
      planBytes: planBytes(serial),
      summary: 'Approve serial consumed input.',
    });
    const zero = engine.prepareTrackBase({ release: 'actions-v2', slice: 'S1' });
    assert.equal(zero.changed, false);
    assert.deepEqual(zero.pins, {});
    assert.throws(
      () => resolveRef(fixture.repo, referenceNames.trackRef('actions-v2', 'T1')),
      /resolve refs\/heads\/track\/actions-v2\/T1 failed/,
    );
    const producer = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'serial producer\n',
    });
    const serialBase = engine.prepareTrackBase({ release: 'actions-v2', slice: 'S2' });
    assert.equal(serialBase.changed, false);
    assert.equal(serialBase.base, producer.passed.receipt_commit);
    assert.equal(serialBase.authorities[0].pass_receipt, producer.passed.receipt_commit);
  } finally {
    fixture.cleanup();
  }
});

function multipleConsumedPlan() {
  const producer = (id, file) => ({
    id,
    outcome: `Deliver ${id}.`,
    scope: { include: [file], exclude: [] },
    acceptance: [{ id: `${id}-A1`, text: `${id} is observable.` }],
    checks: ['node --test'],
    constraints: [],
    depends_on: [],
    consumes: [],
  });
  return metadata(1, null, {
    tracks: [
      { id: 'T1', depends_on: [], slices: [producer('S1', 'src/one.txt')] },
      { id: 'T2', depends_on: [], slices: [producer('S2', 'src/two.txt')] },
      {
        id: 'T3',
        depends_on: [],
        slices: [{
          ...producer('S3', 'src/consumer.txt'),
          depends_on: ['S1', 'S2'],
          consumes: ['S2', 'S1'],
        }],
      },
    ],
  });
}

test('multiple consumed authorities compose in plan order and refuse owner drift', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    engine.recordPlanRevision({
      planBytes: planBytes(multipleConsumedPlan()),
      summary: 'Approve two producers and one consumer.',
    });
    const first = deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/one.txt',
      value: 'one\n',
    });
    const second = deliverSlice(engine, fixture.repo, {
      slice: 'S2',
      track: 'T2',
      file: 'src/two.txt',
      value: 'two\n',
    });
    assert.throws(
      () => engine.appendReceipt({
        release: 'actions-v2',
        slice: 'S3',
        role: 'implementer',
        result: 'designed',
        summary: 'Unsafe unprepared design.',
      }),
      (error) => error?.code === 'TRACK_BASE_NOT_PREPARED',
    );
    const prepared = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S3',
    });
    assert.equal(prepared.changed, true);
    assert.deepEqual(
      prepared.authorities.map(({ slice }) => slice),
      ['S2', 'S1'],
    );
    assert.deepEqual(prepared.pins, {
      S2: second.passed.receipt.product_tree,
      S1: first.passed.receipt.product_tree,
    });
    assert.equal(
      engine.prepareTrackBase({ release: 'actions-v2', slice: 'S3' }).base,
      prepared.base,
    );

    git(fixture.repo, 'switch', '-q', 'track/actions-v2/T3');
    write(fixture.repo, 'src/smuggled.txt', 'not an authoritative base\n');
    const drifted = commitAll(fixture.repo, 'test: drift consumer owner');
    assert.throws(
      () => engine.prepareTrackBase({ release: 'actions-v2', slice: 'S3' }),
      (error) => error?.code === 'CHANGED_OWNER_HEAD',
    );
    assert.equal(
      resolveRef(fixture.repo, referenceNames.trackRef('actions-v2', 'T3')),
      drifted,
    );
  } finally {
    fixture.cleanup();
  }
});

test('conflicting consumed authorities leave the consumer ref unmoved', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    engine.recordPlanRevision({
      planBytes: planBytes(multipleConsumedPlan()),
      summary: 'Approve adversarial undeclared producer overlap.',
    });
    deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/one.txt',
      value: 'one\n',
      extraWrites: { 'src/shared.txt': 'from one\n' },
    });
    deliverSlice(engine, fixture.repo, {
      slice: 'S2',
      track: 'T2',
      file: 'src/two.txt',
      value: 'two\n',
      extraWrites: { 'src/shared.txt': 'from two\n' },
    });
    assert.throws(
      () => engine.prepareTrackBase({ release: 'actions-v2', slice: 'S3' }),
      (error) => error?.code === 'COMPOSITION_CONFLICT',
    );
    assert.throws(
      () => resolveRef(fixture.repo, referenceNames.trackRef('actions-v2', 'T3')),
      /resolve refs\/heads\/track\/actions-v2\/T3 failed/,
    );
  } finally {
    fixture.cleanup();
  }
});

test('planner design preparation seeds after the active plan retirement chain', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'product\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);
    const initial = consumedPlan();
    initial.tracks.push({
      ...unrelatedTrack(),
      id: 'T3',
      slices: [{
        ...unrelatedTrack().slices[0],
        id: 'S3',
        scope: { include: ['src/unrelated.txt'], exclude: [] },
      }],
    });
    const firstPlan = engine.recordPlanRevision({
      planBytes: planBytes(initial),
      summary: 'Approve producer, consumer, and removable slice.',
    });
    deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'producer\n',
    });
    const retained = structuredClone(initial.tracks.slice(0, 2));
    const revised = engine.recordPlanRevision({
      planBytes: planBytes(metadata(2, firstPlan.plan, { tracks: retained })),
      summary: 'Retire only the unrelated slice.',
    });
    assert.equal(revised.retirements.length, 1);
    const prepared = engine.prepareTrackBase({
      release: 'actions-v2',
      slice: 'S2',
    });
    assert.equal(
      isDescendant(fixture.repo, revised.head, prepared.base),
      true,
    );
    const design = engine.appendReceipt({
      release: 'actions-v2',
      slice: 'S2',
      role: 'implementer',
      result: 'designed',
      summary: 'Design from the retirement-complete plan install.',
    });
    assert.equal(design.receipt.binds, revised.receipt_commit);
    assert.equal(design.receipt.plan, revised.plan);
    assert.equal(design.receipt.base, revised.head);
    assert.deepEqual(design.receipt.inputs, prepared.pins);
  } finally {
    fixture.cleanup();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBatonActions,
  referenceNames,
} from '../../reference/records/actions.mjs';
import {
  readFileAtOID,
  resolveRef,
} from '../../reference/records/git.mjs';
import {
  parsePlanBytes,
  parseReceiptCommitMessage,
} from '../../reference/records/receipts.mjs';
import { readBatonState } from '../../reference/records/state.mjs';
import {
  commitAll,
  git,
  temporaryRepository,
  testProductExclusionAdmission,
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
  return createBatonActions({
    repo,
    resolveBehavioralInertness: (request) => ({
      ...request,
      decision: 'inert',
    }),
  });
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

function deliverSlice(engine, repo, {
  slice,
  track,
  file,
  value,
  allowEmpty = false,
  extraWrites = {},
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

test('plan revisions keep release identity, bind the prior blob, and may repin moved target', () => {
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
    assert.throws(
      () => engine.recordPlanRevision({
        planBytes: planBytes(),
        summary: 'Initial plan approved.',
      }),
      (error) => error?.code === 'TARGET_MOVED',
    );

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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
    });
    assert.equal(afterMerge.assembly.outcome, 'merged');
    assert.equal(afterMerge.plan.target_stale, false);
    assert.equal(
      afterMerge.diagnostics.some(({ code }) => code === 'TARGET_MOVED'),
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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
    deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'first\n',
    });
    deliverSlice(engine, fixture.repo, {
      slice: 'S2',
      track: 'T1',
      file: 'src/second.txt',
      value: 'second\n',
    });

    let state = readBatonState(fixture.repo, 'actions-v2', {
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
    deliverSlice(engine, fixture.repo, {
      slice: 'S1',
      track: 'T1',
      file: 'src/product.txt',
      value: 'first\n',
    });
    deliverSlice(engine, fixture.repo, {
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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
    });
    assert.equal(afterMerge.plan.target_stale, false);
    assert.equal(
      afterMerge.diagnostics.some(({ code }) => code === 'TARGET_MOVED'),
      false,
    );
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
    const admission = testProductExclusionAdmission(fixture.repo);
    const invalidated = readBatonState(fixture.repo, 'actions-v2', {
      productExclusionAdmission: admission,
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
      productExclusionAdmission: admission,
    });
    assert.ok(restored.slices[0].pass);
    assert.equal(restored.slices[1].pass.oid, consumer.passed.receipt_commit);
    assert.equal(restored.slices[1].retained, true);
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
        productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
        productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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
      productExclusionAdmission: testProductExclusionAdmission(fixture.repo),
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

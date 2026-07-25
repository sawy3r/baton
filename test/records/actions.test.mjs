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
}) {
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
  git(repo, 'switch', '-q', `track/actions-v2/${track}`);
  write(repo, file, value);
  const candidate = commitAll(repo, `feat: deliver ${slice}`);
  const implemented = engine.appendReceipt({
    release: 'actions-v2',
    slice,
    role: 'implementer',
    result: 'candidate',
    summary: `${slice} candidate passed focused checks.`,
    candidate,
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

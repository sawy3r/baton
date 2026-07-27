import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBatonActions,
  referenceNames,
} from '../../reference/records/actions.mjs';
import {
  resolveRef,
  unsafePrepareMetadataCommit,
} from '../../reference/records/git.mjs';
import {
  digestBytes,
  renderReceiptCommit,
} from '../../reference/records/receipts.mjs';
import {
  readBatonState,
  readReleaseReceiptHistory,
} from '../../reference/records/state.mjs';
import {
  commitAll,
  git,
  temporaryRepository,
  testProductExclusionAdmission,
  write,
} from './helpers.mjs';

const CONTRACT = `sha256:${'1'.repeat(64)}`;

function metadata(release, revision = 1, previousPlan = null, sliceIDs = ['S1']) {
  return {
    schema_version: 'baton.plan/v2',
    release,
    revision,
    previous_plan: previousPlan,
    repository: 'example/release-epoch',
    target_ref: 'refs/heads/main',
    approval_ref: `approval://${release}/${revision}`,
    tracks: [{
      id: 'T1',
      depends_on: [],
      slices: sliceIDs.map((id) => ({
        id,
        outcome: `Deliver ${id}.`,
        scope: { include: [`src/${id}.txt`], exclude: [] },
        acceptance: [{ id: `${id}-A1`, text: `${id} is observable.` }],
        checks: ['node --test'],
        constraints: [],
        depends_on: [],
        consumes: [],
      })),
    }],
  };
}

function planBytes(value) {
  return Buffer.from(
    `\`\`\`baton-plan-v2\n${JSON.stringify(value, null, 2)}\n\`\`\`\n\n# ${value.release}\n`,
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

function approve(engine, release, revision = 1, previousPlan = null, sliceIDs = ['S1']) {
  return engine.recordPlanRevision({
    planBytes: planBytes(metadata(release, revision, previousPlan, sliceIDs)),
    summary: `Approve ${release} revision ${revision}.`,
  });
}

function deliver(engine, repo, release, slice = 'S1') {
  engine.prepareTrackBase({ release, slice });
  engine.appendReceipt({
    release,
    slice,
    role: 'implementer',
    result: 'designed',
    summary: `${slice} has a bounded design.`,
    detail: `Change only src/${slice}.txt.`,
  });
  engine.appendReceipt({
    release,
    slice,
    role: 'captain',
    result: 'proceed',
    summary: `${slice} design covers the contract.`,
    detail: 'PROCEED',
  });
  engine.prepareTrackBase({ release, slice });
  git(repo, 'switch', '-q', `track/${release}/T1`);
  write(repo, `src/${slice}.txt`, `${release}:${slice}\n`);
  const candidate = commitAll(repo, `feat: deliver ${release} ${slice}`);
  engine.appendReceipt({
    release,
    slice,
    role: 'implementer',
    result: 'candidate',
    summary: `${slice} candidate passed focused checks.`,
    candidate,
    checkResults: 'implementer PASS\n',
  });
  engine.appendReceipt({
    release,
    slice,
    role: 'verifier',
    result: 'pass',
    summary: `${slice} passed fresh verification.`,
    candidate,
    checkResults: 'verifier PASS\n',
  });
  return candidate;
}

function state(repo, release) {
  return readBatonState(repo, release, {
    productExclusionAdmission: testProductExclusionAdmission(repo),
  });
}

test('a later release ignores prior receipts while reusing track and slice identities', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'base\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);

    approve(engine, 'epoch-a');
    const candidateA = deliver(engine, fixture.repo, 'epoch-a');
    const mergedA = engine.mergePassedCandidate({
      release: 'epoch-a',
      summary: 'Merge the exact epoch-a PASS.',
    });
    assert.equal(mergedA.result_commit, candidateA);
    assert.equal(resolveRef(fixture.repo, 'refs/heads/main'), candidateA);

    const firstB = approve(engine, 'epoch-b');
    assert.equal(firstB.target, candidateA);
    assert.equal(state(fixture.repo, 'epoch-b').slices[0].location.slice.id, 'S1');

    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'target.txt', 'moved for revision 2\n');
    const movedTarget = commitAll(fixture.repo, 'test: move target for epoch-b revision');
    const secondB = approve(engine, 'epoch-b', 2, firstB.plan);
    assert.equal(secondB.target, movedTarget);
    assert.equal(
      readReleaseReceiptHistory(
        fixture.repo,
        'epoch-b',
        resolveRef(fixture.repo, referenceNames.releaseRef('epoch-b')),
      ).boundary,
      firstB.target,
    );
  } finally {
    fixture.cleanup();
  }
});

test('retirement remains local to its release epoch and does not reserve reused identities', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'base\n');
    commitAll(fixture.repo, 'base');
    const engine = actions(fixture.repo);

    const firstA = approve(engine, 'retire-a', 1, null, ['S1', 'S2']);
    const secondA = approve(engine, 'retire-a', 2, firstA.plan, ['S1']);
    assert.equal(secondA.retirements.length, 1);
    assert.equal(secondA.retirements[0].slice, 'S2');
    deliver(engine, fixture.repo, 'retire-a');
    engine.mergePassedCandidate({
      release: 'retire-a',
      summary: 'Merge the exact retire-a PASS.',
    });

    const firstB = approve(engine, 'retire-b', 1, null, ['S2']);
    const secondB = approve(engine, 'retire-b', 2, firstB.plan, ['S2']);
    assert.equal(secondB.retirements.length, 0);
    assert.equal(state(fixture.repo, 'retire-b').slices[0].location.slice.id, 'S2');
  } finally {
    fixture.cleanup();
  }
});

test('the exclusive floor ignores inherited malformed receipts but rejects every bad receipt above it', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'base\n');
    const base = commitAll(fixture.repo, 'base');
    const inherited = unsafePrepareMetadataCommit(fixture.repo, {
      expectedHead: base,
      message: Buffer.from('inherited malformed receipt\n\nBaton-Receipt: not-json\n'),
    });
    git(fixture.repo, 'update-ref', 'refs/heads/main', inherited.commit, base);

    const engine = actions(fixture.repo);
    const approved = approve(engine, 'epoch-safe');
    assert.equal(approved.target, inherited.commit);
    assert.equal(state(fixture.repo, 'epoch-safe').plan.oid, approved.plan);

    const releaseRef = referenceNames.releaseRef('epoch-safe');
    const foreignMessage = renderReceiptCommit({
      subject: 'foreign receipt inside epoch-safe',
      receipt: {
        version: 1,
        release: 'other-release',
        slice: 'S1',
        role: 'planner',
        result: 'retired',
        attempt: 1,
        plan: approved.plan,
        contract: CONTRACT,
        binds: approved.receipt_commit,
        detail: digestBytes(Buffer.alloc(0)),
        summary: 'A valid receipt under the wrong release.',
      },
    });
    const foreign = unsafePrepareMetadataCommit(fixture.repo, {
      expectedHead: approved.receipt_commit,
      message: foreignMessage,
    });
    const trackRef = 'refs/heads/track/epoch-safe/T1';
    git(fixture.repo, 'update-ref', trackRef, foreign.commit);
    assert.throws(
      () => state(fixture.repo, 'epoch-safe'),
      (error) => error?.code === 'AMBIGUOUS_AUTHORITY',
    );
    git(fixture.repo, 'update-ref', '-d', trackRef, foreign.commit);

    git(
      fixture.repo,
      'update-ref',
      releaseRef,
      foreign.commit,
      approved.receipt_commit,
    );
    assert.throws(
      () => state(fixture.repo, 'epoch-safe'),
      (error) => error?.code === 'RELEASE_RECEIPT_MISMATCH',
    );

    git(fixture.repo, 'update-ref', releaseRef, approved.receipt_commit, foreign.commit);
    const malformed = unsafePrepareMetadataCommit(fixture.repo, {
      expectedHead: approved.receipt_commit,
      message: Buffer.from('malformed receipt inside epoch\n\nBaton-Receipt: not-json\n'),
    });
    git(
      fixture.repo,
      'update-ref',
      releaseRef,
      malformed.commit,
      approved.receipt_commit,
    );
    assert.throws(
      () => state(fixture.repo, 'epoch-safe'),
      (error) => /invalid receipt/.test(error?.message ?? ''),
    );

    git(fixture.repo, 'update-ref', releaseRef, approved.receipt_commit, malformed.commit);
    const forgedApproval = unsafePrepareMetadataCommit(fixture.repo, {
      expectedHead: approved.receipt_commit,
      message: renderReceiptCommit({
        subject: 'forged duplicate revision-1 approval',
        receipt: {
          ...approved.receipt,
          binds: approved.receipt_commit,
          target: git(fixture.repo, 'rev-parse', `${approved.receipt_commit}^`),
          summary: 'Attempt to move the release epoch floor.',
        },
      }),
    });
    git(
      fixture.repo,
      'update-ref',
      releaseRef,
      forgedApproval.commit,
      approved.receipt_commit,
    );
    assert.throws(
      () => state(fixture.repo, 'epoch-safe'),
      (error) => error?.code === 'INVALID_PLAN_HISTORY',
    );
  } finally {
    fixture.cleanup();
  }
});

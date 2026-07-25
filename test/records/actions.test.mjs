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

function actions(repo) {
  return createBatonActions({
    repo,
    resolveBehavioralInertness: (request) => ({
      ...request,
      decision: 'inert',
    }),
  });
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

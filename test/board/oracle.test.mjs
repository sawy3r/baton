import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  boardBytes,
  projectBoard,
} from '../../reference/board/oracle.mjs';
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

test('approved receipts project stable plan revision, attempt, and next operation', () => {
  const fixture = baselineFixture();
  try {
    const first = projectBoard(fixture.repo);
    const second = projectBoard(fixture.repo);
    assert.equal(first.valid, true);
    assert.deepEqual(boardBytes(first), boardBytes(second));
    const [release] = first.releases;
    assert.equal(release.plan_revision, 1);
    assert.equal(release.tracks[0].work[0].attempt, 1);
    assert.equal(release.tracks[0].work[0].source.mode, 'plan');
    assert.deepEqual(release.next_operations, [{
      operation: 'baton-implement',
      scope: 'work',
      release: 'v1.0.0',
      track: 'T1',
      work: 'S1',
    }]);
    assert.equal(release.diagnostics[0].code, 'TRACK_REF_ABSENT');
    assert.notEqual(release.status, 'blocked');
  } finally {
    fixture.cleanup();
  }
});

test('non-repository input returns one bounded invalid projection', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'baton-board-non-repo-'));
  try {
    const board = projectBoard(directory);
    assert.equal(board.valid, false);
    assert.equal(board.repository, null);
    assert.deepEqual(board.releases, []);
    assert.deepEqual(board.next_operations, []);
    assert.equal(board.diagnostics[0].code, 'GIT_COMMAND_FAILED');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('undeclared branch receipts cannot alter authoritative projection', () => {
  const fixture = baselineFixture();
  try {
    const before = boardBytes(projectBoard(fixture.repo));
    git(fixture.repo, 'switch', '-q', '-c', 'foreign-copy', fixture.approval.oid);
    appendReceipt(fixture.repo, {
      version: 1,
      release: 'v1.0.0',
      slice: 'S1',
      role: 'implementer',
      result: 'designed',
      attempt: 1,
      plan: fixture.plan,
      contract: fixture.parsed.metadata.contracts.S1,
      binds: fixture.approval.oid,
      summary: 'Foreign copy.',
    });
    assert.deepEqual(boardBytes(projectBoard(fixture.repo)), before);
  } finally {
    fixture.cleanup();
  }
});

test('design receipt derives Captain responsibility without a status cursor', () => {
  const fixture = baselineFixture();
  try {
    const design = designSlice(fixture, 'S1');
    const work = projectBoard(fixture.repo).releases[0].tracks[0].work[0];
    assert.equal(work.next_role, 'captain');
    assert.equal(work.attempt, 1);
    assert.equal(work.source.head, design.oid);
    assert.equal(work.next_operation.operation, 'baton-design-review');
  } finally {
    fixture.cleanup();
  }
});

test('moved target is recoverable through a plan revision, not BLOCKED', () => {
  const fixture = baselineFixture();
  try {
    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'target.txt', 'moved\n');
    commitAll(fixture.repo, 'move target');
    const release = projectBoard(fixture.repo).releases[0];
    assert.equal(release.valid, true);
    assert.equal(release.status, 'in_progress');
    assert.equal(release.diagnostics[0].code, 'TARGET_MOVED');
    assert.deepEqual(release.next_operations, [{
      operation: 'baton-plan',
      scope: 'release',
      release: 'v1.0.0',
      track: null,
      work: null,
    }]);
  } finally {
    fixture.cleanup();
  }
});

test('plan revision invalidates only changed contracts and consumed input closure', () => {
  const metadata = oneSliceMetadata({
    tracks: [
      {
        id: 'T1',
        depends_on: [],
        slices: [
          slice('S1', 'src/one.txt'),
          slice('S2', 'src/two.txt'),
        ],
      },
      {
        id: 'T2',
        depends_on: [],
        slices: [slice('S3', 'src/three.txt', {
          depends_on: ['S1'],
          consumes: ['S1'],
        })],
      },
    ],
  });
  const fixture = baselineFixture(metadata);
  try {
    const s1 = passSlice(fixture, 'S1');
    passSlice(fixture, 'S2');
    passSlice(fixture, 'S3', { inputs: { S1: s1.identity.productTree } });
    revisePlan(fixture, (revision) => {
      revision.tracks[0].slices[0].acceptance[0].text = 'S1 changed.';
    });
    const release = projectBoard(fixture.repo, {
      productExclusionAdmission: fixture.admission,
    }).releases[0];
    const work = Object.fromEntries(release.tracks.flatMap((track) => (
      track.work.map((item) => [item.id, item])
    )));
    assert.equal(work.S1.next_role, 'implementer');
    assert.equal(work.S2.outcome, 'pass');
    assert.equal(work.S2.source.mode, 'retained');
    assert.equal(work.S3.outcome, 'stale');
    assert.equal(release.diagnostics.some(({ code }) => code === 'STALE_INPUTS'), true);
  } finally {
    fixture.cleanup();
  }
});

test('forged authoritative receipt makes only its release invalid', () => {
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
      summary: 'Forged binding.',
    });
    const board = projectBoard(fixture.repo);
    assert.equal(board.valid, false);
    assert.equal(board.releases[0].status, 'invalid');
    assert.equal(board.releases[0].diagnostics[0].code, 'STALE_BINDING');
    assert.deepEqual(board.next_operations, []);
  } finally {
    fixture.cleanup();
  }
});

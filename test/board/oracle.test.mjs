import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  boardBytes,
  createBoardOracle,
  projectBoard,
} from '../../reference/board/oracle.mjs';
import {
  captureRefSnapshot,
  workStatusPath,
} from '../../reference/records/records.mjs';
import {
  commitAll,
  git,
  makePlanMetadata,
  write,
} from '../records/helpers.mjs';
import {
  advanceToCaptain,
  addBaselineRelease,
  baselineFixture,
  composeSingleWorkTrack,
  mergeAssembly,
  materializeTrack,
  oneTrackMetadata,
  passAssembly,
  prepareAssembly,
  prepareReleaseMove,
} from './helpers.mjs';

test('baseline projection exposes every independent authored track in stable order', () => {
  const fixture = baselineFixture();
  try {
    const first = projectBoard(fixture.repo);
    const second = projectBoard(fixture.repo);
    assert.equal(first.valid, true);
    assert.deepEqual(first, second);
    assert.deepEqual(boardBytes(first), boardBytes(second));
    assert.equal(first.repository, 'example/baton');
    assert.equal(first.releases.length, 1);

    const [release] = first.releases;
    assert.equal(release.status, 'in_progress');
    assert.deepEqual(release.tracks.map((track) => track.id), ['T1', 'T2', 'T3']);
    assert.deepEqual(release.next_operations, [
      {
        operation: 'baton-implement',
        scope: 'work',
        release: 'v1.0.0',
        track: 'T1',
        work: 'W1',
      },
      {
        operation: 'baton-implement',
        scope: 'work',
        release: 'v1.0.0',
        track: 'T2',
        work: 'W3',
      },
    ]);
    assert.deepEqual(release.tracks[2].blockers, ['T1']);
    assert.equal(release.tracks[2].next_operation, null);
    assert.equal(release.tracks[0].work[0].source.mode, 'baseline');
    assert.equal(release.assembly.status, 'waiting');
  } finally {
    fixture.cleanup();
  }
});

test('non-repository input returns one invalid projection instead of throwing', () => {
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

test('undeclared branch copies cannot alter authoritative projection', () => {
  const fixture = baselineFixture();
  try {
    const before = boardBytes(projectBoard(fixture.repo));
    git(fixture.repo, 'switch', '-q', '-c', 'foreign-copy', fixture.release);
    write(
      fixture.repo,
      workStatusPath(fixture.plan, 'W1'),
      '{"not":"a Baton status"}\n',
    );
    commitAll(fixture.repo, 'foreign stale status');
    assert.deepEqual(boardBytes(projectBoard(fixture.repo)), before);
  } finally {
    fixture.cleanup();
  }
});

test('projection reads captured Git objects, not launch-worktree record paths', () => {
  const fixture = baselineFixture();
  try {
    const expected = boardBytes(createBoardOracle().project(fixture.repo));
    rmSync(path.join(fixture.repo, '.baton'), { recursive: true, force: true });
    symlinkSync('README.md', path.join(fixture.repo, '.baton'));
    const observed = boardBytes(createBoardOracle().project(fixture.repo));
    assert.deepEqual(observed, expected);
  } finally {
    fixture.cleanup();
  }
});

test('immutable projection cache invalidates when a declared ref head changes', () => {
  const fixture = baselineFixture();
  try {
    const baseline = projectBoard(fixture.repo);
    assert.equal(baseline.releases[0].tracks[0].materialisation, 'baseline');
    materializeTrack(fixture, 'T1');
    const materialized = projectBoard(fixture.repo);
    assert.equal(materialized.valid, true);
    assert.equal(materialized.releases[0].tracks[0].materialisation, 'owner');
    assert.notEqual(
      materialized.releases[0].release_head,
      baseline.releases[0].release_head,
    );

    const previousTarget = materialized.releases[0].target_head;
    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'target-change.txt', 'target moved\n');
    const movedTarget = commitAll(fixture.repo, 'move target');
    const refreshed = projectBoard(fixture.repo);
    assert.equal(refreshed.valid, true);
    assert.equal(refreshed.releases[0].target_head, movedTarget);
    assert.notEqual(refreshed.releases[0].target_head, previousTarget);
  } finally {
    fixture.cleanup();
  }
});

test('a malformed mandatory owner is visible and emits no operations for its release', () => {
  const fixture = baselineFixture();
  try {
    git(
      fixture.repo,
      'switch',
      '-q',
      '-c',
      'track/v1.0.0/T1',
      fixture.release,
    );
    write(fixture.repo, workStatusPath(fixture.plan, 'W1'), '{"malformed":true}\n');
    commitAll(fixture.repo, 'malformed owner status');

    const board = projectBoard(fixture.repo);
    assert.equal(board.valid, false);
    assert.equal(board.releases[0].valid, false);
    assert.equal(board.releases[0].status, 'invalid');
    assert.deepEqual(board.releases[0].next_operations, []);
    assert.ok(board.releases[0].diagnostics.some((item) => item.code === 'UNKNOWN_FIELD'));
  } finally {
    fixture.cleanup();
  }
});

test('one invalid release does not hide independently valid releases', () => {
  const fixture = baselineFixture();
  try {
    addBaselineRelease(fixture, 'v2.0.0', { malformedWork: 'W3' });
    const board = projectBoard(fixture.repo);
    assert.equal(board.valid, false);
    assert.deepEqual(board.releases.map((release) => release.release), [
      'v1.0.0',
      'v2.0.0',
    ]);
    assert.equal(board.releases[0].valid, true);
    assert.ok(board.releases[0].next_operations.length > 0);
    assert.equal(board.releases[1].valid, false);
    assert.deepEqual(board.releases[1].next_operations, []);
  } finally {
    fixture.cleanup();
  }
});

test('repository identity cannot leak an absolute workspace path', () => {
  const metadata = makePlanMetadata();
  metadata.repository = '/home/person/private-project';
  const fixture = baselineFixture(metadata);
  try {
    const board = projectBoard(fixture.repo);
    assert.equal(board.valid, false);
    assert.equal(board.repository, null);
    assert.equal(
      board.releases[0].diagnostics[0].code,
      'INVALID_REPOSITORY_IDENTITY',
    );
    assert.doesNotMatch(JSON.stringify(board), /home\/person/);
  } finally {
    fixture.cleanup();
  }
});

test('materialised owner state wins and advances only its first serial work', () => {
  const fixture = baselineFixture();
  try {
    const materialized = materializeTrack(fixture, 'T1');
    advanceToCaptain(fixture, materialized, 'W1');
    const board = projectBoard(fixture.repo);
    assert.equal(board.valid, true);
    const track = board.releases[0].tracks[0];
    assert.equal(track.materialisation, 'owner');
    assert.equal(track.work[0].source.mode, 'owner');
    assert.equal(track.work[0].next_role, 'captain');
    assert.deepEqual(track.next_operation, {
      operation: 'baton-design-review',
      scope: 'work',
      release: 'v1.0.0',
      track: 'T1',
      work: 'W1',
    });
    assert.equal(track.work[1].next_operation, null);
  } finally {
    fixture.cleanup();
  }
});

test('exact composition plus authority transfer selects release state', () => {
  const fixture = baselineFixture();
  try {
    const composed = composeSingleWorkTrack(fixture, 'T2');
    const board = projectBoard(fixture.repo);
    assert.equal(board.valid, true);
    const track = board.releases[0].tracks[1];
    assert.equal(track.composition, 'composed');
    assert.equal(track.materialisation, 'transferred');
    assert.equal(track.frozen_head, composed.frozenHead);
    assert.equal(track.work[0].source.mode, 'composed');
    assert.equal(track.work[0].source.ref, fixture.plan.metadata.release_ref);
    assert.equal(track.next_operation, null);
  } finally {
    fixture.cleanup();
  }
});

test('assembly verification and final release Merge remain distinct gates', () => {
  const fixture = baselineFixture(oneTrackMetadata());
  try {
    const composed = composeSingleWorkTrack(fixture, 'T1');
    let board = projectBoard(fixture.repo);
    assert.equal(board.releases[0].status, 'assembly_ready');
    assert.deepEqual(board.releases[0].assembly.next_operation, {
      operation: 'baton-merge',
      scope: 'assembly',
      release: 'v1.0.0',
      track: null,
      work: null,
    });

    const prepared = prepareAssembly(fixture, composed);
    board = projectBoard(fixture.repo);
    assert.equal(board.valid, true);
    assert.equal(board.releases[0].status, 'assembly');
    assert.equal(board.releases[0].assembly.next_role, 'verifier');
    assert.equal(board.releases[0].assembly.next_operation.operation, 'baton-verify');

    const passed = passAssembly(fixture, prepared);
    board = projectBoard(fixture.repo);
    assert.equal(board.valid, true);
    assert.equal(board.releases[0].status, 'merge_ready');
    assert.equal(board.releases[0].assembly.next_operation.operation, 'baton-merge');
    assert.equal(board.releases[0].status === 'complete', false);

    mergeAssembly(fixture, composed, passed);
    board = projectBoard(fixture.repo);
    assert.equal(board.valid, true);
    assert.equal(board.releases[0].status, 'complete');
    assert.equal(board.releases[0].assembly.status, 'complete');
    assert.deepEqual(board.releases[0].next_operations, []);
  } finally {
    fixture.cleanup();
  }
});

test('one release movement is retried from its new immutable plan head', () => {
  const fixture = baselineFixture();
  try {
    const moved = prepareReleaseMove(fixture, 'release moved once');
    git(fixture.repo, 'update-ref', fixture.plan.metadata.release_ref, fixture.release);
    let captures = 0;
    const oracle = createBoardOracle({
      captureSnapshot(repo, plan) {
        captures += 1;
        if (captures === 1) {
          git(repo, 'update-ref', plan.metadata.release_ref, moved, fixture.release);
        }
        return captureRefSnapshot(repo, plan);
      },
    });
    const board = oracle.project(fixture.repo);
    assert.equal(board.valid, true);
    assert.equal(captures, 2);
    assert.equal(board.releases[0].release_head, moved);
  } finally {
    fixture.cleanup();
  }
});

test('two release movements fail with REF_SNAPSHOT_UNSTABLE', () => {
  const fixture = baselineFixture();
  try {
    const firstMove = prepareReleaseMove(fixture, 'release first move');
    const secondMove = prepareReleaseMove(fixture, 'release second move');
    git(fixture.repo, 'update-ref', fixture.plan.metadata.release_ref, fixture.release);
    let captures = 0;
    const oracle = createBoardOracle({
      captureSnapshot(repo, plan) {
        captures += 1;
        const next = captures === 1 ? firstMove : secondMove;
        git(repo, 'update-ref', plan.metadata.release_ref, next);
        return captureRefSnapshot(repo, plan);
      },
    });
    const board = oracle.project(fixture.repo);
    assert.equal(board.valid, false);
    assert.equal(captures, 2);
    assert.equal(board.releases[0].diagnostics[0].code, 'REF_SNAPSHOT_UNSTABLE');
    assert.deepEqual(board.releases[0].next_operations, []);
  } finally {
    fixture.cleanup();
  }
});

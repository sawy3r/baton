import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { projectBoard } from '../../reference/board/oracle.mjs';
import {
  baselineFixture,
  oneSliceMetadata,
  slice,
} from './helpers.mjs';

function performancePlan({ trackCount = 20, slicesPerTrack = 5 } = {}) {
  let ordinal = 0;
  return oneSliceMetadata({
    tracks: Array.from({ length: trackCount }, (_, trackIndex) => {
      const trackID = `T${String(trackIndex + 1).padStart(2, '0')}`;
      let previous = null;
      const slices = Array.from({ length: slicesPerTrack }, (_, sliceIndex) => {
        ordinal += 1;
        const sliceID = `S${String(ordinal).padStart(4, '0')}`;
        const result = slice(
          sliceID,
          `src/${trackID}/slice-${String(sliceIndex + 1).padStart(2, '0')}.mjs`,
          { depends_on: previous ? [previous] : [] },
        );
        previous = sliceID;
        return result;
      });
      return { id: trackID, depends_on: [], slices };
    }),
  });
}

function workCount(board) {
  return board.releases[0].tracks
    .reduce((total, track) => total + track.work.length, 0);
}

test('100 slices across 20 owner refs project below one second warm median', (t) => {
  const fixture = baselineFixture(performancePlan());
  try {
    const warmup = projectBoard(fixture.repo);
    assert.equal(warmup.valid, true);
    assert.equal(warmup.releases[0].tracks.length, 20);
    assert.equal(workCount(warmup), 100);

    const samples = [];
    for (let count = 0; count < 5; count += 1) {
      const started = performance.now();
      const board = projectBoard(fixture.repo);
      samples.push(performance.now() - started);
      assert.equal(board.valid, true);
    }
    samples.sort((left, right) => left - right);
    const median = samples[Math.floor(samples.length / 2)];
    t.diagnostic(`warm samples ms: ${samples.map((value) => value.toFixed(1)).join(', ')}`);
    t.diagnostic(`warm median ms: ${median.toFixed(1)}`);
    assert.ok(median < 1_000, `warm median ${median.toFixed(1)}ms exceeded 1000ms`);
  } finally {
    fixture.cleanup();
  }
});

test('maximum 64-track and 1024-slice plan projects within schema bounds', () => {
  const fixture = baselineFixture(performancePlan({
    trackCount: 64,
    slicesPerTrack: 16,
  }));
  try {
    const board = projectBoard(fixture.repo);
    assert.equal(board.valid, true);
    assert.equal(board.releases[0].tracks.length, 64);
    assert.equal(workCount(board), 1_024);
    assert.equal(board.releases[0].next_operations.length, 64);
  } finally {
    fixture.cleanup();
  }
});

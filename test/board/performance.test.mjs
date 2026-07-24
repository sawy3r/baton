import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test, { after } from 'node:test';

import { projectBoard } from '../../reference/board/oracle.mjs';
import { configureEngineGitExecutable } from '../../reference/records/git.mjs';
import { makePlanMetadata } from '../records/helpers.mjs';
import {
  baselineFixture,
  materializeTrack,
  passEveryWork,
} from './helpers.mjs';

const TRACE_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'baton-board-git-trace-'));
const TRACE_FILE = path.join(TRACE_DIRECTORY, 'commands.log');
const GIT_WRAPPER = path.join(TRACE_DIRECTORY, 'git');
writeFileSync(
  GIT_WRAPPER,
  `#!/bin/sh\nprintf '%s\\n' "$*" >> '${TRACE_FILE}'\nexec /usr/bin/git "$@"\n`,
);
chmodSync(GIT_WRAPPER, 0o755);
configureEngineGitExecutable(GIT_WRAPPER);
after(() => rmSync(TRACE_DIRECTORY, { recursive: true, force: true }));

function performancePlan() {
  const metadata = makePlanMetadata();
  metadata.tracks = Array.from({ length: 20 }, (_, trackIndex) => {
    const trackId = `T${String(trackIndex + 1).padStart(2, '0')}`;
    const surface = `src/track-${String(trackIndex + 1).padStart(2, '0')}`;
    return {
      id: trackId,
      ref: `refs/heads/track/v1.0.0/${trackId}`,
      depends_on: [],
      touch_surfaces: [surface],
      work: Array.from({ length: 5 }, (_, workIndex) => {
        const workId = `W${String((trackIndex * 5) + workIndex + 1).padStart(3, '0')}`;
        const prior = workIndex === 0
          ? []
          : [`W${String((trackIndex * 5) + workIndex).padStart(3, '0')}`];
        return {
          id: workId,
          outcome: `Deliver ${workId}`,
          scope: {
            include: [`${surface}/work-${workIndex + 1}.mjs`],
            exclude: [],
          },
          acceptance: [{ id: `${workId}-A1`, text: `${workId} is complete.` }],
          checks: ['node --test'],
          constraints: ['Keep Baton records inert.'],
          depends_on: prior,
        };
      }),
    };
  });
  return metadata;
}

test('100 work items across 20 owner refs project below one second warm median', (t) => {
  const fixture = baselineFixture(performancePlan());
  try {
    for (const track of fixture.plan.metadata.tracks) materializeTrack(fixture, track.id);
    writeFileSync(TRACE_FILE, '');
    const warmup = projectBoard(fixture.repo);
    assert.equal(warmup.valid, true);
    assert.equal(warmup.releases[0].tracks.length, 20);
    assert.equal(
      warmup.releases[0].tracks.reduce((total, track) => total + track.work.length, 0),
      100,
    );
    const coldCommands = readFileSync(TRACE_FILE, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(
      coldCommands.filter((command) => command.includes('for-each-ref')).length,
      2,
      'cold projection must use discovery plus one exact ref snapshot',
    );
    assert.equal(
      coldCommands.filter((command) => command.includes('cat-file --batch')).length,
      21,
      'cold projection must batch statuses once for the release and each owner ref',
    );

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
    assert.ok(median < 1000, `warm median ${median.toFixed(1)}ms exceeded 1000ms`);
  } finally {
    fixture.cleanup();
  }
});

function advancedProjectionCommands(workCount) {
  const metadata = performancePlan();
  metadata.tracks = [{
    ...metadata.tracks[0],
    work: metadata.tracks[0].work.slice(0, workCount),
  }];
  const fixture = baselineFixture(metadata);
  try {
    const materialized = materializeTrack(fixture, 'T01');
    passEveryWork(fixture, materialized);
    writeFileSync(TRACE_FILE, '');
    const board = projectBoard(fixture.repo);
    assert.equal(board.valid, true);
    assert.equal(board.releases[0].tracks[0].composition, 'ready');
    return readFileSync(TRACE_FILE, 'utf8').trim().split('\n').filter(Boolean);
  } finally {
    fixture.cleanup();
  }
}

test('advanced proof projection uses fixed Git process count per selected ref', (t) => {
  const one = advancedProjectionCommands(1);
  const five = advancedProjectionCommands(5);
  assert.equal(
    five.length,
    one.length,
    `five proofs used ${five.length} Git processes versus ${one.length} for one proof`,
  );
  for (const commands of [one, five]) {
    assert.equal(
      commands.filter((command) => command.includes('cat-file --batch')).length,
      3,
      'release, owner, and immutable materialization marker each use one batch',
    );
    assert.equal(
      commands.filter((command) => command.includes('merge-base --independent')).length,
      1,
      'all proof candidates share one captured-authority reachability check',
    );
    assert.equal(
      commands.filter((command) => command.includes('--ancestry-path')).length,
      1,
      'all proof pairs share one bounded commit-graph read',
    );
  }
  t.diagnostic(`advanced projection Git processes: ${five.length}`);
});

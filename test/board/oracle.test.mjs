import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  boardBytes,
  createBoardOracle as createOracle,
  GRAPH_VERSION,
  projectBoard,
} from '../../reference/board/oracle.mjs';
import { createBatonActions as createActions } from '../../reference/records/actions.mjs';
import { readBatonState as readState } from '../../reference/records/state.mjs';
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
  TEST_GIT_IDENTITY,
} from './helpers.mjs';

function createBatonActions(options) {
  return createActions({ ...options, identity: TEST_GIT_IDENTITY });
}

function readBatonState(repo, release, options = {}) {
  return readState(repo, release, { ...options, identity: TEST_GIT_IDENTITY });
}

function createBoardOracle(options = {}) {
  return createOracle({ identity: TEST_GIT_IDENTITY, ...options });
}

function graphNode(release, id) {
  return release.graph.nodes.find((node) => node.id === id);
}

function batonActions(repo) {
  return createBatonActions({ repo });
}

test('release graph is canonical, direct, coalesced, and deterministic', () => {
  const metadata = oneSliceMetadata({
    tracks: [
      {
        id: 'T1',
        depends_on: [],
        slices: [
          slice('S1', 'src/one.txt'),
          slice('S2', 'src/two.txt', {
            depends_on: ['S1'],
            consumes: ['S1'],
          }),
        ],
      },
      {
        id: 'T2',
        depends_on: ['T1'],
        slices: [slice('S3', 'src/three.txt', {
          depends_on: ['S2'],
          consumes: ['S2'],
        })],
      },
      {
        id: 'T3',
        depends_on: ['T2'],
        slices: [slice('S4', 'src/four.txt')],
      },
    ],
  });
  const fixture = baselineFixture(metadata);
  try {
    const first = projectBoard(fixture.repo);
    const second = projectBoard(fixture.repo);
    assert.deepEqual(boardBytes(first), boardBytes(second));
    assert.deepEqual(first.releases[0].graph, {
      schema_version: GRAPH_VERSION,
      nodes: [
        {
          id: 'plan',
          kind: 'plan',
          state: 'approved',
          next_operation: null,
        },
        {
          id: 'slice:S1',
          kind: 'slice',
          track: 'T1',
          work: 'S1',
          state: 'ready',
          next_operation: {
            operation: 'baton-implement',
            scope: 'work',
            release: 'v1.0.0',
            track: 'T1',
            work: 'S1',
          },
        },
        {
          id: 'slice:S2',
          kind: 'slice',
          track: 'T1',
          work: 'S2',
          state: 'waiting',
          next_operation: null,
        },
        {
          id: 'slice:S3',
          kind: 'slice',
          track: 'T2',
          work: 'S3',
          state: 'waiting',
          next_operation: null,
        },
        {
          id: 'slice:S4',
          kind: 'slice',
          track: 'T3',
          work: 'S4',
          state: 'waiting',
          next_operation: null,
        },
        {
          id: 'assembly',
          kind: 'assembly',
          state: 'waiting',
          next_operation: null,
        },
        {
          id: 'merge',
          kind: 'merge',
          state: 'waiting',
          next_operation: null,
        },
      ],
      edges: [
        { from: 'plan', to: 'slice:S1', kinds: ['start'] },
        {
          from: 'slice:S1',
          to: 'slice:S2',
          kinds: ['consumes', 'depends_on', 'serial'],
        },
        {
          from: 'slice:S2',
          to: 'slice:S3',
          kinds: ['consumes', 'depends_on', 'track_dependency'],
        },
        { from: 'slice:S2', to: 'assembly', kinds: ['assembly'] },
        {
          from: 'slice:S3',
          to: 'slice:S4',
          kinds: ['track_dependency'],
        },
        { from: 'slice:S3', to: 'assembly', kinds: ['assembly'] },
        { from: 'slice:S4', to: 'assembly', kinds: ['assembly'] },
        {
          from: 'assembly',
          to: 'merge',
          kinds: ['verified_before_merge'],
        },
      ],
    });
    assert.equal(
      first.releases[0].graph.edges.some((edge) => (
        edge.from === 'slice:S2' && edge.to === 'slice:S4'
      )),
      false,
      'transitive track dependencies must not become closure edges',
    );
  } finally {
    fixture.cleanup();
  }
});

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

test('fast-forward target movement keeps the approved work eligible', () => {
  const fixture = baselineFixture();
  try {
    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'target.txt', 'moved\n');
    commitAll(fixture.repo, 'move target');
    const release = projectBoard(fixture.repo).releases[0];
    assert.equal(release.valid, true);
    assert.equal(release.status, 'in_progress');
    assert.equal(release.diagnostics.some(({ code }) => code === 'TARGET_DIVERGED'), false);
    assert.deepEqual(release.next_operations, [{
      operation: 'baton-implement',
      scope: 'work',
      release: 'v1.0.0',
      track: 'T1',
      work: 'S1',
    }]);
    assert.deepEqual(graphNode(release, 'plan'), {
      id: 'plan',
      kind: 'plan',
      state: 'approved',
      next_operation: null,
    });
    assert.equal(graphNode(release, 'slice:S1').state, 'ready');
    assert.equal(graphNode(release, 'slice:S1').next_operation, release.next_operations[0]);
    assert.equal(graphNode(release, 'assembly').next_operation, null);
    assert.equal(graphNode(release, 'merge').next_operation, null);
  } finally {
    fixture.cleanup();
  }
});

test('divergent target history pauses without inventing a plan revision', () => {
  const fixture = baselineFixture();
  try {
    const engine = createBatonActions({ repo: fixture.repo });
    const designInput = {
      release: 'v1.0.0',
      slice: 'S1',
      role: 'implementer',
      result: 'designed',
      summary: 'Prepare one bounded design.',
    };
    const designed = engine.appendReceipt(designInput);
    const divergent = git(
      fixture.repo,
      'commit-tree',
      `${fixture.target}^{tree}`,
      '-m',
      'replacement target root',
    );
    git(fixture.repo, 'branch', '-f', 'main', divergent);

    const release = projectBoard(fixture.repo).releases[0];
    assert.equal(release.valid, true);
    assert.equal(release.status, 'blocked');
    assert.equal(release.diagnostics[0].code, 'TARGET_DIVERGED');
    assert.deepEqual(release.next_operations, []);
    assert.deepEqual(graphNode(release, 'plan'), {
      id: 'plan',
      kind: 'plan',
      state: 'blocked',
      next_operation: null,
    });
    assert.equal(graphNode(release, 'slice:S1').state, 'waiting');
    assert.equal(graphNode(release, 'slice:S1').next_operation, null);

    const releaseRef = 'refs/heads/release-wt/v1.0.0';
    const trackRef = 'refs/heads/track/v1.0.0/T1';
    const releaseHead = git(fixture.repo, 'rev-parse', releaseRef);
    const trackHead = git(fixture.repo, 'rev-parse', trackRef);
    const retry = engine.appendReceipt(designInput);
    assert.equal(retry.changed, false);
    assert.equal(retry.receipt_commit, designed.receipt_commit);
    for (const action of [
      () => engine.appendReceipt({
        release: 'v1.0.0',
        slice: 'S1',
        role: 'captain',
        result: 'proceed',
        summary: 'Do not advance this design.',
      }),
      () => engine.prepareTrackBase({ release: 'v1.0.0', slice: 'S1' }),
      () => engine.prepareAssembly({ release: 'v1.0.0', summary: 'Do not assemble.' }),
      () => engine.mergePassedCandidate({ release: 'v1.0.0', summary: 'Do not merge.' }),
    ]) {
      assert.throws(action, (error) => error?.code === 'TARGET_DIVERGED');
    }
    assert.equal(git(fixture.repo, 'rev-parse', releaseRef), releaseHead);
    assert.equal(git(fixture.repo, 'rev-parse', trackRef), trackHead);
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
    }).releases[0];
    const work = Object.fromEntries(release.tracks.flatMap((track) => (
      track.work.map((item) => [item.id, item])
    )));
    assert.equal(work.S1.next_role, 'implementer');
    assert.equal(work.S2.outcome, 'pass');
    assert.equal(work.S2.source.mode, 'retained');
    assert.equal(work.S3.outcome, 'stale');
    assert.equal(graphNode(release, 'slice:S1').state, 'ready');
    assert.equal(graphNode(release, 'slice:S2').state, 'retained');
    assert.equal(graphNode(release, 'slice:S3').state, 'stale');
    assert.equal(graphNode(release, 'slice:S1').next_operation.operation, 'baton-implement');
    assert.equal(graphNode(release, 'slice:S2').next_operation, null);
    assert.equal(graphNode(release, 'slice:S3').next_operation, null);
    assert.equal(release.diagnostics.some(({ code }) => code === 'STALE_INPUTS'), true);
  } finally {
    fixture.cleanup();
  }
});

test('one-track direct PASS skips assembly and hands the exact Merge operation forward', () => {
  const fixture = baselineFixture();
  try {
    passSlice(fixture, 'S1');
    const release = projectBoard(fixture.repo, {
    }).releases[0];
    assert.equal(graphNode(release, 'slice:S1').state, 'passed');
    assert.deepEqual(graphNode(release, 'assembly'), {
      id: 'assembly',
      kind: 'assembly',
      state: 'not_required',
      next_operation: null,
    });
    assert.deepEqual(graphNode(release, 'merge'), {
      id: 'merge',
      kind: 'merge',
      state: 'ready',
      next_operation: release.next_operations[0],
    });
    assert.deepEqual(release.next_operations[0], {
      operation: 'baton-merge',
      scope: 'assembly',
      release: 'v1.0.0',
      track: null,
      work: null,
    });
    assert.equal(graphNode(release, 'merge').next_operation, release.next_operations[0]);

    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, 'target.txt', 'moved after direct PASS\n');
    commitAll(fixture.repo, 'move target after direct PASS');
    const stale = projectBoard(fixture.repo, {
    }).releases[0];
    assert.equal(graphNode(stale, 'plan').state, 'approved');
    assert.deepEqual(graphNode(stale, 'assembly'), {
      id: 'assembly',
      kind: 'assembly',
      state: 'ready',
      next_operation: stale.next_operations[0],
    });
    assert.deepEqual(graphNode(stale, 'merge'), {
      id: 'merge',
      kind: 'merge',
      state: 'waiting',
      next_operation: null,
    });
    assert.equal(stale.next_operations[0].operation, 'baton-merge');
    assert.equal(stale.next_operations[0].scope, 'assembly');
  } finally {
    fixture.cleanup();
  }
});

test('completed historical release remains valid when product scope excludes reserved records', () => {
  const release = 'sworn-v0.3.0-baton-v2';
  const fixture = baselineFixture(oneSliceMetadata({
    release,
    tracks: [{
      id: 'T1',
      depends_on: [],
      slices: [slice('S1', 'src/one.txt', {
        scope: {
          include: ['src/one.txt'],
          exclude: ['.baton/releases'],
        },
      })],
    }],
  }));
  try {
    passSlice(fixture, 'S1');
    batonActions(fixture.repo).mergePassedCandidate({
      release,
      summary: 'Merge the exact candidate covered by fresh PASS.',
    });
    const refs = git(
      fixture.repo,
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads',
    );

    const board = projectBoard(fixture.repo);

    assert.equal(board.valid, true);
    assert.equal(board.releases[0].release, release);
    assert.equal(board.releases[0].tracks[0].work[0].outcome, 'pass');
    assert.equal(graphNode(board.releases[0], 'merge').state, 'complete');
    assert.deepEqual(board.releases[0].diagnostics, []);
    assert.equal(
      git(
        fixture.repo,
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads',
      ),
      refs,
    );
  } finally {
    fixture.cleanup();
  }
});

test('ordinary projection passes no capability and preserves exact refs after PASS', () => {
  const fixture = baselineFixture();
  try {
    passSlice(fixture, 'S1');
    const before = git(
      fixture.repo,
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads',
    );
    const calls = [];
    const oracle = createBoardOracle({
      readState(repo, release, options) {
        calls.push({ repo, release, options });
        return readBatonState(repo, release, options);
      },
    });

    const board = oracle.project(fixture.repo);
    assert.equal(board.valid, true);
    assert.equal(board.releases[0].tracks[0].work[0].outcome, 'pass');
    assert.equal(graphNode(board.releases[0], 'merge').state, 'ready');
    assert.equal(calls.length, 1);
    assert.deepEqual(Object.keys(calls[0].options).sort(), [
      'captureRefs',
      'expectedReleaseHead',
    ]);
    assert.equal(calls[0].options.captureRefs, undefined);
    assert.equal(
      calls[0].options.expectedReleaseHead,
      board.releases[0].release_head,
    );
    assert.equal(
      git(
        fixture.repo,
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads',
      ),
      before,
    );
  } finally {
    fixture.cleanup();
  }
});

test('multi-track assembly moves the exact next operation and records Merge completion', () => {
  const fixture = baselineFixture(oneSliceMetadata({
    tracks: [
      {
        id: 'T1',
        depends_on: [],
        slices: [slice('S1', 'src/one.txt')],
      },
      {
        id: 'T2',
        depends_on: [],
        slices: [slice('S2', 'src/two.txt')],
      },
    ],
  }));
  try {
    passSlice(fixture, 'S1');
    passSlice(fixture, 'S2');
    const engine = batonActions(fixture.repo);

    let release = projectBoard(fixture.repo, {
    }).releases[0];
    assert.equal(graphNode(release, 'assembly').state, 'ready');
    assert.equal(graphNode(release, 'assembly').next_operation.operation, 'baton-merge');
    assert.equal(graphNode(release, 'merge').state, 'waiting');

    const assembled = engine.prepareAssembly({
      release: 'v1.0.0',
      summary: 'Compose the two exact passed track candidates.',
    });
    release = projectBoard(fixture.repo, {
    }).releases[0];
    assert.equal(graphNode(release, 'assembly').state, 'ready');
    assert.deepEqual(graphNode(release, 'assembly').next_operation, {
      operation: 'baton-verify',
      scope: 'assembly',
      release: 'v1.0.0',
      track: null,
      work: null,
    });
    assert.equal(graphNode(release, 'merge').state, 'waiting');

    engine.appendReceipt({
      release: 'v1.0.0',
      role: 'verifier',
      result: 'pass',
      summary: 'Fresh verification passed the exact assembly.',
      candidate: assembled.candidate,
      checkResults: 'assembly verifier PASS\n',
    });
    release = projectBoard(fixture.repo, {
    }).releases[0];
    assert.equal(graphNode(release, 'assembly').state, 'passed');
    assert.equal(graphNode(release, 'assembly').next_operation, null);
    assert.equal(graphNode(release, 'merge').state, 'ready');
    assert.deepEqual(graphNode(release, 'merge').next_operation, release.next_operations[0]);
    assert.equal(graphNode(release, 'merge').next_operation, release.next_operations[0]);

    engine.mergePassedCandidate({
      release: 'v1.0.0',
      summary: 'Merge the exact assembly covered by fresh PASS.',
    });
    release = projectBoard(fixture.repo, {
    }).releases[0];
    assert.equal(graphNode(release, 'assembly').state, 'passed');
    assert.equal(graphNode(release, 'assembly').next_operation, null);
    assert.deepEqual(graphNode(release, 'merge'), {
      id: 'merge',
      kind: 'merge',
      state: 'complete',
      next_operation: null,
    });
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
    assert.equal(board.releases[0].graph, null);
    assert.deepEqual(board.next_operations, []);
  } finally {
    fixture.cleanup();
  }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createBatonActions } from '../../reference/records/actions.mjs';
import {
  productTreeIdentity,
  readFileAtOID,
  resolveRef,
  unsafePrepareRecordTransition,
} from '../../reference/records/git.mjs';
import {
  assemblyProofPath,
  assemblyStatusPath,
  captureRefSnapshot,
  digestBytes,
  parsePlanBytes,
  readAuthoritativeRecordSnapshot,
  releasePlanPath,
  selectAssemblyFromSnapshot,
  selectAuthoritativeStatusFromSnapshot,
  workDesignPath,
  workProofPath,
  workStatusPath,
} from '../../reference/records/records.mjs';
import { boardBytes, projectBoard } from '../../reference/board/oracle.mjs';
import { renderTerminal } from '../../reference/board/terminal.mjs';
import { startBoardServer } from '../../reference/board/web.mjs';
import { validateDriverResult } from '../../reference/driver/fake-driver.mjs';
import {
  APPROVAL_BYTES,
  DIGESTS,
  DISPATCH_BYTES,
  captainResult,
  clone,
  commitAll,
  designReady,
  git,
  makePlanBytes,
  makePlanMetadata,
  proofReady,
  temporaryRepository,
  testProductExclusionAdmission,
  testRecordPathAdmission,
  verified,
  write,
} from '../records/helpers.mjs';

const DRIVER_FILE = fileURLToPath(
  new URL('../../reference/driver/fake-driver.mjs', import.meta.url),
);
const GENERATED_MANIFEST = JSON.parse(readFileSync(
  new URL('../../adapters/generated/generated-manifest.json', import.meta.url),
  'utf8',
));
const OPERATION_FOR_ROLE = Object.freeze({
  planner: 'baton-plan',
  implementer: 'baton-implement',
  captain: 'baton-design-review',
  verifier: 'baton-verify',
  merge: 'baton-merge',
});
const FIXED_ROOT_TIMESTAMP = 1_700_000_000;

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function statusBytes(status) {
  return Buffer.from(`${JSON.stringify(status)}\n`);
}

function repositoryCommitState(repo) {
  const refs = git(repo, 'for-each-ref', '--format=%(refname) %(objectname)')
    .split('\n')
    .filter(Boolean)
    .sort();
  const commits = git(
    repo,
    'cat-file',
    '--batch-all-objects',
    '--batch-check=%(objecttype) %(objectname)',
  )
    .split('\n')
    .filter((entry) => entry.startsWith('commit '))
    .sort();
  return { refs, commits };
}

function expectCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code);
}

function withCommitDate(timestamp, operation) {
  const names = [
    'GIT_AUTHOR_DATE',
    'GIT_COMMITTER_DATE',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const date = `@${timestamp} +0000`;
  process.env.GIT_AUTHOR_DATE = date;
  process.env.GIT_COMMITTER_DATE = date;
  try {
    return operation();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

function commitRoot(repo, message) {
  return withCommitDate(FIXED_ROOT_TIMESTAMP, () => commitAll(repo, message));
}

function commitProduct(repo, message) {
  const parentTime = Number.parseInt(git(repo, 'show', '-s', '--format=%ct', 'HEAD'), 10);
  assert.equal(Number.isSafeInteger(parentTime), true);
  return withCommitDate(parentTime + 1, () => commitAll(repo, message));
}

function operationFixture(role) {
  const id = OPERATION_FOR_ROLE[role];
  const instructions = readFileSync(
    new URL(`../../operations/${id}.md`, import.meta.url),
    'utf8',
  );
  return {
    id,
    version: 'baton.operation/v1',
    digest: sha256(Buffer.from(instructions)),
    instructions,
  };
}

function planInput(plan) {
  return {
    name: 'plan',
    path: releasePlanPath(plan),
    digest: plan.digest,
  };
}

function driverInputs(plan, status, { designBytes = null, proofBytes = null } = {}) {
  const inputs = [planInput(plan)];
  if (status) {
    inputs.push({
      name: 'status',
      path: status.kind === 'assembly'
        ? assemblyStatusPath(plan)
        : workStatusPath(plan, status.work_id),
      digest: digestBytes(statusBytes(status)),
    });
  }
  if (designBytes) {
    inputs.push({
      name: 'design',
      path: workDesignPath(plan, status.work_id),
      digest: digestBytes(designBytes),
    });
  }
  if (proofBytes) {
    inputs.push({
      name: 'proof',
      path: status.kind === 'assembly'
        ? assemblyProofPath(plan)
        : workProofPath(plan, status.work_id),
      digest: digestBytes(proofBytes),
    });
  }
  return inputs;
}

function createDriver(repo, plan) {
  const counts = {
    planner: 0,
    implementer: 0,
    captain: 0,
    verifier: 0,
    merge: 0,
  };
  const events = [];

  function run(role, label, {
    profile = 'completed',
    status = null,
    designBytes = null,
    proofBytes = null,
  } = {}) {
    counts[role] += 1;
    const invocationId = `dogfood-${role}-${counts[role]}-${label}`;
    const request = {
      schema_version: 'baton.driver-request/v1',
      invocation_id: invocationId,
      role,
      operation: operationFixture(role),
      model: 'fake-dogfood-v1',
      workspace: {
        path: repo,
        access: role === 'verifier' ? 'read_only' : 'read_write',
      },
      inputs: driverInputs(plan, status, { designBytes, proofBytes }),
      fresh_context: role === 'verifier',
      limits: {
        timeout_ms: 5_000,
        output_bytes: 4_096,
      },
    };
    const child = spawnSync(process.execPath, [DRIVER_FILE, 'run'], {
      encoding: 'utf8',
      input: `${JSON.stringify(request)}\n`,
      env: {
        PATH: process.env.PATH,
        BATON_FAKE_PROFILE: profile,
      },
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, '');
    assert.equal(child.stdout.trim().split('\n').length, 1);
    const result = validateDriverResult(JSON.parse(child.stdout), {
      invocation_id: invocationId,
      driver_id: 'baton.fake',
      driver_version: '1.0.0',
    });
    assert.equal(result.transport_status, profile);
    assert.equal(Object.hasOwn(result, 'verdict'), false);
    assert.equal(Object.hasOwn(result, 'outcome'), false);
    events.push({
      invocation_id: invocationId,
      role,
      access: request.workspace.access,
      fresh_context: request.fresh_context,
      transport_status: result.transport_status,
    });
    return { request, result };
  }

  return { counts, events, run };
}

function trustedResolvers(dispatchStatuses, inertnessCalls) {
  return {
    resolveBehavioralInertness(request) {
      inertnessCalls.push(request.commit);
      return { ...request, decision: 'inert' };
    },
    resolveEvidence(request) {
      if (request.kind === 'approval') {
        return {
          bytes: APPROVAL_BYTES,
          provenance: {
            kind: 'approval',
            ref: request.ref,
            protected: true,
            decision: 'approved',
            plan_digest: request.plan_digest,
            authorizer_isolated: true,
            delivery_writable: false,
          },
        };
      }
      const status = dispatchStatuses.get(request.ref);
      if (!status) throw new Error(`unknown dispatch ${request.ref}`);
      return {
        bytes: DISPATCH_BYTES,
        provenance: {
          kind: 'verifier_dispatch',
          ref: request.ref,
          protected: true,
          role: 'verifier',
          fresh_context: true,
          read_only: true,
          invocation: status.verification.invocation,
          plan_digest: status.plan.digest,
          proof_digest: status.proof.digest,
          candidate_commit: status.proof.candidate_commit,
          product_tree: status.proof.product_tree,
          engine_controlled: true,
        },
      };
    },
  };
}

function currentRecords(repo, plan) {
  const snapshot = captureRefSnapshot(repo, plan);
  return {
    snapshot,
    records: readAuthoritativeRecordSnapshot(repo, plan, snapshot, {
      recordRootAdmission: testRecordPathAdmission(repo),
    }),
  };
}

function currentWorkStatus(repo, plan, workId) {
  const { records } = currentRecords(repo, plan);
  return selectAuthoritativeStatusFromSnapshot(plan, workId, records).status;
}

function currentAssemblyStatus(repo, plan) {
  const { records } = currentRecords(repo, plan);
  const selected = selectAssemblyFromSnapshot(plan, records);
  assert.notEqual(selected, null);
  return selected.status;
}

function verificationStatus(previous, outcome, identity) {
  const next = verified(previous, outcome);
  next.verification.invocation = `${identity}-verifier`;
  next.verification.attestation_ref = `dispatch://${identity}`;
  next.verification.attestation_digest = DIGESTS.f;
  return next;
}

function captainStatus(previous, outcome, identity) {
  const next = captainResult(previous, outcome);
  next.captain.invocation = `${identity}-captain`;
  return next;
}

function fetchLocal(running, path) {
  return new Promise((resolve, reject) => {
    const operation = httpRequest({
      hostname: running.host,
      port: running.port,
      path,
      method: 'GET',
      headers: {
        Connection: 'close',
        Host: `${running.host}:${running.port}`,
      },
      agent: false,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    operation.on('error', reject);
    operation.end();
  });
}

function createObserver(repo, running) {
  const checkpoints = [];
  let staticSurfaceChecked = false;

  return {
    checkpoints,
    async capture(label, inspect = () => {}) {
      const board = projectBoard(repo);
      assert.equal(board.valid, true);
      assert.equal(board.releases.length, 1);
      const directBytes = boardBytes(board);
      const terminal = renderTerminal(board, { color: 'never' });
      const response = await fetchLocal(running, '/api/board');
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(response.body, directBytes);
      assert.deepEqual(JSON.parse(response.body), board);
      assert.match(terminal, /Release v1\.0\.0/);

      if (!staticSurfaceChecked) {
        const [html, client, stylesheet] = await Promise.all([
          fetchLocal(running, '/'),
          fetchLocal(running, '/app.js'),
          fetchLocal(running, '/style.css'),
        ]);
        assert.equal(html.status, 200);
        assert.equal(client.status, 200);
        assert.equal(stylesheet.status, 200);
        assert.match(html.body.toString('utf8'), /<script src="\/app\.js" defer><\/script>/);
        assert.match(client.body.toString('utf8'), /fetch\('\/api\/board'/);
        assert.ok(stylesheet.body.byteLength > 0);
        staticSurfaceChecked = true;
      }

      inspect(board, terminal);
      const release = board.releases[0];
      checkpoints.push({
        label,
        release_status: release.status,
        board_digest: digestBytes(directBytes),
        terminal_digest: digestBytes(Buffer.from(terminal)),
        web_digest: digestBytes(response.body),
        next_operations: release.next_operations.map((operation) => (
          [
            operation.operation,
            operation.scope,
            operation.track ?? '-',
            operation.work ?? '-',
          ].join(':')
        )),
      });
      return { board, bytes: directBytes, terminal };
    },
  };
}

function releaseTrack(board, trackId) {
  const track = board.releases[0].tracks.find((candidate) => candidate.id === trackId);
  assert.notEqual(track, undefined);
  return track;
}

function workProjection(board, workId) {
  for (const track of board.releases[0].tracks) {
    const work = track.work.find((candidate) => candidate.id === workId);
    if (work) return work;
  }
  assert.fail(`missing work projection ${workId}`);
}

function createForeignNewerCopy(repo, plan, status) {
  const designBytes = Buffer.from('# Foreign W1 design\n');
  const designed = designReady(status, {
    digest: digestBytes(designBytes),
    producer: 'foreign-w1-design',
  });
  const ownerHead = resolveRef(repo, status.owner_ref);
  const prepared = unsafePrepareRecordTransition(repo, {
    expectedHead: ownerHead,
    message: 'Foreign newer W1 copy',
    recordPathAdmission: testRecordPathAdmission(repo),
    productExclusionAdmission: testProductExclusionAdmission(repo),
    changes: {
      [workDesignPath(plan, status.work_id)]: designBytes,
      [workStatusPath(plan, status.work_id)]: statusBytes(designed),
    },
  });
  const ref = 'refs/heads/foreign/v1.0.0/W1';
  git(repo, 'update-ref', ref, prepared.commit);
  return { ref, head: prepared.commit };
}

function switchToTrack(repo, plan, trackId) {
  const track = plan.metadata.tracks.find((candidate) => candidate.id === trackId);
  assert.notEqual(track, undefined);
  git(repo, 'switch', '-q', track.ref.replace('refs/heads/', ''));
  return track;
}

function returnToMain(repo) {
  git(repo, 'switch', '-q', 'main');
}

function createWorkDriver({
  repo,
  plan,
  actions,
  driver,
  dispatchStatuses,
  candidates,
}) {
  function recordDesign(workId, previous, revision) {
    driver.run('implementer', `${workId}-design-${revision}`, { status: previous });
    const bytes = Buffer.from(`# ${workId} design ${revision}\n`);
    const next = designReady(previous, {
      digest: digestBytes(bytes),
      producer: `${workId}-implementer-design-${revision}`,
    });
    const receipt = actions.recordTransition({
      scope: 'work',
      workId,
      result: 'DESIGN_WRITTEN',
      nextStatus: next,
      handoffs: { design: bytes },
    });
    assert.equal(receipt.changed, true);
    return { status: next, bytes, receipt };
  }

  function recordCaptain(workId, previous, outcome, round) {
    driver.run('captain', `${workId}-${outcome}-${round}`, {
      status: previous,
      designBytes: readFileAtStatus(repo, plan, previous, 'design'),
    });
    const next = captainStatus(previous, outcome, `${workId}-${outcome}-${round}`);
    const receipt = actions.recordTransition({
      scope: 'work',
      workId,
      result: outcome.toUpperCase(),
      nextStatus: next,
    });
    assert.equal(receipt.changed, true);
    return { status: next, receipt };
  }

  function implement(workId, previous, {
    attempt,
    product,
    baseCommit,
  }) {
    driver.run('implementer', `${workId}-implement-${attempt}`, { status: previous });
    const { track, work } = plan.metadata.tracks
      .flatMap((candidateTrack) => candidateTrack.work.map((candidateWork) => ({
        track: candidateTrack,
        work: candidateWork,
      })))
      .find(({ work: candidate }) => candidate.id === workId);
    switchToTrack(repo, plan, track.id);
    write(repo, work.scope.include[0], product);
    const candidate = commitProduct(repo, `Implement ${workId} ${attempt}`);
    returnToMain(repo);
    const identity = productTreeIdentity(
      repo,
      candidate,
      testProductExclusionAdmission(repo),
    );
    const proofBytes = Buffer.from(`# ${workId} proof ${attempt}\n`);
    const next = proofReady(previous, {
      digest: digestBytes(proofBytes),
      producer: `${workId}-implementer-${attempt}`,
      candidate,
      candidateTree: identity.candidateTree,
      productTree: identity.productTree,
    });
    next.proof.base_commit = baseCommit;
    const receipt = actions.recordTransition({
      scope: 'work',
      workId,
      result: 'IMPLEMENTED',
      nextStatus: next,
      handoffs: { proof: proofBytes },
    });
    assert.equal(receipt.changed, true);
    candidates[`${workId}:${attempt}`] = candidate;
    return { status: next, proofBytes, candidate, receipt };
  }

  function verify(workId, previous, proofBytes, outcome, round) {
    const execution = driver.run('verifier', `${workId}-${outcome}-${round}`, {
      status: previous,
      proofBytes,
    });
    assert.equal(execution.request.workspace.access, 'read_only');
    assert.equal(execution.request.fresh_context, true);
    const identity = `${workId}-${outcome}-${round}`;
    const next = verificationStatus(previous, outcome, identity);
    dispatchStatuses.set(next.verification.attestation_ref, clone(next));
    const receipt = actions.recordTransition({
      scope: 'work',
      workId,
      result: outcome.toUpperCase(),
      nextStatus: next,
    });
    assert.equal(receipt.changed, true);
    return { status: next, receipt, execution };
  }

  return {
    implement,
    recordCaptain,
    recordDesign,
    verify,
  };
}

function readFileAtStatus(repo, plan, status, field) {
  const relativePath = field === 'design'
    ? workDesignPath(plan, status.work_id)
    : status.kind === 'assembly'
      ? assemblyProofPath(plan)
      : workProofPath(plan, status.work_id);
  const authorityHead = resolveRef(repo, status.authority_ref);
  return readFileAtOID(repo, authorityHead, relativePath);
}

export async function runDogfood() {
  const started = performance.now();
  const fixture = temporaryRepository();
  const dispatchStatuses = new Map();
  const inertnessCalls = [];
  const candidates = {};
  let running = null;

  try {
    write(fixture.repo, 'README.md', 'Baton integrated dogfood product\n');
    const targetBase = commitRoot(fixture.repo, 'Baton dogfood base');
    const metadata = makePlanMetadata();
    const plan = parsePlanBytes(makePlanBytes(metadata));
    const driver = createDriver(fixture.repo, plan);
    const actions = createBatonActions({
      repo: fixture.repo,
      plan,
      profile: 'autonomous',
      ...trustedResolvers(dispatchStatuses, inertnessCalls),
    });
    assert.deepEqual(Object.keys(actions), [
      'installApprovedPlan',
      'reboundPristinePlan',
      'recordTransition',
      'materializeTrack',
      'composeTrack',
      'prepareAssembly',
      'integrateRelease',
    ]);
    assert.equal(Object.isFrozen(actions), true);

    driver.run('planner', 'approved-plan');
    const installed = actions.installApprovedPlan({ approvalDigest: DIGESTS.b });
    assert.equal(installed.changed, true);
    assert.equal(resolveRef(fixture.repo, plan.metadata.target_ref), targetBase);

    running = await startBoardServer({
      repo: fixture.repo,
      port: 0,
    });
    const observer = createObserver(fixture.repo, running);
    await observer.capture('approved', (board) => {
      assert.deepEqual(
        board.releases[0].next_operations.map((operation) => operation.track),
        ['T1', 'T2'],
      );
      assert.deepEqual(releaseTrack(board, 'T3').blockers, ['T1']);
    });

    driver.run('implementer', 'materialize-T1');
    const T1Materialized = actions.materializeTrack({ trackId: 'T1' });
    driver.run('implementer', 'materialize-T2');
    const T2Materialized = actions.materializeTrack({ trackId: 'T2' });
    const beforeDependencyFailure = repositoryCommitState(fixture.repo);
    expectCode(
      () => actions.materializeTrack({ trackId: 'T3' }),
      'UNMET_TRACK_DEPENDENCY',
    );
    assert.deepEqual(repositoryCommitState(fixture.repo), beforeDependencyFailure);

    const independent = await observer.capture('independent-materialized', (board) => {
      assert.equal(releaseTrack(board, 'T1').materialisation, 'owner');
      assert.equal(releaseTrack(board, 'T2').materialisation, 'owner');
      assert.equal(releaseTrack(board, 'T3').materialisation, 'baseline');
      assert.deepEqual(
        board.releases[0].next_operations.map((operation) => operation.track),
        ['T1', 'T2'],
      );
    });

    const initialW1 = currentWorkStatus(fixture.repo, plan, 'W1');
    const foreign = createForeignNewerCopy(fixture.repo, plan, initialW1);
    const foreignObserved = await observer.capture('foreign-copy-ignored');
    assert.deepEqual(foreignObserved.bytes, independent.bytes);
    assert.notEqual(foreign.head, initialW1.materialization.base_commit);

    const work = createWorkDriver({
      repo: fixture.repo,
      plan,
      actions,
      driver,
      dispatchStatuses,
      candidates,
    });

    let W1 = work.recordDesign('W1', initialW1, 1);
    await observer.capture('w1-captain-review', (board) => {
      assert.equal(workProjection(board, 'W1').next_role, 'captain');
      assert.equal(workProjection(board, 'W2').next_operation, null);
    });
    W1 = {
      ...W1,
      ...work.recordCaptain('W1', W1.status, 'revise', 1),
    };
    await observer.capture('w1-revise', (board) => {
      assert.equal(workProjection(board, 'W1').outcome, 'revise');
      assert.equal(workProjection(board, 'W1').next_role, 'implementer');
    });
    W1 = work.recordDesign('W1', W1.status, 2);
    W1 = {
      ...W1,
      ...work.recordCaptain('W1', W1.status, 'proceed', 2),
    };

    let W3 = work.recordDesign(
      'W3',
      currentWorkStatus(fixture.repo, plan, 'W3'),
      1,
    );
    W3 = {
      ...W3,
      ...work.recordCaptain('W3', W3.status, 'proceed', 1),
    };
    W3 = work.implement('W3', W3.status, {
      attempt: 1,
      product: 'W3 delivered independently\n',
      baseCommit: T2Materialized.base_commit,
    });
    W3 = work.verify('W3', W3.status, W3.proofBytes, 'pass', 1);
    await observer.capture('independent-progress', (board) => {
      assert.equal(workProjection(board, 'W1').next_role, 'implementer');
      assert.equal(workProjection(board, 'W3').outcome, 'pass');
      assert.equal(releaseTrack(board, 'T1').materialisation, 'owner');
      assert.equal(releaseTrack(board, 'T2').materialisation, 'owner');
    });

    W1 = work.implement('W1', W1.status, {
      attempt: 1,
      product: 'W1 delivered after revised design\n',
      baseCommit: T1Materialized.base_commit,
    });
    const beforeOperationalFailure = repositoryCommitState(fixture.repo);
    const boardBeforeOperationalFailure = boardBytes(projectBoard(fixture.repo));
    const operational = driver.run('verifier', 'W1-transport-failure', {
      profile: 'transport_error',
      status: W1.status,
      proofBytes: W1.proofBytes,
    });
    const noVerdict = actions.recordTransition({
      scope: 'work',
      workId: 'W1',
      result: 'NO_VERDICT',
      nextStatus: clone(W1.status),
    });
    assert.equal(noVerdict.changed, false);
    assert.equal(operational.result.transport_status, 'transport_error');
    assert.deepEqual(repositoryCommitState(fixture.repo), beforeOperationalFailure);
    assert.deepEqual(boardBytes(projectBoard(fixture.repo)), boardBeforeOperationalFailure);
    await observer.capture('operational-failure-unchanged', (board) => {
      assert.equal(workProjection(board, 'W1').next_role, 'verifier');
      assert.equal(workProjection(board, 'W1').outcome, 'none');
    });

    W1 = work.verify('W1', W1.status, W1.proofBytes, 'pass', 1);
    await observer.capture('w1-pass-w2-ready', (board) => {
      assert.equal(workProjection(board, 'W1').outcome, 'pass');
      assert.equal(workProjection(board, 'W2').next_role, 'implementer');
      assert.equal(workProjection(board, 'W2').next_operation.work, 'W2');
    });

    let W2 = work.recordDesign(
      'W2',
      currentWorkStatus(fixture.repo, plan, 'W2'),
      1,
    );
    W2 = {
      ...W2,
      ...work.recordCaptain('W2', W2.status, 'proceed', 1),
    };
    W2 = work.implement('W2', W2.status, {
      attempt: 1,
      product: 'W2 first implementation\n',
      baseCommit: W1.status.proof.candidate_commit,
    });
    W2 = work.verify('W2', W2.status, W2.proofBytes, 'fail', 1);
    await observer.capture('w2-verifier-fail', (board) => {
      assert.equal(workProjection(board, 'W2').outcome, 'fail');
      assert.equal(workProjection(board, 'W2').next_role, 'implementer');
    });
    W2 = work.implement('W2', W2.status, {
      attempt: 2,
      product: 'W2 repaired implementation\n',
      baseCommit: W1.status.proof.candidate_commit,
    });
    W2 = work.verify('W2', W2.status, W2.proofBytes, 'pass', 2);
    await observer.capture('w2-repair-pass', (board) => {
      assert.equal(workProjection(board, 'W2').outcome, 'pass');
      assert.equal(releaseTrack(board, 'T1').next_operation.operation, 'baton-merge');
    });

    driver.run('merge', 'compose-T1', { status: W2.status, proofBytes: W2.proofBytes });
    const T1Composed = actions.composeTrack({ trackId: 'T1' });
    assert.equal(T1Composed.changed, true);
    await observer.capture('t1-composed-dependency-ready', (board) => {
      assert.equal(releaseTrack(board, 'T1').composition, 'composed');
      assert.deepEqual(releaseTrack(board, 'T3').blockers, []);
      assert.equal(releaseTrack(board, 'T3').next_operation.work, 'W4');
    });

    driver.run('implementer', 'materialize-T3');
    const T3Materialized = actions.materializeTrack({ trackId: 'T3' });
    assert.deepEqual(
      currentWorkStatus(fixture.repo, plan, 'W4').materialization.dependencies,
      [{ track_id: 'T1', frozen_head: T1Composed.frozen_track_head }],
    );
    await observer.capture('t3-materialized', (board) => {
      assert.equal(releaseTrack(board, 'T3').materialisation, 'owner');
      assert.equal(workProjection(board, 'W4').source.mode, 'owner');
    });

    driver.run('merge', 'compose-T2', { status: W3.status, proofBytes: W3.proofBytes });
    const T2Composed = actions.composeTrack({ trackId: 'T2' });
    assert.equal(T2Composed.changed, true);
    await observer.capture('t2-composed', (board) => {
      assert.equal(releaseTrack(board, 'T2').composition, 'composed');
      assert.equal(releaseTrack(board, 'T3').materialisation, 'owner');
    });

    let W4 = work.recordDesign(
      'W4',
      currentWorkStatus(fixture.repo, plan, 'W4'),
      1,
    );
    W4 = {
      ...W4,
      ...work.recordCaptain('W4', W4.status, 'proceed', 1),
    };
    W4 = work.implement('W4', W4.status, {
      attempt: 1,
      product: 'W4 delivered after T1 composition\n',
      baseCommit: T3Materialized.base_commit,
    });
    W4 = work.verify('W4', W4.status, W4.proofBytes, 'pass', 1);
    driver.run('merge', 'compose-T3', { status: W4.status, proofBytes: W4.proofBytes });
    const T3Composed = actions.composeTrack({ trackId: 'T3' });
    assert.equal(T3Composed.changed, true);
    await observer.capture('all-tracks-composed', (board) => {
      assert.equal(board.releases[0].status, 'assembly_ready');
      assert.equal(board.releases[0].assembly.next_operation.operation, 'baton-merge');
      assert.equal(board.releases[0].assembly.next_operation.scope, 'assembly');
      assert.equal(board.releases[0].tracks.every((track) => track.composition === 'composed'), true);
    });

    const assemblyProofBytes = Buffer.from(
      '# Assembly proof\n\nAll three exact track heads pass together.\n',
    );
    driver.run('merge', 'prepare-assembly');
    const assemblyPrepared = actions.prepareAssembly({
      proofBytes: assemblyProofBytes,
      producerInvocation: 'dogfood-merge-assembly',
    });
    assert.equal(assemblyPrepared.changed, true);
    await observer.capture('assembly-prepared', (board) => {
      assert.equal(board.releases[0].status, 'assembly');
      assert.equal(board.releases[0].assembly.next_role, 'verifier');
      assert.equal(board.releases[0].assembly.next_operation.operation, 'baton-verify');
    });

    const assembly = currentAssemblyStatus(fixture.repo, plan);
    const assemblyExecution = driver.run('verifier', 'assembly-pass', {
      status: assembly,
      proofBytes: assemblyProofBytes,
    });
    assert.equal(assemblyExecution.request.workspace.access, 'read_only');
    assert.equal(assemblyExecution.request.fresh_context, true);
    const passedAssembly = verificationStatus(assembly, 'pass', 'assembly-pass');
    dispatchStatuses.set(
      passedAssembly.verification.attestation_ref,
      clone(passedAssembly),
    );
    const assemblyPassReceipt = actions.recordTransition({
      scope: 'assembly',
      result: 'PASS',
      nextStatus: passedAssembly,
    });
    assert.equal(assemblyPassReceipt.changed, true);
    await observer.capture('assembly-pass', (board) => {
      assert.equal(board.releases[0].status, 'merge_ready');
      assert.equal(board.releases[0].assembly.outcome, 'pass');
      assert.equal(board.releases[0].assembly.next_operation.operation, 'baton-merge');
    });

    driver.run('merge', 'integrate-release', {
      status: passedAssembly,
      proofBytes: assemblyProofBytes,
    });
    const integrated = actions.integrateRelease();
    assert.equal(integrated.changed, true);
    assert.equal(integrated.before.target.head, targetBase);
    assert.equal(integrated.after.target.head, integrated.integration_commit);
    assert.equal(resolveRef(fixture.repo, plan.metadata.target_ref), integrated.integration_commit);
    const final = await observer.capture('release-complete', (board, terminal) => {
      assert.equal(board.releases[0].status, 'complete');
      assert.equal(board.releases[0].assembly.status, 'complete');
      assert.deepEqual(board.releases[0].next_operations, []);
      assert.match(terminal, /complete/);
    });

    const frozenHeads = {
      T1: T1Composed.frozen_track_head,
      T2: T2Composed.frozen_track_head,
      T3: T3Composed.frozen_track_head,
    };
    assert.equal(new Set(Object.values(frozenHeads)).size, 3);
    assert.deepEqual(
      passedAssembly.proof.components,
      plan.metadata.tracks.map((track) => ({
        track_id: track.id,
        head: frozenHeads[track.id],
      })),
    );
    assert.equal(driver.events.filter((event) => event.role === 'verifier')
      .every((event) => event.access === 'read_only' && event.fresh_context), true);

    return {
      schema_version: 'baton.dogfood-result/v1',
      package_version: GENERATED_MANIFEST.package_version,
      plan_digest: plan.digest,
      package_digest: GENERATED_MANIFEST.package_digest,
      commits: {
        target_base: targetBase,
        approved: installed.release_head,
        materialised: {
          T1: T1Materialized.owner_head,
          T2: T2Materialized.owner_head,
          T3: T3Materialized.owner_head,
        },
        frozen: frozenHeads,
        assembled_candidate: assemblyPrepared.assembly_candidate,
        assembly_preparation: assemblyPrepared.preparation_commit,
        assembly_pass: assemblyPassReceipt.commit,
        target: integrated.integration_commit,
        terminal_status: integrated.status_commit,
      },
      board_projection_digest: digestBytes(final.bytes),
      responsibility_invocations: { ...driver.counts },
      wall_time_ms: Math.round(performance.now() - started),
      observations: {
        independent_tracks: ['T1', 'T2'],
        dependency_gate: 'UNMET_TRACK_DEPENDENCY',
        captain_revise: true,
        verifier_fail_repair_pass: true,
        operational_failure: {
          transport_status: operational.result.transport_status,
          durable_status_changed: false,
          refs_or_commit_objects_changed: false,
        },
        foreign_newer_copy_ignored: foreign.head,
        assembly_verifier: {
          access: assemblyExecution.request.workspace.access,
          fresh_context: assemblyExecution.request.fresh_context,
        },
        exact_track_compositions: 3,
        exact_target_compare_and_set: integrated.before.target.head === targetBase,
      },
      checkpoints: observer.checkpoints,
      product_candidates: candidates,
      behavioral_inertness_checks: new Set(inertnessCalls).size,
    };
  } finally {
    if (running) await running.close();
    fixture.cleanup();
  }
}

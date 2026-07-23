import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const APPROVAL_BYTES = Buffer.from('Baton test approval\n');
export const DISPATCH_BYTES = Buffer.from('Baton test Verifier dispatch\n');

const testDigests = Object.fromEntries('abcdefghijklmnop'.split('').map((letter, index) => [
    letter,
    `sha256:${(index + 1).toString(16).padStart(64, '0')}`,
  ]));
testDigests.b = `sha256:${createHash('sha256').update(APPROVAL_BYTES).digest('hex')}`;
testDigests.f = `sha256:${createHash('sha256').update(DISPATCH_BYTES).digest('hex')}`;
export const DIGESTS = Object.freeze(testDigests);

export const OIDS = Object.freeze(
  Object.fromEntries('abcdef0123456789'.split('').map((letter) => [
    letter,
    letter.repeat(40),
  ])),
);

export function clone(value) {
  return structuredClone(value);
}

export function makePlanMetadata() {
  const work = (id, include, dependsOn = []) => ({
    id,
    outcome: `Deliver ${id}`,
    scope: { include: [include], exclude: [] },
    acceptance: [{ id: `${id}-A1`, text: `${id} is demonstrably complete.` }],
    checks: ['node --test'],
    constraints: ['Keep the record root inert.'],
    depends_on: dependsOn,
  });
  return {
    schema_version: 'baton.plan/v1',
    release: 'v1.0.0',
    repository: 'example/baton',
    target_ref: 'refs/heads/main',
    release_ref: 'refs/heads/release-wt/v1.0.0',
    record_root: '.baton/releases',
    approval_ref: 'approval://v1.0.0/1',
    tracks: [
      {
        id: 'T1',
        ref: 'refs/heads/track/v1.0.0/T1',
        depends_on: [],
        touch_surfaces: ['src/alpha'],
        work: [
          work('W1', 'src/alpha/one.mjs'),
          work('W2', 'src/alpha/two.mjs', ['W1']),
        ],
      },
      {
        id: 'T2',
        ref: 'refs/heads/track/v1.0.0/T2',
        depends_on: [],
        touch_surfaces: ['src/beta'],
        work: [work('W3', 'src/beta/one.mjs')],
      },
      {
        id: 'T3',
        ref: 'refs/heads/track/v1.0.0/T3',
        depends_on: ['T1'],
        touch_surfaces: ['src/gamma'],
        work: [work('W4', 'src/gamma/one.mjs', ['W2'])],
      },
    ],
  };
}

export function makePlanBytes(metadata = makePlanMetadata()) {
  return Buffer.from(
    `\`\`\`baton-plan-v1\n${JSON.stringify(metadata)}\n\`\`\`\n\n# Release ${metadata.release}\n`,
  );
}

export function initialWorkStatus({
  workId = 'W1',
  trackId = 'T1',
  authority = `refs/heads/track/v1.0.0/${trackId}`,
  materialization = {
    base_commit: OIDS.a,
    dependencies: [],
  },
} = {}) {
  const result = {
    $schema: 'https://baton.sawy3r.net/schemas/work-status-v1.json',
    schema_version: 'baton.work-status/v1',
    kind: 'work',
    release: 'v1.0.0',
    work_id: workId,
    track_id: trackId,
    owner_ref: `refs/heads/track/v1.0.0/${trackId}`,
    authority_ref: authority,
    target_ref: 'refs/heads/main',
    plan: {
      digest: DIGESTS.a,
      approval: { ref: 'approval://v1.0.0/1', digest: DIGESTS.b },
    },
    stage: 'design',
    status: 'ready',
    next_role: 'implementer',
    outcome: 'none',
  };
  if (authority === result.owner_ref) result.materialization = clone(materialization);
  return result;
}

export function designReady(previous = initialWorkStatus(), {
  digest = DIGESTS.c,
  producer = 'implementer-design-1',
} = {}) {
  const result = clone(previous);
  result.stage = 'design';
  result.status = 'ready';
  result.next_role = 'captain';
  result.outcome = 'none';
  result.design = { digest, producer_invocation: producer };
  delete result.captain;
  delete result.blocker;
  return result;
}

export function captainResult(previous = designReady(), outcome = 'proceed') {
  const result = clone(previous);
  result.captain = {
    outcome,
    invocation: `captain-${outcome}-1`,
    plan_digest: result.plan.digest,
    design_digest: result.design.digest,
  };
  result.outcome = outcome;
  if (outcome === 'proceed') {
    result.stage = 'implement';
    result.status = 'ready';
    result.next_role = 'implementer';
  } else if (outcome === 'revise') {
    result.stage = 'design';
    result.status = 'ready';
    result.next_role = 'implementer';
  } else {
    result.stage = 'design';
    result.status = 'blocked';
    result.next_role = 'planner';
    result.blocker = { code: 'captain_escalation', summary: 'The approved contract needs a decision.' };
  }
  return result;
}

export function proofReady(previous = captainResult(), {
  digest = DIGESTS.d,
  producer = 'implementer-code-1',
  candidate = OIDS.b,
  candidateTree = OIDS.c,
  productTree = DIGESTS.e,
} = {}) {
  const result = clone(previous);
  result.stage = 'verify';
  result.status = 'ready';
  result.next_role = 'verifier';
  result.outcome = 'none';
  result.proof = {
    digest,
    producer_invocation: producer,
    repository: 'example/baton',
    base_commit: OIDS.a,
    candidate_commit: candidate,
    candidate_tree: candidateTree,
    product_tree: productTree,
    plan_digest: result.plan.digest,
    approval_digest: result.plan.approval.digest,
    design_digest: result.design.digest,
    captain_invocation: result.captain.invocation,
    components: [],
  };
  delete result.verification;
  delete result.merge;
  delete result.blocker;
  return result;
}

export function verified(previous = proofReady(), outcome = 'pass') {
  const result = clone(previous);
  result.verification = {
    outcome,
    invocation: `verifier-${outcome}-1`,
    attestation_ref: `dispatch://verifier-${outcome}-1`,
    attestation_digest: DIGESTS.f,
    plan_digest: result.plan.digest,
    proof_digest: result.proof.digest,
    candidate_commit: result.proof.candidate_commit,
    product_tree: result.proof.product_tree,
  };
  result.outcome = outcome;
  if (outcome === 'pass') {
    result.stage = 'merge';
    result.status = 'ready';
    result.next_role = 'merge';
  } else if (outcome === 'fail') {
    result.stage = result.kind === 'assembly' ? 'verify' : 'implement';
    result.status = 'ready';
    result.next_role = result.kind === 'assembly' ? 'planner' : 'implementer';
  } else {
    result.stage = 'verify';
    result.status = 'blocked';
    result.next_role = 'planner';
    result.blocker = { code: 'external_block', summary: 'Verification requires an external decision.' };
  }
  return result;
}

export function mergedWork(previous = verified()) {
  const result = clone(previous);
  result.authority_ref = `refs/heads/release-wt/${result.release}`;
  result.stage = 'merge';
  result.status = 'complete';
  result.next_role = 'none';
  result.outcome = 'merged';
  result.merge = {
    scope: 'track',
    passed_candidate: result.proof.candidate_commit,
    frozen_track_head: OIDS.d,
    expected_target: OIDS.e,
    outcome: 'merged',
    observed_target: OIDS.e,
    result_commit: OIDS.f,
    plan_digest: result.plan.digest,
    verification_attestation_digest: result.verification.attestation_digest,
  };
  return result;
}

export function initialAssemblyStatus() {
  return {
    $schema: 'https://baton.sawy3r.net/schemas/work-status-v1.json',
    schema_version: 'baton.work-status/v1',
    kind: 'assembly',
    release: 'v1.0.0',
    owner_ref: 'refs/heads/release-wt/v1.0.0',
    authority_ref: 'refs/heads/release-wt/v1.0.0',
    target_ref: 'refs/heads/main',
    plan: {
      digest: DIGESTS.a,
      approval: { ref: 'approval://v1.0.0/1', digest: DIGESTS.b },
    },
    stage: 'verify',
    status: 'ready',
    next_role: 'verifier',
    outcome: 'none',
    proof: {
      digest: DIGESTS.g,
      producer_invocation: 'merge-assembly-1',
      repository: 'example/baton',
      base_commit: OIDS.d,
      candidate_commit: OIDS.e,
      candidate_tree: OIDS.f,
      product_tree: DIGESTS.h,
      plan_digest: DIGESTS.a,
      approval_digest: DIGESTS.b,
      components: [
        { track_id: 'T1', head: OIDS.b },
        { track_id: 'T2', head: OIDS.c },
      ],
    },
  };
}

export function mergedAssembly(previous = verified(initialAssemblyStatus())) {
  const result = clone(previous);
  result.stage = 'merge';
  result.status = 'complete';
  result.next_role = 'none';
  result.outcome = 'merged';
  result.merge = {
    scope: 'release',
    passed_candidate: result.proof.candidate_commit,
    expected_target: OIDS.a,
    outcome: 'merged',
    observed_target: OIDS.a,
    result_commit: OIDS.e,
    plan_digest: result.plan.digest,
    verification_attestation_digest: result.verification.attestation_digest,
  };
  return result;
}

export function git(repo, ...args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function temporaryRepository() {
  const repo = mkdtempSync(path.join(tmpdir(), 'baton-record-test-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Baton Test');
  git(repo, 'config', 'user.email', 'baton-test@example.invalid');
  return {
    repo,
    cleanup() {
      rmSync(repo, { recursive: true, force: true });
    },
  };
}

export function write(repo, relativePath, value) {
  const absolute = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, value);
}

export function read(repo, relativePath) {
  return readFileSync(path.join(repo, relativePath));
}

export function commitAll(repo, message) {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

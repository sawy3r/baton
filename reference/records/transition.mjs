import { isDeepStrictEqual } from 'node:util';

import {
  RecordError,
  assemblyStatusPath,
  assertTrackReadyForComposition,
  parseStatusBytes,
  validateAssemblyStatus,
  validateProofGitIdentity,
  validateStatusHandoffsAtRef,
  validateStatusSemantics,
  workStatusPath,
} from './records.mjs';
import {
  assertRecordOnlyTransition,
  commitParents,
  isAncestor,
  readFileAtRef,
  resolveRef,
  verifyTrackComposition,
  verifyReleaseIntegration,
} from './git.mjs';

export const TRANSITION_RESULTS = Object.freeze([
  'DESIGN_WRITTEN',
  'PROCEED',
  'REVISE',
  'ESCALATE',
  'IMPLEMENTED',
  'PASS',
  'FAIL',
  'BLOCKED',
  'MERGED',
  'MATERIALIZE',
  'REBOUND',
  'NO_VERDICT',
]);

export class TransitionError extends RecordError {
  constructor(code, message) {
    super(code, message);
    this.name = 'TransitionError';
  }
}

function fail(code, message) {
  throw new TransitionError(code, message);
}

function projection(status) {
  return `${status.stage}/${status.status}/${status.next_role}`;
}

function same(left, right, label) {
  if (!isDeepStrictEqual(left, right)) {
    fail('IMMUTABLE_BINDING_CHANGED', `${label} changed across the transition`);
  }
}

function different(left, right, label) {
  if (isDeepStrictEqual(left, right)) {
    fail('EVIDENCE_NOT_REFRESHED', `${label} must change across the transition`);
  }
}

function absent(status, fields, label) {
  for (const field of fields) {
    if (Object.hasOwn(status, field)) {
      fail('UNEXPECTED_TRANSITION_FIELD', `${label} cannot retain ${field}`);
    }
  }
}

function requireProjection(status, expected, label) {
  const observed = projection(status);
  if (observed !== expected) {
    fail('INVALID_TRANSITION', `${label} must be ${expected}, observed ${observed}`);
  }
}

function assertIdentity(previous, next, { allowAuthority = false, allowTarget = false } = {}) {
  const fields = ['$schema', 'schema_version', 'kind', 'release', 'work_id', 'track_id', 'owner_ref'];
  if (!allowAuthority) fields.push('authority_ref');
  if (!allowTarget) fields.push('target_ref');
  for (const field of fields) same(previous[field], next[field], `status.${field}`);
}

function assertNormalBindings(previous, next, options = {}) {
  assertIdentity(previous, next, options);
  same(previous.plan, next.plan, 'status.plan');
}

function assertPreviousGatesPreserved(previous, next, fields) {
  for (const field of fields) same(previous[field], next[field], `status.${field}`);
}

function validateDesignWritten(previous, next) {
  if (previous.kind !== 'work') fail('INVALID_TRANSITION', 'only work has a design gate');
  requireProjection(previous, 'design/ready/implementer', 'DESIGN_WRITTEN source');
  requireProjection(next, 'design/ready/captain', 'DESIGN_WRITTEN result');
  assertNormalBindings(previous, next);
  if (previous.outcome === 'none') {
    absent(previous, ['design', 'captain'], 'initial design source');
  } else if (previous.outcome === 'revise') {
    if (previous.captain?.outcome !== 'revise') {
      fail('INVALID_TRANSITION', 'a repeated design must follow Captain REVISE');
    }
    different(previous.design?.digest, next.design?.digest, 'design digest after REVISE');
    different(
      previous.design?.producer_invocation,
      next.design?.producer_invocation,
      'design producer invocation after REVISE',
    );
  } else {
    fail('INVALID_TRANSITION', 'DESIGN_WRITTEN source has an invalid outcome');
  }
  if (next.outcome !== 'none') fail('INVALID_TRANSITION', 'DESIGN_WRITTEN clears the prior outcome');
  absent(next, ['captain', 'proof', 'verification', 'merge', 'blocker'], 'DESIGN_WRITTEN result');
}

function validateCaptain(previous, next, result) {
  if (previous.kind !== 'work') fail('INVALID_TRANSITION', 'only work has a Captain gate');
  requireProjection(previous, 'design/ready/captain', `${result} source`);
  assertNormalBindings(previous, next);
  same(previous.design, next.design, 'status.design');
  absent(previous, ['captain', 'proof', 'verification', 'merge', 'blocker'], `${result} source`);
  if (next.captain?.outcome !== result.toLowerCase()) {
    fail('INVALID_TRANSITION', `${result} requires a matching Captain outcome`);
  }
  if (result === 'PROCEED') {
    requireProjection(next, 'implement/ready/implementer', 'PROCEED result');
    if (next.outcome !== 'proceed') fail('INVALID_TRANSITION', 'PROCEED result must persist outcome proceed');
    absent(next, ['proof', 'verification', 'merge', 'blocker'], 'PROCEED result');
  } else if (result === 'REVISE') {
    requireProjection(next, 'design/ready/implementer', 'REVISE result');
    if (next.outcome !== 'revise') fail('INVALID_TRANSITION', 'REVISE result must persist outcome revise');
    absent(next, ['proof', 'verification', 'merge', 'blocker'], 'REVISE result');
  } else {
    requireProjection(next, 'design/blocked/planner', 'ESCALATE result');
    if (next.outcome !== 'escalate') fail('INVALID_TRANSITION', 'ESCALATE result must persist outcome escalate');
    absent(next, ['proof', 'verification', 'merge'], 'ESCALATE result');
  }
}

function validateImplemented(previous, next) {
  if (previous.kind !== 'work') fail('INVALID_TRANSITION', 'IMPLEMENTED applies only to work');
  requireProjection(previous, 'implement/ready/implementer', 'IMPLEMENTED source');
  requireProjection(next, 'verify/ready/verifier', 'IMPLEMENTED result');
  assertNormalBindings(previous, next);
  assertPreviousGatesPreserved(previous, next, ['design', 'captain']);
  if (previous.captain?.outcome !== 'proceed') {
    fail('INVALID_TRANSITION', 'IMPLEMENTED requires a current Captain PROCEED');
  }
  if (previous.outcome === 'proceed') {
    absent(previous, ['proof', 'verification', 'merge', 'blocker'], 'first implementation source');
  } else if (previous.outcome === 'fail') {
    if (previous.verification?.outcome !== 'fail') {
      fail('INVALID_TRANSITION', 'repair must follow Verifier FAIL');
    }
    different(previous.proof?.digest, next.proof?.digest, 'proof digest after FAIL');
    different(previous.proof?.producer_invocation, next.proof?.producer_invocation, 'proof producer after FAIL');
  } else {
    fail('INVALID_TRANSITION', 'IMPLEMENTED source must follow PROCEED or FAIL');
  }
  if (next.outcome !== 'none') fail('INVALID_TRANSITION', 'IMPLEMENTED result must clear the prior outcome');
  absent(next, ['verification', 'merge', 'blocker'], 'IMPLEMENTED result');
}

function validateVerification(previous, next, result) {
  requireProjection(previous, 'verify/ready/verifier', `${result} source`);
  assertNormalBindings(previous, next);
  assertPreviousGatesPreserved(previous, next, ['design', 'captain', 'proof']);
  absent(previous, ['verification', 'merge', 'blocker'], `${result} source`);
  if (next.verification?.outcome !== result.toLowerCase()) {
    fail('INVALID_TRANSITION', `${result} requires a matching Verifier outcome`);
  }
  if (result === 'PASS') {
    requireProjection(next, 'merge/ready/merge', 'PASS result');
    if (next.outcome !== 'pass') fail('INVALID_TRANSITION', 'PASS result must persist outcome pass');
    absent(next, ['merge', 'blocker'], 'PASS result');
    return;
  }
  if (result === 'FAIL') {
    if (previous.kind !== 'work') {
      fail('INVALID_TRANSITION', 'assembly FAIL does not invent an implementation owner');
    }
    requireProjection(next, 'implement/ready/implementer', 'FAIL result');
    if (next.outcome !== 'fail') fail('INVALID_TRANSITION', 'FAIL result must persist outcome fail');
    absent(next, ['merge', 'blocker'], 'FAIL result');
    return;
  }
  requireProjection(next, 'verify/blocked/planner', 'BLOCKED result');
  if (next.outcome !== 'blocked') fail('INVALID_TRANSITION', 'BLOCKED result must persist outcome blocked');
  absent(next, ['merge'], 'BLOCKED result');
}

function validateMerged(previous, next) {
  requireProjection(previous, 'merge/ready/merge', 'MERGED source');
  requireProjection(next, 'merge/complete/none', 'MERGED result');
  assertNormalBindings(previous, next, { allowAuthority: previous.kind === 'work' });
  assertPreviousGatesPreserved(previous, next, ['design', 'captain', 'proof', 'verification']);
  absent(previous, ['merge', 'blocker'], 'MERGED source');
  if (next.outcome !== 'merged' || next.merge?.outcome !== 'merged') {
    fail('INVALID_TRANSITION', 'MERGED result must contain the deterministic Merge binding');
  }
  const releaseRef = `refs/heads/release-wt/${previous.release}`;
  if (previous.kind === 'work') {
    if (previous.authority_ref !== previous.owner_ref || next.authority_ref !== releaseRef) {
      fail('INVALID_AUTHORITY_TRANSFER', 'work Merge transfers authority from its track to release-wt');
    }
  } else if (next.authority_ref !== releaseRef) {
    fail('INVALID_AUTHORITY_TRANSFER', 'assembly authority remains release-wt');
  }
}

function validateMaterialize(previous, next) {
  if (previous.kind !== 'work' || next.kind !== 'work') {
    fail('INVALID_TRANSITION', 'MATERIALIZE applies only to planned work');
  }
  if (previous.stage === 'merge' && previous.status === 'complete') {
    fail('TERMINAL_REWRITE', 'terminal work cannot be materialised');
  }
  assertIdentity(previous, next, { allowAuthority: true });
  const releaseRef = `refs/heads/release-wt/${previous.release}`;
  if (previous.authority_ref !== releaseRef || next.authority_ref !== previous.owner_ref) {
    fail('INVALID_AUTHORITY_TRANSFER', 'MATERIALIZE transfers release baseline authority to the exact owner ref');
  }
  const previousWithoutAuthority = { ...previous };
  const nextWithoutAuthority = { ...next };
  delete previousWithoutAuthority.authority_ref;
  delete nextWithoutAuthority.authority_ref;
  same(previousWithoutAuthority, nextWithoutAuthority, 'materialised durable projection');
}

function validateRebound(previous, next) {
  if (previous.kind !== 'work' || next.kind !== 'work') {
    fail('INVALID_TRANSITION', 'REBOUND applies only to non-terminal work');
  }
  if (previous.stage === 'merge' && previous.status === 'complete') {
    fail('TERMINAL_REWRITE', 'terminal work cannot be rebound');
  }
  assertIdentity(previous, next, { allowTarget: true });
  if (isDeepStrictEqual(previous.plan, next.plan)) {
    fail('REPLAN_NOT_CHANGED', 'REBOUND requires a new plan or approval binding');
  }
  requireProjection(next, 'design/ready/implementer', 'REBOUND result');
  if (next.outcome !== 'none') fail('INVALID_TRANSITION', 'REBOUND resets the durable outcome');
  absent(
    next,
    ['blocker', 'design', 'captain', 'proof', 'verification', 'merge'],
    'REBOUND result',
  );
}

export function validateTransition(previous, next, result) {
  if (!TRANSITION_RESULTS.includes(result)) {
    fail('UNKNOWN_TRANSITION_RESULT', `unknown responsibility result ${String(result)}`);
  }
  validateStatusSemantics(previous);
  validateStatusSemantics(next);

  if (previous.stage === 'merge' && previous.status === 'complete') {
    if (result === 'NO_VERDICT' && isDeepStrictEqual(previous, next)) return next;
    fail('TERMINAL_REWRITE', 'terminal status identity and outcome are write-once');
  }

  if (result === 'NO_VERDICT') {
    same(previous, next, 'durable status after runner failure');
    return next;
  }
  if (result === 'MATERIALIZE') {
    validateMaterialize(previous, next);
    return next;
  }
  if (result === 'REBOUND') {
    validateRebound(previous, next);
    return next;
  }
  if (result === 'DESIGN_WRITTEN') {
    validateDesignWritten(previous, next);
    return next;
  }
  if (['PROCEED', 'REVISE', 'ESCALATE'].includes(result)) {
    validateCaptain(previous, next, result);
    return next;
  }
  if (result === 'IMPLEMENTED') {
    validateImplemented(previous, next);
    return next;
  }
  if (['PASS', 'FAIL', 'BLOCKED'].includes(result)) {
    validateVerification(previous, next, result);
    return next;
  }
  validateMerged(previous, next);
  return next;
}

function statusFor(statuses, workId) {
  return statuses instanceof Map ? statuses.get(workId) : statuses[workId];
}

export function validateTrackCompositionTransition(
  repo,
  plan,
  trackId,
  previousStatuses,
  nextStatuses,
) {
  const track = assertTrackReadyForComposition(plan, previousStatuses, trackId);
  const frozenTrackHead = resolveRef(repo, track.ref);
  let previousCandidate;
  let sharedMerge;
  const transferPaths = [];

  for (const [index, work] of track.work.entries()) {
    const previous = statusFor(previousStatuses, work.id);
    const next = statusFor(nextStatuses, work.id);
    if (!next) fail('AUTHORITATIVE_STATUS_MISSING', `missing transferred status for ${work.id}`);

    const recordedOwner = parseStatusBytes(
      readFileAtRef(repo, frozenTrackHead, workStatusPath(plan, work.id)),
      { planDigest: plan.digest },
    );
    same(recordedOwner, previous, `frozen owner status for ${work.id}`);
    validateStatusHandoffsAtRef(repo, plan, previous, frozenTrackHead);
    validateProofGitIdentity(repo, previous, plan.metadata.record_root, {
      repository: plan.metadata.repository,
      authorityHead: frozenTrackHead,
      requireCurrentProduct: index === track.work.length - 1,
    });
    if (
      previousCandidate
      && !isAncestor(repo, previousCandidate, previous.proof.candidate_commit)
    ) {
      fail('NON_SERIAL_CANDIDATE', `work ${work.id} candidate does not descend from prior passed work`);
    }
    previousCandidate = previous.proof.candidate_commit;

    validateTransition(previous, next, 'MERGED');
    if (next.merge.frozen_track_head !== frozenTrackHead) {
      fail('STALE_BINDING', `work ${work.id} does not bind the exact frozen track head`);
    }
    const binding = {
      expected_target: next.merge.expected_target,
      observed_target: next.merge.observed_target,
      result_commit: next.merge.result_commit,
      frozen_track_head: next.merge.frozen_track_head,
    };
    if (binding.expected_target !== binding.observed_target) {
      fail('MOVED_TARGET', `work ${work.id} observed a target other than its expected head`);
    }
    if (sharedMerge === undefined) sharedMerge = binding;
    else same(sharedMerge, binding, `shared track Merge binding for ${work.id}`);
    transferPaths.push(workStatusPath(plan, work.id));
  }

  verifyTrackComposition(
    repo,
    sharedMerge.expected_target,
    frozenTrackHead,
    sharedMerge.result_commit,
  );
  const releaseHead = resolveRef(repo, plan.metadata.release_ref);
  assertRecordOnlyTransition(
    repo,
    sharedMerge.result_commit,
    releaseHead,
    plan.metadata.record_root,
    transferPaths,
  );
  for (const work of track.work) {
    const next = statusFor(nextStatuses, work.id);
    const recordedRelease = parseStatusBytes(
      readFileAtRef(repo, releaseHead, workStatusPath(plan, work.id)),
      { planDigest: plan.digest },
    );
    same(recordedRelease, next, `release transfer status for ${work.id}`);
  }
  return {
    track_id: track.id,
    frozen_track_head: frozenTrackHead,
    composition_commit: sharedMerge.result_commit,
    transfer_commit: releaseHead,
  };
}

export function validateAssemblyMergeTransition(repo, plan, previous, next) {
  validateAssemblyStatus(repo, plan, previous);
  validateAssemblyStatus(repo, plan, next);
  validateTransition(previous, next, 'MERGED');

  const binding = next.merge;
  if (binding.expected_target !== binding.observed_target) {
    fail('MOVED_TARGET', 'release Merge did not observe its expected target');
  }
  verifyReleaseIntegration(
    repo,
    binding.expected_target,
    previous.proof.candidate_commit,
    binding.result_commit,
  );
  const actualTarget = resolveRef(repo, plan.metadata.target_ref);
  if (actualTarget !== binding.result_commit) {
    fail(
      'MOVED_TARGET',
      `release target is ${actualTarget}, not recorded result ${binding.result_commit}`,
    );
  }

  const releaseHead = resolveRef(repo, plan.metadata.release_ref);
  const parents = commitParents(repo, releaseHead);
  if (parents.length !== 1) {
    fail('UNEXPECTED_RECORD_TRANSITION', 'final assembly status must be one record-only commit');
  }
  const previousReleaseHead = parents[0];
  const statusPath = assemblyStatusPath(plan);
  assertRecordOnlyTransition(
    repo,
    previousReleaseHead,
    releaseHead,
    plan.metadata.record_root,
    [statusPath],
  );
  const recordedPrevious = parseStatusBytes(
    readFileAtRef(repo, previousReleaseHead, statusPath),
    { planDigest: plan.digest },
  );
  const recordedNext = parseStatusBytes(
    readFileAtRef(repo, releaseHead, statusPath),
    { planDigest: plan.digest },
  );
  same(recordedPrevious, previous, 'pre-Merge assembly status');
  same(recordedNext, next, 'final assembly status');
  return {
    assembly_candidate: previous.proof.candidate_commit,
    integration_commit: binding.result_commit,
    status_commit: releaseHead,
  };
}

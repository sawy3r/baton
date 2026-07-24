import { isDeepStrictEqual } from 'node:util';

import {
  RecordError,
  assemblyProofPath,
  assemblyStatusPath,
  assertTrackReadyForComposition,
  assertWorkMayAdvance,
  findTrack,
  parseStatusBytes,
  requirePlanAdmission,
  requireEvidenceAdmission,
  trackRefSnapshot,
  validateAssemblyStatus,
  validateRefSnapshot,
  validateStatusHandoffsAtRef,
  validateStatusSemantics,
  validateTrackMaterialization,
  validateWorkCandidate,
  validateWorkRecordTail,
  workStatusPath,
} from './records.mjs';
import {
  assertStructuralRecordOnlyTransition,
  commitParents,
  readFileAtOID,
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
  same(previous.materialization, next.materialization, 'status.materialization');
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
    if (previous.kind === 'assembly') {
      requireProjection(next, 'verify/ready/planner', 'assembly FAIL result');
      if (next.outcome !== 'fail') fail('INVALID_TRANSITION', 'assembly FAIL must persist outcome fail');
      absent(next, ['merge', 'blocker'], 'assembly FAIL result');
      return;
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
  requireProjection(previous, 'design/ready/implementer', 'MATERIALIZE source');
  if (
    previous.outcome !== 'none'
    || Object.hasOwn(previous, 'materialization')
    || ['design', 'captain', 'proof', 'verification', 'merge', 'blocker']
      .some((field) => Object.hasOwn(previous, field))
  ) {
    fail('INVALID_TRANSITION', 'MATERIALIZE requires a pristine release baseline');
  }
  assertIdentity(previous, next, { allowAuthority: true });
  const releaseRef = `refs/heads/release-wt/${previous.release}`;
  if (previous.authority_ref !== releaseRef || next.authority_ref !== previous.owner_ref) {
    fail('INVALID_AUTHORITY_TRANSFER', 'MATERIALIZE transfers release baseline authority to the exact owner ref');
  }
  if (!Object.hasOwn(next, 'materialization')) {
    fail('INVALID_MATERIALIZATION', 'MATERIALIZE must persist its captured base and dependency heads');
  }
  const previousWithoutAuthority = { ...previous };
  const nextWithoutAuthority = { ...next };
  delete previousWithoutAuthority.authority_ref;
  delete nextWithoutAuthority.authority_ref;
  delete nextWithoutAuthority.materialization;
  same(previousWithoutAuthority, nextWithoutAuthority, 'materialised durable projection');
}

function validateRebound(previous, next) {
  if (previous.kind !== 'work' || next.kind !== 'work') {
    fail('INVALID_TRANSITION', 'REBOUND applies only to non-terminal work');
  }
  if (previous.stage === 'merge' && previous.status === 'complete') {
    fail('TERMINAL_REWRITE', 'terminal work cannot be rebound');
  }
  const releaseRef = `refs/heads/release-wt/${previous.release}`;
  if (
    previous.authority_ref !== releaseRef
    || Object.hasOwn(previous, 'materialization')
    || projection(previous) !== 'design/ready/implementer'
    || previous.outcome !== 'none'
    || ['blocker', 'design', 'captain', 'proof', 'verification', 'merge']
      .some((field) => Object.hasOwn(previous, field))
  ) {
    fail('MATERIALIZED_REBOUND', 'REBOUND applies only to a pristine unmaterialized release baseline');
  }
  assertIdentity(previous, next, { allowTarget: true });
  if (isDeepStrictEqual(previous.plan, next.plan)) {
    fail('REPLAN_NOT_CHANGED', 'REBOUND requires a new plan or approval binding');
  }
  if (Object.hasOwn(next, 'materialization')) {
    fail('MATERIALIZED_REBOUND', 'REBOUND result cannot retain materialization');
  }
  requireProjection(next, 'design/ready/implementer', 'REBOUND result');
  if (next.outcome !== 'none') fail('INVALID_TRANSITION', 'REBOUND resets the durable outcome');
  absent(
    next,
    ['blocker', 'design', 'captain', 'proof', 'verification', 'merge'],
    'REBOUND result',
  );
}

export function unsafeValidateTransition(previous, next, result) {
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

export function validateAdmittedTransition(
  previous,
  next,
  result,
  {
    previousAdmission,
    nextAdmission,
    profile,
  } = {},
) {
  unsafeValidateTransition(previous, next, result);
  requireEvidenceAdmission(previous, previousAdmission, profile);
  requireEvidenceAdmission(next, nextAdmission, profile);
  return next;
}

function statusFor(statuses, workId) {
  return statuses instanceof Map ? statuses.get(workId) : statuses[workId];
}

function validateRecordedCandidateTransitions(admission) {
  const ordinaryResults = TRANSITION_RESULTS.filter((result) => (
    !['MATERIALIZE', 'NO_VERDICT'].includes(result)
  ));
  for (const recorded of admission.record_transitions) {
    if (recorded.collective_materialization) {
      unsafeValidateTransition(recorded.before, recorded.after, 'MATERIALIZE');
      continue;
    }
    const accepted = [];
    for (const result of ordinaryResults) {
      try {
        unsafeValidateTransition(recorded.before, recorded.after, result);
        accepted.push(result);
      } catch (error) {
        if (!(error instanceof RecordError)) throw error;
      }
    }
    if (accepted.length !== 1) {
      fail(
        'INVALID_RECORDED_TRANSITION',
        `candidate record ${recorded.path} at ${recorded.commit} matches ${accepted.length} lifecycle transitions`,
      );
    }
  }
}

function validateCandidateTemporalOrder(plan, admission) {
  const statuses = structuredClone(admission.initial_statuses);
  const currentWork = admission.work_id;
  for (const event of admission.history_events) {
    if (event.kind === 'record') {
      for (const recorded of event.transitions) {
        const before = statuses[recorded.before.work_id];
        if (!isDeepStrictEqual(before, recorded.before)) {
          fail(
            'OUT_OF_ORDER_RECORD',
            `record ${recorded.path} does not follow the prior durable status`,
          );
        }
        if (recorded.before.work_id === currentWork) {
          assertWorkMayAdvance(plan, statuses, admission.track_id, currentWork);
        }
        statuses[recorded.after.work_id] = recorded.after;
      }
      continue;
    }
    assertWorkMayAdvance(plan, statuses, admission.track_id, currentWork);
    const current = statuses[currentWork];
    if (
      projection(current) !== 'implement/ready/implementer'
      || current.captain?.outcome !== 'proceed'
      || !['proceed', 'fail'].includes(current.outcome)
    ) {
      fail(
        'PRODUCT_BEFORE_PROCEED',
        `product commit ${event.commit} occurred before ${currentWork} had implementation authority`,
      );
    }
  }
}

export function validateTrackCompositionTransition(
  repo,
  plan,
  trackId,
  previousStatuses,
  nextStatuses,
  {
    beforeSnapshot,
    afterSnapshot,
    recordRootAdmission,
    evidenceAdmissions: admittedStatuses,
    profile,
  } = {},
) {
  requirePlanAdmission(plan);
  validateRefSnapshot(plan, beforeSnapshot);
  validateRefSnapshot(plan, afterSnapshot);
  if (beforeSnapshot.target.head !== afterSnapshot.target.head) {
    fail('MOVED_TARGET', 'track composition cannot move the release target');
  }
  const track = assertTrackReadyForComposition(plan, previousStatuses, trackId);
  for (const plannedTrack of plan.metadata.tracks) {
    if (
      trackRefSnapshot(beforeSnapshot, plannedTrack.id).head
      !== trackRefSnapshot(afterSnapshot, plannedTrack.id).head
    ) {
      fail('MOVED_OWNER', `track composition moved owner ${plannedTrack.id}`);
    }
  }
  const frozenTrackHead = trackRefSnapshot(beforeSnapshot, track.id).head;
  if (frozenTrackHead === null) fail('AUTHORITATIVE_STATUS_MISSING', `track ${trackId} has no captured owner head`);
  validateTrackMaterialization(repo, plan, trackId, previousStatuses);
  let previousPassedStatus;
  let sharedMerge;
  const transferPaths = [];

  for (const [index, work] of track.work.entries()) {
    const previous = statusFor(previousStatuses, work.id);
    const next = statusFor(nextStatuses, work.id);
    if (!next) fail('AUTHORITATIVE_STATUS_MISSING', `missing transferred status for ${work.id}`);
    requireEvidenceAdmission(previous, statusFor(admittedStatuses ?? {}, work.id), profile);

    const recordedOwner = parseStatusBytes(
      readFileAtOID(repo, frozenTrackHead, workStatusPath(plan, work.id)),
      { planDigest: plan.digest },
    );
    same(recordedOwner, previous, `frozen owner status for ${work.id}`);
    validateStatusHandoffsAtRef(repo, plan, previous, frozenTrackHead);
    const candidateAdmission = validateWorkCandidateHistory(repo, plan, previous, previousPassedStatus, {
      authorityHead: frozenTrackHead,
      recordRootAdmission,
    });
    previousPassedStatus = previous;

    unsafeValidateTransition(previous, next, 'MERGED');
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
    if (binding.expected_target !== beforeSnapshot.release.head) {
      fail('STALE_BINDING', `work ${work.id} does not bind the captured pre-composition release head`);
    }
    if (sharedMerge === undefined) sharedMerge = binding;
    else same(sharedMerge, binding, `shared track Merge binding for ${work.id}`);
    transferPaths.push(workStatusPath(plan, work.id));
  }
  validateRecordedCandidateTransitions(validateWorkRecordTail(
    repo,
    plan,
    previousPassedStatus,
    frozenTrackHead,
    recordRootAdmission,
  ));

  verifyTrackComposition(
    repo,
    sharedMerge.expected_target,
    frozenTrackHead,
    sharedMerge.result_commit,
  );
  const releaseHead = afterSnapshot.release.head;
  if (releaseHead === beforeSnapshot.release.head) {
    fail('INVALID_COMPOSITION', 'track composition must advance the release ref');
  }
  assertStructuralRecordOnlyTransition(
    repo,
    sharedMerge.result_commit,
    releaseHead,
    recordRootAdmission,
    transferPaths,
  );
  for (const work of track.work) {
    const next = statusFor(nextStatuses, work.id);
    const recordedRelease = parseStatusBytes(
      readFileAtOID(repo, releaseHead, workStatusPath(plan, work.id)),
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

export function validateWorkCandidateHistory(
  repo,
  plan,
  status,
  previousStatus,
  options,
) {
  requirePlanAdmission(plan);
  const admission = validateWorkCandidate(repo, plan, status, previousStatus, options);
  validateRecordedCandidateTransitions(admission);
  validateCandidateTemporalOrder(plan, admission);
  return admission;
}

export function validateTrackMaterializationTransition(
  repo,
  plan,
  trackId,
  previousStatuses,
  nextStatuses,
  {
    beforeSnapshot,
    afterSnapshot,
    recordRootAdmission,
    evidenceAdmissions: admittedStatuses,
    profile,
  } = {},
) {
  requirePlanAdmission(plan);
  validateRefSnapshot(plan, beforeSnapshot);
  validateRefSnapshot(plan, afterSnapshot);
  const track = findTrack(plan, trackId);
  if (trackRefSnapshot(beforeSnapshot, track.id).head !== null) {
    fail('INVALID_MATERIALIZATION', `track ${trackId} already existed before materialization`);
  }
  const ownerHead = trackRefSnapshot(afterSnapshot, track.id).head;
  if (
    ownerHead === null
    || ownerHead !== afterSnapshot.release.head
    || afterSnapshot.release.head === beforeSnapshot.release.head
  ) {
    fail(
      'INVALID_MATERIALIZATION',
      'materialization must leave release and owner refs at the same new marker commit',
    );
  }
  if (beforeSnapshot.target.head !== afterSnapshot.target.head) {
    fail('MOVED_TARGET', 'materialization cannot move the release target');
  }
  for (const plannedTrack of plan.metadata.tracks) {
    if (plannedTrack.id === track.id) continue;
    if (
      trackRefSnapshot(beforeSnapshot, plannedTrack.id).head
      !== trackRefSnapshot(afterSnapshot, plannedTrack.id).head
    ) {
      fail('INVALID_MATERIALIZATION', `materialization unexpectedly moved track ${plannedTrack.id}`);
    }
  }
  validateTrackMaterialization(repo, plan, trackId, nextStatuses, beforeSnapshot);
  const statusPaths = [];
  for (const work of track.work) {
    const previous = statusFor(previousStatuses, work.id);
    const next = statusFor(nextStatuses, work.id);
    if (!previous || !next) {
      fail('AUTHORITATIVE_STATUS_MISSING', `materialization requires both states for ${work.id}`);
    }
    requireEvidenceAdmission(
      previous,
      statusFor(admittedStatuses ?? {}, work.id),
      profile,
    );
    const recordedPrevious = parseStatusBytes(
      readFileAtOID(repo, beforeSnapshot.release.head, workStatusPath(plan, work.id)),
      { planDigest: plan.digest },
    );
    const recordedNext = parseStatusBytes(
      readFileAtOID(repo, ownerHead, workStatusPath(plan, work.id)),
      { planDigest: plan.digest },
    );
    same(recordedPrevious, previous, `materialization baseline for ${work.id}`);
    same(recordedNext, next, `materialized owner status for ${work.id}`);
    unsafeValidateTransition(previous, next, 'MATERIALIZE');
    statusPaths.push(workStatusPath(plan, work.id));
  }
  assertStructuralRecordOnlyTransition(
    repo,
    beforeSnapshot.release.head,
    ownerHead,
    recordRootAdmission,
    statusPaths,
  );
  return {
    track_id: track.id,
    base_commit: beforeSnapshot.release.head,
    owner_head: ownerHead,
  };
}

export function validateAssemblyPreparationTransition(
  repo,
  plan,
  status,
  {
    beforeSnapshot,
    afterSnapshot,
    recordRootAdmission,
    evidenceAdmission,
    profile,
  } = {},
) {
  requirePlanAdmission(plan);
  validateRefSnapshot(plan, beforeSnapshot);
  validateRefSnapshot(plan, afterSnapshot);
  requireEvidenceAdmission(status, evidenceAdmission, profile);
  if (beforeSnapshot.target.head !== afterSnapshot.target.head) {
    fail('MOVED_TARGET', 'assembly preparation cannot move the release target');
  }
  for (const track of plan.metadata.tracks) {
    if (
      trackRefSnapshot(beforeSnapshot, track.id).head
      !== trackRefSnapshot(afterSnapshot, track.id).head
    ) {
      fail('MOVED_OWNER', `assembly preparation moved track ${track.id}`);
    }
  }
  const statusPath = assemblyStatusPath(plan);
  const proofPath = assemblyProofPath(plan);
  for (const relativePath of [statusPath, proofPath]) {
    let exists = true;
    try {
      readFileAtOID(repo, beforeSnapshot.release.head, relativePath);
    } catch (error) {
      if (error?.code !== 'RECORD_NOT_FOUND') throw error;
      exists = false;
    }
    if (exists) fail('ASSEMBLY_ALREADY_PREPARED', `${relativePath} already exists before preparation`);
  }
  if (
    status.proof?.base_commit !== beforeSnapshot.release.head
    || status.proof?.candidate_commit !== beforeSnapshot.release.head
  ) {
    fail(
      'STALE_BINDING',
      'assembly proof base and candidate must both equal the exact pre-preparation release head',
    );
  }
  validateAssemblyStatus(repo, plan, status, {
    snapshot: afterSnapshot,
    recordRootAdmission,
  });
  assertStructuralRecordOnlyTransition(
    repo,
    beforeSnapshot.release.head,
    afterSnapshot.release.head,
    recordRootAdmission,
    [proofPath, statusPath],
  );
  const recorded = parseStatusBytes(
    readFileAtOID(repo, afterSnapshot.release.head, statusPath),
    { planDigest: plan.digest },
  );
  same(recorded, status, 'prepared assembly status');
  return {
    assembly_candidate: beforeSnapshot.release.head,
    preparation_commit: afterSnapshot.release.head,
  };
}

export function validateAssemblyMergeTransition(
  repo,
  plan,
  previous,
  next,
  {
    beforeSnapshot,
    afterSnapshot,
    recordRootAdmission,
    evidenceAdmission,
    profile,
  } = {},
) {
  requirePlanAdmission(plan);
  validateRefSnapshot(plan, beforeSnapshot);
  validateRefSnapshot(plan, afterSnapshot);
  requireEvidenceAdmission(previous, evidenceAdmission, profile);
  validateAssemblyStatus(repo, plan, previous, {
    snapshot: beforeSnapshot,
    recordRootAdmission,
  });
  validateAssemblyStatus(repo, plan, next, {
    snapshot: afterSnapshot,
    recordRootAdmission,
  });
  unsafeValidateTransition(previous, next, 'MERGED');

  const binding = next.merge;
  if (binding.expected_target !== binding.observed_target) {
    fail('MOVED_TARGET', 'release Merge did not observe its expected target');
  }
  if (binding.expected_target !== beforeSnapshot.target.head) {
    fail('STALE_BINDING', 'release Merge does not bind the captured pre-integration target');
  }
  verifyReleaseIntegration(
    repo,
    binding.expected_target,
    previous.proof.candidate_commit,
    binding.result_commit,
  );
  const actualTarget = afterSnapshot.target.head;
  if (actualTarget !== binding.result_commit) {
    fail(
      'MOVED_TARGET',
      `release target is ${actualTarget}, not recorded result ${binding.result_commit}`,
    );
  }
  for (const track of plan.metadata.tracks) {
    if (
      trackRefSnapshot(beforeSnapshot, track.id).head
      !== trackRefSnapshot(afterSnapshot, track.id).head
    ) {
      fail('MOVED_OWNER', `release integration moved owner ${track.id}`);
    }
  }

  const previousReleaseHead = beforeSnapshot.release.head;
  const releaseHead = afterSnapshot.release.head;
  if (releaseHead === previousReleaseHead) {
    fail('UNEXPECTED_RECORD_TRANSITION', 'release integration must record one final assembly status commit');
  }
  const statusPath = assemblyStatusPath(plan);
  assertStructuralRecordOnlyTransition(
    repo,
    previousReleaseHead,
    releaseHead,
    recordRootAdmission,
    [statusPath],
  );
  const recordedPrevious = parseStatusBytes(
    readFileAtOID(repo, previousReleaseHead, statusPath),
    { planDigest: plan.digest },
  );
  const recordedNext = parseStatusBytes(
    readFileAtOID(repo, releaseHead, statusPath),
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

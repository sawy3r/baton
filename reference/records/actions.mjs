import { isDeepStrictEqual } from 'node:util';

import {
  captureHeadRefs,
  commitParents,
  productTreeIdentity,
  readFileAtOID,
  resolveProductExclusionAdmission,
  resolveRecordPathAdmission,
  unsafeAtomicUpdateRefs,
  unsafePrepareExactComposition,
  unsafePrepareRecordTransition,
} from './git.mjs';
import {
  RecordError,
  assemblyProofPath,
  assemblyStatusPath,
  assertWorkMayAdvance,
  captureRefSnapshot,
  deriveProspectiveRefSnapshot,
  digestBytes,
  expectedTrackMaterialization,
  findTrack,
  parsePlanBytes,
  parseStatusBytes,
  readAuthoritativeRecordSnapshot,
  releasePlanPath,
  requirePlanAdmission,
  resolveStatusEvidence,
  selectAssemblyFromSnapshot,
  selectAuthoritativeStatusFromSnapshot,
  trackRefSnapshot,
  validateAssemblyStatus,
  validateStatusHandoffsAtRef,
  validateTrackMaterialization,
  validateWorkStatusIdentity,
  workDesignPath,
  workProofPath,
  workStatusPath,
} from './records.mjs';
import {
  unsafeValidateTransition,
  validateAdmittedTransition,
  validateAssemblyMergeTransition,
  validateAssemblyPreparationTransition,
  validateTrackCompositionTransition,
  validateTrackMaterializationTransition,
  validateWorkCandidateHistory,
} from './transition.mjs';

const STATUS_SCHEMA = 'https://baton.sawy3r.net/schemas/work-status-v1.json';
const STATUS_VERSION = 'baton.work-status/v1';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ORDINARY_RESULTS = new Set([
  'DESIGN_WRITTEN',
  'PROCEED',
  'REVISE',
  'ESCALATE',
  'IMPLEMENTED',
  'PASS',
  'FAIL',
  'BLOCKED',
  'NO_VERDICT',
]);

export class BatonActionError extends RecordError {
  constructor(code, message, cause) {
    super(code, message, cause);
    this.name = 'BatonActionError';
  }
}

function fail(code, message, cause) {
  throw new BatonActionError(code, message, cause);
}

function exactOptions(value, required, optional, label) {
  if (value === undefined && required.length === 0) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_ACTION_INPUT', `${label} requires one options object`);
  }
  const keys = Object.keys(value).sort();
  const admitted = [...required, ...optional].sort();
  if (keys.some((key) => !admitted.includes(key))) {
    fail('INVALID_ACTION_INPUT', `${label} received an unknown option`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail('INVALID_ACTION_INPUT', `${label} requires ${key}`);
    }
  }
  return value;
}

function frozen(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) frozen(nested);
  return Object.freeze(value);
}

function assertReceiptData(value, label = 'receipt', seen = new Set()) {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    fail('INVALID_ACTION_RECEIPT', `${label} must contain only JSON data`);
  }
  if (seen.has(value)) {
    fail('INVALID_ACTION_RECEIPT', `${label} must not contain cycles`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((nested, index) => assertReceiptData(nested, `${label}[${index}]`, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('INVALID_ACTION_RECEIPT', `${label} must contain only plain objects`);
    }
    for (const [key, nested] of Object.entries(value)) {
      assertReceiptData(nested, `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function receipt(action, details) {
  const value = {
    kind: 'baton.action-receipt/v1',
    action,
    ...details,
  };
  assertReceiptData(value);
  return frozen(value);
}

function statusBytes(status) {
  return Buffer.from(`${JSON.stringify(status)}\n`);
}

function statusProjection(status) {
  return `${status.stage}/${status.status}/${status.next_role}`;
}

function resultMatchesDurableStatus(result, status) {
  if (result === 'NO_VERDICT') return true;
  const projection = statusProjection(status);
  if (result === 'DESIGN_WRITTEN') return projection === 'design/ready/captain' && status.outcome === 'none';
  if (result === 'PROCEED') return projection === 'implement/ready/implementer' && status.outcome === 'proceed';
  if (result === 'REVISE') return projection === 'design/ready/implementer' && status.outcome === 'revise';
  if (result === 'ESCALATE') return projection === 'design/blocked/planner' && status.outcome === 'escalate';
  if (result === 'IMPLEMENTED') return projection === 'verify/ready/verifier' && status.outcome === 'none';
  if (result === 'PASS') return projection === 'merge/ready/merge' && status.outcome === 'pass';
  if (result === 'BLOCKED') return projection === 'verify/blocked/planner' && status.outcome === 'blocked';
  if (result === 'FAIL' && status.kind === 'assembly') {
    return projection === 'verify/ready/planner' && status.outcome === 'fail';
  }
  return result === 'FAIL'
    && projection === 'implement/ready/implementer'
    && status.outcome === 'fail';
}

function canonicalStatus(status, plan) {
  return parseStatusBytes(statusBytes(status), {
    planDigest: plan.digest,
    approvalRef: plan.metadata.approval_ref,
  });
}

function initialWorkStatus(plan, track, work, approvalDigest) {
  return canonicalStatus({
    $schema: STATUS_SCHEMA,
    schema_version: STATUS_VERSION,
    kind: 'work',
    release: plan.metadata.release,
    work_id: work.id,
    track_id: track.id,
    owner_ref: track.ref,
    authority_ref: plan.metadata.release_ref,
    target_ref: plan.metadata.target_ref,
    plan: {
      digest: plan.digest,
      approval: {
        ref: plan.metadata.approval_ref,
        digest: approvalDigest,
      },
    },
    stage: 'design',
    status: 'ready',
    next_role: 'implementer',
    outcome: 'none',
  }, plan);
}

function allPlannedWork(plan) {
  return plan.metadata.tracks.flatMap((track) => (
    track.work.map((work) => ({ track, work }))
  ));
}

function baselineStatuses(plan, approvalDigest) {
  if (!DIGEST_PATTERN.test(approvalDigest)) {
    fail('INVALID_ACTION_INPUT', 'approvalDigest must be one SHA-256 digest');
  }
  return Object.fromEntries(allPlannedWork(plan).map(({ track, work }) => [
    work.id,
    initialWorkStatus(plan, track, work, approvalDigest),
  ]));
}

function baselineChanges(plan, statuses) {
  return {
    [releasePlanPath(plan)]: plan.bytes,
    ...Object.fromEntries(allPlannedWork(plan).map(({ work }) => [
      workStatusPath(plan, work.id),
      statusBytes(statuses[work.id]),
    ])),
  };
}

function rawPlanHeads(repo, plan) {
  const entries = captureHeadRefs(repo, [
    plan.metadata.target_ref,
    plan.metadata.release_ref,
    ...plan.metadata.tracks.map((track) => track.ref),
  ]);
  return frozen({
    target: entries[0],
    release: entries[1],
    tracks: entries.slice(2).map((entry, index) => ({
      id: plan.metadata.tracks[index].id,
      ...entry,
    })),
  });
}

function verifySnapshotOperations(snapshot, excluded = new Set()) {
  const entries = [
    snapshot.target,
    snapshot.release,
    ...snapshot.tracks,
  ];
  return entries
    .filter((entry) => !excluded.has(entry.ref))
    .map((entry) => ({
      kind: 'verify',
      ref: entry.ref,
      expectedHead: entry.head,
    }));
}

function assertSameUnchangedRefs(before, after, changedRef) {
  for (const key of ['target', 'release']) {
    if (
      before[key].ref !== changedRef
      && before[key].head !== after[key].head
    ) {
      fail('UNEXPECTED_REF_MOVEMENT', `action unexpectedly moved ${before[key].ref}`);
    }
  }
  for (const beforeTrack of before.tracks) {
    if (beforeTrack.ref === changedRef) continue;
    const afterTrack = after.tracks.find((track) => track.ref === beforeTrack.ref);
    if (!afterTrack || beforeTrack.head !== afterTrack.head) {
      fail('UNEXPECTED_REF_MOVEMENT', `action unexpectedly moved ${beforeTrack.ref}`);
    }
  }
}

function assertExactHead(snapshot, ref, expectedHead) {
  const entry = [
    snapshot.target,
    snapshot.release,
    ...snapshot.tracks,
  ].find((candidate) => candidate.ref === ref);
  if (!entry || entry.head !== expectedHead) {
    fail('ACTION_EFFECT_MISMATCH', `action did not leave ${ref} at its prepared commit`);
  }
}

function topology(plan) {
  return {
    release: plan.metadata.release,
    repository: plan.metadata.repository,
    target_ref: plan.metadata.target_ref,
    release_ref: plan.metadata.release_ref,
    record_root: plan.metadata.record_root,
    tracks: plan.metadata.tracks.map((track) => ({
      id: track.id,
      ref: track.ref,
      depends_on: track.depends_on,
      work: track.work.map((work) => ({
        id: work.id,
        depends_on: work.depends_on,
      })),
    })),
  };
}

function mergedWorkStatus(previous, plan, frozenTrackHead, expectedTarget, resultCommit) {
  const next = structuredClone(previous);
  next.authority_ref = plan.metadata.release_ref;
  next.stage = 'merge';
  next.status = 'complete';
  next.next_role = 'none';
  next.outcome = 'merged';
  next.merge = {
    scope: 'track',
    passed_candidate: next.proof.candidate_commit,
    frozen_track_head: frozenTrackHead,
    expected_target: expectedTarget,
    outcome: 'merged',
    observed_target: expectedTarget,
    result_commit: resultCommit,
    plan_digest: plan.digest,
    verification_attestation_digest: next.verification.attestation_digest,
  };
  return canonicalStatus(next, plan);
}

function mergedAssemblyStatus(previous, plan, expectedTarget, resultCommit) {
  const next = structuredClone(previous);
  next.stage = 'merge';
  next.status = 'complete';
  next.next_role = 'none';
  next.outcome = 'merged';
  next.merge = {
    scope: 'release',
    passed_candidate: next.proof.candidate_commit,
    expected_target: expectedTarget,
    outcome: 'merged',
    observed_target: expectedTarget,
    result_commit: resultCommit,
    plan_digest: plan.digest,
    verification_attestation_digest: next.verification.attestation_digest,
  };
  return canonicalStatus(next, plan);
}

function handoffChanges(plan, previous, next, handoffs) {
  const provided = exactOptions(handoffs, [], ['design', 'proof'], 'recordTransition.handoffs');
  if (next.kind === 'assembly' && Object.hasOwn(provided, 'design')) {
    fail('INVALID_HANDOFF', 'assembly transitions cannot write a design handoff');
  }
  const changes = {};
  for (const field of ['design', 'proof']) {
    const changed = next[field]?.digest !== previous[field]?.digest;
    if (!changed) {
      if (Object.hasOwn(provided, field)) {
        fail('INVALID_HANDOFF', `${field} bytes were supplied without a new ${field} digest`);
      }
      continue;
    }
    if (!next[field] || !Object.hasOwn(provided, field)) {
      fail('MISSING_HANDOFF', `a changed ${field} digest requires exact ${field} bytes`);
    }
    const bytes = Buffer.isBuffer(provided[field])
      ? Buffer.from(provided[field])
      : typeof provided[field] === 'string'
        ? Buffer.from(provided[field])
        : null;
    if (!bytes || digestBytes(bytes) !== next[field].digest) {
      fail('HANDOFF_DIGEST_MISMATCH', `${field} bytes do not match the durable digest`);
    }
    const relativePath = field === 'design'
      ? workDesignPath(plan, next.work_id)
      : next.kind === 'assembly'
        ? assemblyProofPath(plan)
        : workProofPath(plan, next.work_id);
    changes[relativePath] = bytes;
  }
  return changes;
}

function validateRetryHandoffs(repo, plan, status, head, handoffs) {
  const provided = exactOptions(handoffs, [], ['design', 'proof'], 'recordTransition.handoffs');
  for (const [field, value] of Object.entries(provided)) {
    if (status.kind === 'assembly' && field === 'design') {
      fail('INVALID_HANDOFF', 'assembly transitions cannot carry a design handoff');
    }
    const bytes = Buffer.isBuffer(value)
      ? Buffer.from(value)
      : typeof value === 'string'
        ? Buffer.from(value)
        : null;
    if (!bytes || status[field]?.digest !== digestBytes(bytes)) {
      fail('HANDOFF_DIGEST_MISMATCH', `${field} retry bytes do not match the durable digest`);
    }
  }
  validateStatusHandoffsAtRef(repo, plan, status, head);
}

/**
 * The sole safe mutation surface. External actors still author plans,
 * statuses, and handoffs; this facade owns every mechanical Git and record
 * compare-and-set.
 */
export function createBatonActions({
  repo,
  plan,
  profile,
  resolveEvidence,
  resolveBehavioralInertness,
} = {}) {
  requirePlanAdmission(plan);
  if (!['guided', 'autonomous'].includes(profile)) {
    fail('INVALID_PROFILE', 'createBatonActions requires guided or autonomous profile');
  }
  if (typeof resolveEvidence !== 'function') {
    fail('EVIDENCE_RESOLVER_REQUIRED', 'createBatonActions requires a trusted evidence resolver');
  }
  const recordPathAdmission = resolveRecordPathAdmission(repo);
  const productExclusionAdmission = resolveProductExclusionAdmission(repo, {
    recordPathAdmission,
    resolveBehavioralInertness,
  });

  const evidenceCache = new Map();
  const cachedResolveEvidence = (request) => {
    const key = JSON.stringify(request);
    let cached = evidenceCache.get(key);
    if (!cached) {
      const resolved = resolveEvidence(request);
      if (
        resolved
        && typeof resolved === 'object'
        && !Array.isArray(resolved)
        && (Buffer.isBuffer(resolved.bytes) || resolved.bytes instanceof Uint8Array || typeof resolved.bytes === 'string')
        && resolved.provenance
        && typeof resolved.provenance === 'object'
      ) {
        cached = {
          bytes: Buffer.from(resolved.bytes),
          provenance: structuredClone(resolved.provenance),
        };
        evidenceCache.set(key, cached);
      } else {
        return resolved;
      }
    }
    return {
      bytes: Buffer.from(cached.bytes),
      provenance: structuredClone(cached.provenance),
    };
  };
  const admit = (status) => resolveStatusEvidence(status, {
    profile,
    resolveEvidence: cachedResolveEvidence,
  });

  function installApprovedPlan(options) {
    const { approvalDigest } = exactOptions(
      options,
      ['approvalDigest'],
      [],
      'installApprovedPlan',
    );
    const before = rawPlanHeads(repo, plan);
    if (before.target.head === null) {
      fail('REF_NOT_FOUND', `target ${plan.metadata.target_ref} does not exist`);
    }
    if (before.tracks.some((track) => track.head !== null)) {
      fail('EXTERNAL_AUTHORITY_REQUIRED', 'approved plan installation requires every owner ref to be absent');
    }
    const statuses = baselineStatuses(plan, approvalDigest);
    for (const status of Object.values(statuses)) admit(status);
    const prepared = unsafePrepareRecordTransition(repo, {
      expectedHead: before.target.head,
      message: `Install approved Baton plan ${plan.metadata.release}`,
      recordPathAdmission,
      productExclusionAdmission,
      changes: baselineChanges(plan, statuses),
    });
    if (before.release.head !== null) {
      if (before.release.head !== prepared.commit) {
        fail('EXTERNAL_AUTHORITY_REQUIRED', 'release ref already contains a different installation');
      }
      return receipt('installApprovedPlan', {
        changed: false,
        release_head: prepared.commit,
        before,
        after: before,
      });
    }
    unsafeAtomicUpdateRefs(repo, [
      {
        kind: 'verify',
        ref: before.target.ref,
        expectedHead: before.target.head,
      },
      {
        kind: 'create',
        ref: before.release.ref,
        newHead: prepared.commit,
      },
      ...before.tracks.map((track) => ({
        kind: 'verify',
        ref: track.ref,
        expectedHead: null,
      })),
    ]);
    const after = rawPlanHeads(repo, plan);
    assertExactHead(after, before.release.ref, prepared.commit);
    return receipt('installApprovedPlan', {
      changed: true,
      release_head: prepared.commit,
      before,
      after,
    });
  }

  function reboundPristinePlan(options) {
    const {
      previousPlan,
      approvalDigest,
    } = exactOptions(
      options,
      ['previousPlan', 'approvalDigest'],
      [],
      'reboundPristinePlan',
    );
    requirePlanAdmission(previousPlan);
    if (!isDeepStrictEqual(topology(previousPlan), topology(plan))) {
      fail('EXTERNAL_AUTHORITY_REQUIRED', 'plan rebound requires identical release ownership topology');
    }
    const before = captureRefSnapshot(repo, previousPlan);
    if (before.tracks.some((track) => track.head !== null)) {
      fail('EXTERNAL_AUTHORITY_REQUIRED', 'materialized plans require a new release identity');
    }
    const installedPlan = parsePlanBytes(
      readFileAtOID(repo, before.release.head, releasePlanPath(previousPlan)),
    );
    const nextStatuses = baselineStatuses(plan, approvalDigest);
    if (installedPlan.digest === plan.digest) {
      const current = captureRefSnapshot(repo, plan);
      const currentRecords = readAuthoritativeRecordSnapshot(
        repo,
        plan,
        current,
        { recordRootAdmission: recordPathAdmission },
      );
      for (const { work } of allPlannedWork(plan)) {
        const selected = selectAuthoritativeStatusFromSnapshot(plan, work.id, currentRecords);
        if (
          selected.source !== 'baseline'
          || !isDeepStrictEqual(selected.status, nextStatuses[work.id])
        ) {
          fail('EXTERNAL_AUTHORITY_REQUIRED', 'rebound plan no longer has exact pristine baselines');
        }
        admit(selected.status);
      }
      return receipt('reboundPristinePlan', {
        changed: false,
        previous_plan_digest: previousPlan.digest,
        plan_digest: plan.digest,
        release_head: current.release.head,
        before: current,
        after: current,
      });
    }
    if (installedPlan.digest !== previousPlan.digest) {
      fail('STALE_BINDING', 'release does not contain the exact previous plan');
    }
    const records = readAuthoritativeRecordSnapshot(
      repo,
      previousPlan,
      before,
      { recordRootAdmission: recordPathAdmission },
    );
    for (const { work } of allPlannedWork(previousPlan)) {
      const selected = selectAuthoritativeStatusFromSnapshot(previousPlan, work.id, records);
      if (selected.source !== 'baseline') {
        fail('EXTERNAL_AUTHORITY_REQUIRED', `work ${work.id} is no longer pristine`);
      }
      const previous = selected.status;
      const next = nextStatuses[work.id];
      validateAdmittedTransition(previous, next, 'REBOUND', {
        previousAdmission: admit(previous),
        nextAdmission: admit(next),
        profile,
      });
    }
    const prepared = unsafePrepareRecordTransition(repo, {
      expectedHead: before.release.head,
      message: `Rebound pristine Baton plan ${plan.metadata.release}`,
      recordPathAdmission,
      productExclusionAdmission,
      changes: baselineChanges(plan, nextStatuses),
    });
    unsafeAtomicUpdateRefs(repo, [
      {
        kind: 'update',
        ref: before.release.ref,
        newHead: prepared.commit,
        expectedHead: before.release.head,
      },
      {
        kind: 'verify',
        ref: before.target.ref,
        expectedHead: before.target.head,
      },
      ...before.tracks.map((track) => ({
        kind: 'verify',
        ref: track.ref,
        expectedHead: null,
      })),
    ]);
    const after = captureRefSnapshot(repo, plan);
    assertExactHead(after, before.release.ref, prepared.commit);
    return receipt('reboundPristinePlan', {
      changed: true,
      previous_plan_digest: previousPlan.digest,
      plan_digest: plan.digest,
      release_head: prepared.commit,
      before,
      after,
    });
  }

  function recordTransition(options) {
    const {
      scope,
      workId,
      result,
      nextStatus,
      handoffs,
    } = exactOptions(
      options,
      ['scope', 'result', 'nextStatus'],
      ['workId', 'handoffs'],
      'recordTransition',
    );
    if (!['work', 'assembly'].includes(scope) || !ORDINARY_RESULTS.has(result)) {
      fail('INVALID_ACTION_INPUT', 'recordTransition accepts only ordinary work/assembly results');
    }
    if ((scope === 'work') !== (typeof workId === 'string')) {
      fail('INVALID_ACTION_INPUT', 'work transitions require workId; assembly transitions forbid it');
    }
    const before = captureRefSnapshot(repo, plan);
    const records = readAuthoritativeRecordSnapshot(
      repo,
      plan,
      before,
      { recordRootAdmission: recordPathAdmission },
    );
    let selected;
    let workContext;
    let trackStatuses;
    if (scope === 'work') {
      workContext = allPlannedWork(plan).find(({ work }) => work.id === workId);
      if (!workContext) fail('UNKNOWN_WORK', `plan has no work ${workId}`);
      trackStatuses = Object.fromEntries(workContext.track.work.map((work) => {
        const authoritative = selectAuthoritativeStatusFromSnapshot(plan, work.id, records);
        if (work.id === workId) selected = authoritative;
        return [work.id, authoritative.status];
      }));
    } else {
      selected = selectAssemblyFromSnapshot(plan, records);
    }
    if (!selected) fail('AUTHORITATIVE_STATUS_MISSING', 'assembly has not been prepared');
    const previous = selected.status;
    const next = canonicalStatus(nextStatus, plan);
    if (scope === 'work') {
      validateWorkStatusIdentity(next, plan, workContext.track, workContext.work);
    } else {
      validateAssemblyStatus(repo, plan, previous, {
        snapshot: before,
        recordRootAdmission: productExclusionAdmission,
      });
      validateAssemblyStatus(repo, plan, next, {
        snapshot: before,
        recordRootAdmission: productExclusionAdmission,
      });
    }
    if (isDeepStrictEqual(previous, next)) {
      if (!resultMatchesDurableStatus(result, previous)) {
        fail('INVALID_RECONCILIATION', `${result} does not match the durable post-state`);
      }
      admit(previous);
      validateRetryHandoffs(repo, plan, previous, selected.head, handoffs);
      return receipt('recordTransition', {
        changed: false,
        scope,
        work_id: workId ?? null,
        result,
        authority_ref: selected.ref,
        commit: selected.head,
        before,
        after: before,
      });
    }
    if (scope === 'work') {
      assertWorkMayAdvance(plan, trackStatuses, workContext.track.id, workId);
    }
    validateAdmittedTransition(previous, next, result, {
      previousAdmission: admit(previous),
      nextAdmission: admit(next),
      profile,
    });
    const changes = {
      ...handoffChanges(plan, previous, next, handoffs),
      [scope === 'work'
        ? workStatusPath(plan, workId)
        : assemblyStatusPath(plan)]: statusBytes(next),
    };
    const prepared = unsafePrepareRecordTransition(repo, {
      expectedHead: selected.head,
      message: `Record ${scope} ${workId ?? plan.metadata.release} ${result}`,
      recordPathAdmission,
      productExclusionAdmission,
      changes,
    });
    validateStatusHandoffsAtRef(repo, plan, next, prepared.commit);
    if (scope === 'work') {
      if (next.proof) {
        const { track } = workContext;
        const workIndex = track.work.findIndex((work) => work.id === workId);
        const prior = workIndex === 0
          ? null
          : selectAuthoritativeStatusFromSnapshot(
            plan,
            track.work[workIndex - 1].id,
            records,
          ).status;
        validateWorkCandidateHistory(repo, plan, next, prior, {
          authorityHead: prepared.commit,
          recordRootAdmission: productExclusionAdmission,
        });
      }
    } else {
      const prospective = deriveProspectiveRefSnapshot(plan, before, [{
        ref: selected.ref,
        head: prepared.commit,
      }]);
      validateAssemblyStatus(repo, plan, next, {
        snapshot: prospective,
        recordRootAdmission: productExclusionAdmission,
      });
    }
    unsafeAtomicUpdateRefs(repo, [
      {
        kind: 'update',
        ref: selected.ref,
        newHead: prepared.commit,
        expectedHead: selected.head,
      },
      ...verifySnapshotOperations(before, new Set([selected.ref])),
    ]);
    const after = captureRefSnapshot(repo, plan);
    assertExactHead(after, selected.ref, prepared.commit);
    assertSameUnchangedRefs(before, after, selected.ref);
    return receipt('recordTransition', {
      changed: true,
      scope,
      work_id: workId ?? null,
      result,
      authority_ref: selected.ref,
      commit: prepared.commit,
      before,
      after,
    });
  }

  function materializeTrack(options) {
    const { trackId } = exactOptions(options, ['trackId'], [], 'materializeTrack');
    const track = findTrack(plan, trackId);
    const before = captureRefSnapshot(repo, plan);
    if (trackRefSnapshot(before, trackId).head !== null) {
      const currentRecords = readAuthoritativeRecordSnapshot(
        repo,
        plan,
        before,
        { recordRootAdmission: recordPathAdmission },
      );
      const currentStatuses = {};
      for (const work of track.work) {
        const selected = selectAuthoritativeStatusFromSnapshot(plan, work.id, currentRecords);
        if (selected.source !== 'owner') {
          fail('INVALID_MATERIALIZATION', `track ${trackId} has advanced beyond its marker`);
        }
        currentStatuses[work.id] = selected.status;
      }
      const materialization = validateTrackMaterialization(
        repo,
        plan,
        trackId,
        currentStatuses,
      );
      for (const work of track.work) {
        const current = currentStatuses[work.id];
        const expected = initialWorkStatus(
          plan,
          track,
          work,
          current.plan.approval.digest,
        );
        expected.authority_ref = track.ref;
        expected.materialization = structuredClone(materialization);
        if (!isDeepStrictEqual(current, canonicalStatus(expected, plan))) {
          fail('INVALID_MATERIALIZATION', `track ${trackId} has advanced beyond its marker`);
        }
        admit(current);
      }
      return receipt('materializeTrack', {
        changed: false,
        track_id: track.id,
        base_commit: materialization.base_commit,
        owner_head: trackRefSnapshot(before, trackId).head,
        before,
        after: before,
      });
    }
    const records = readAuthoritativeRecordSnapshot(
      repo,
      plan,
      before,
      { recordRootAdmission: recordPathAdmission },
    );
    const previousStatuses = {};
    const nextStatuses = {};
    const evidenceAdmissions = {};
    const materialization = expectedTrackMaterialization(repo, plan, trackId, before);
    for (const work of track.work) {
      const selected = selectAuthoritativeStatusFromSnapshot(plan, work.id, records);
      if (selected.source !== 'baseline') {
        fail('INVALID_MATERIALIZATION', `work ${work.id} is not one release baseline`);
      }
      const previous = selected.status;
      const next = structuredClone(previous);
      next.authority_ref = track.ref;
      next.materialization = materialization;
      const canonical = canonicalStatus(next, plan);
      unsafeValidateTransition(previous, canonical, 'MATERIALIZE');
      previousStatuses[work.id] = previous;
      nextStatuses[work.id] = canonical;
      evidenceAdmissions[work.id] = admit(previous);
    }
    const prepared = unsafePrepareRecordTransition(repo, {
      expectedHead: before.release.head,
      message: `Materialize Baton track ${trackId}`,
      recordPathAdmission,
      productExclusionAdmission,
      changes: Object.fromEntries(track.work.map((work) => [
        workStatusPath(plan, work.id),
        statusBytes(nextStatuses[work.id]),
      ])),
    });
    const prospective = deriveProspectiveRefSnapshot(plan, before, [
      { ref: before.release.ref, head: prepared.commit },
      { ref: track.ref, head: prepared.commit },
    ]);
    const aggregate = validateTrackMaterializationTransition(
      repo,
      plan,
      trackId,
      previousStatuses,
      nextStatuses,
      {
        beforeSnapshot: before,
        afterSnapshot: prospective,
        recordRootAdmission: recordPathAdmission,
        evidenceAdmissions,
        profile,
      },
    );
    unsafeAtomicUpdateRefs(repo, [
      {
        kind: 'update',
        ref: before.release.ref,
        newHead: prepared.commit,
        expectedHead: before.release.head,
      },
      {
        kind: 'create',
        ref: track.ref,
        newHead: prepared.commit,
      },
      ...verifySnapshotOperations(before, new Set([before.release.ref, track.ref])),
    ]);
    const after = captureRefSnapshot(repo, plan);
    assertExactHead(after, before.release.ref, prepared.commit);
    assertExactHead(after, track.ref, prepared.commit);
    validateTrackMaterializationTransition(
      repo,
      plan,
      trackId,
      previousStatuses,
      nextStatuses,
      {
        beforeSnapshot: before,
        afterSnapshot: after,
        recordRootAdmission: recordPathAdmission,
        evidenceAdmissions,
        profile,
      },
    );
    return receipt('materializeTrack', {
      changed: true,
      ...aggregate,
      before,
      after,
    });
  }

  function composeTrack(options) {
    const { trackId } = exactOptions(options, ['trackId'], [], 'composeTrack');
    const track = findTrack(plan, trackId);
    const before = captureRefSnapshot(repo, plan);
    const frozenTrackHead = trackRefSnapshot(before, trackId).head;
    if (frozenTrackHead === null) {
      fail('AUTHORITATIVE_STATUS_MISSING', `track ${trackId} is not materialized`);
    }
    const records = readAuthoritativeRecordSnapshot(
      repo,
      plan,
      before,
      { recordRootAdmission: recordPathAdmission },
    );
    const previousStatuses = {};
    const evidenceAdmissions = {};
    const selections = track.work.map((work) => (
      selectAuthoritativeStatusFromSnapshot(plan, work.id, records)
    ));
    if (selections.every((selected) => selected.source === 'composed')) {
      const owner = records.refs.find((entry) => entry.track_id === track.id);
      if (!owner || owner.head !== frozenTrackHead) {
        fail('INVALID_AUTHORITY_TRANSFER', `track ${trackId} has no exact frozen owner`);
      }
      let expectedReleaseHead;
      for (const [index, work] of track.work.entries()) {
        const status = selections[index].status;
        if (
          status.stage !== 'merge'
          || status.status !== 'complete'
          || status.merge?.scope !== 'track'
          || status.merge.frozen_track_head !== frozenTrackHead
        ) {
          fail('INVALID_AUTHORITY_TRANSFER', `work ${work.id} has a divergent transfer`);
        }
        if (
          expectedReleaseHead !== undefined
          && expectedReleaseHead !== status.merge.expected_target
        ) {
          fail('INVALID_AUTHORITY_TRANSFER', `track ${trackId} has inconsistent transfer bindings`);
        }
        expectedReleaseHead = status.merge.expected_target;
        const previous = owner.statuses.find((entry) => entry.work_id === work.id)?.status;
        if (!previous) fail('AUTHORITATIVE_STATUS_MISSING', `owner lacks ${work.id}`);
        previousStatuses[work.id] = previous;
        evidenceAdmissions[work.id] = admit(previous);
      }
      const originalBefore = deriveProspectiveRefSnapshot(plan, before, [{
        ref: before.release.ref,
        head: expectedReleaseHead,
      }]);
      const aggregate = validateTrackCompositionTransition(
        repo,
        plan,
        trackId,
        previousStatuses,
        Object.fromEntries(track.work.map((work, index) => [
          work.id,
          selections[index].status,
        ])),
        {
          beforeSnapshot: originalBefore,
          afterSnapshot: before,
          recordRootAdmission: productExclusionAdmission,
          evidenceAdmissions,
          profile,
        },
      );
      return receipt('composeTrack', {
        changed: false,
        ...aggregate,
        before,
        after: before,
      });
    }
    if (selections.some((selected) => selected.source === 'composed')) {
      fail('PARTIAL_TRACK_TRANSFER', `track ${trackId} is only partially transferred`);
    }
    for (const work of track.work) {
      const selected = selections[track.work.findIndex((entry) => entry.id === work.id)];
      if (selected.source !== 'owner' || selected.head !== frozenTrackHead) {
        fail('INVALID_AUTHORITY_TRANSFER', `work ${work.id} is not owned by ${trackId}`);
      }
      previousStatuses[work.id] = selected.status;
      evidenceAdmissions[work.id] = admit(selected.status);
    }
    const composition = unsafePrepareExactComposition(repo, {
      targetRef: plan.metadata.release_ref,
      expectedHead: before.release.head,
      candidate: frozenTrackHead,
      productExclusionAdmission,
    });
    const nextStatuses = Object.fromEntries(track.work.map((work) => [
      work.id,
      mergedWorkStatus(
        previousStatuses[work.id],
        plan,
        frozenTrackHead,
        before.release.head,
        composition.result,
      ),
    ]));
    const transfer = unsafePrepareRecordTransition(repo, {
      expectedHead: composition.result,
      message: `Transfer composed Baton track ${trackId}`,
      recordPathAdmission,
      productExclusionAdmission,
      changes: Object.fromEntries(track.work.map((work) => [
        workStatusPath(plan, work.id),
        statusBytes(nextStatuses[work.id]),
      ])),
    });
    const prospective = deriveProspectiveRefSnapshot(plan, before, [{
      ref: before.release.ref,
      head: transfer.commit,
    }]);
    const aggregate = validateTrackCompositionTransition(
      repo,
      plan,
      trackId,
      previousStatuses,
      nextStatuses,
      {
        beforeSnapshot: before,
        afterSnapshot: prospective,
        recordRootAdmission: productExclusionAdmission,
        evidenceAdmissions,
        profile,
      },
    );
    unsafeAtomicUpdateRefs(repo, [
      {
        kind: 'update',
        ref: before.release.ref,
        newHead: transfer.commit,
        expectedHead: before.release.head,
      },
      ...verifySnapshotOperations(before, new Set([before.release.ref])),
    ]);
    const after = captureRefSnapshot(repo, plan);
    assertExactHead(after, before.release.ref, transfer.commit);
    validateTrackCompositionTransition(
      repo,
      plan,
      trackId,
      previousStatuses,
      nextStatuses,
      {
        beforeSnapshot: before,
        afterSnapshot: after,
        recordRootAdmission: productExclusionAdmission,
        evidenceAdmissions,
        profile,
      },
    );
    return receipt('composeTrack', {
      changed: true,
      ...aggregate,
      before,
      after,
    });
  }

  function prepareAssembly(options) {
    const {
      proofBytes,
      producerInvocation,
    } = exactOptions(
      options,
      ['proofBytes', 'producerInvocation'],
      [],
      'prepareAssembly',
    );
    if (typeof producerInvocation !== 'string') {
      fail('INVALID_ACTION_INPUT', 'prepareAssembly producerInvocation must be a string');
    }
    const exactProofBytes = Buffer.isBuffer(proofBytes)
      ? Buffer.from(proofBytes)
      : typeof proofBytes === 'string'
        ? Buffer.from(proofBytes)
        : null;
    if (!exactProofBytes) fail('INVALID_ACTION_INPUT', 'prepareAssembly proofBytes must be bytes or text');
    const before = captureRefSnapshot(repo, plan);
    const records = readAuthoritativeRecordSnapshot(
      repo,
      plan,
      before,
      { recordRootAdmission: recordPathAdmission },
    );
    const existingAssembly = selectAssemblyFromSnapshot(plan, records);
    if (existingAssembly !== null) {
      const status = existingAssembly.status;
      if (
        statusProjection(status) !== 'verify/ready/verifier'
        || status.outcome !== 'none'
        || status.proof?.digest !== digestBytes(exactProofBytes)
        || status.proof?.producer_invocation !== producerInvocation
        || status.proof.base_commit !== status.proof.candidate_commit
      ) {
        fail('ASSEMBLY_ALREADY_PREPARED', 'assembly exists with a different or advanced durable state');
      }
      const evidenceAdmission = admit(status);
      const originalBefore = deriveProspectiveRefSnapshot(plan, before, [{
        ref: before.release.ref,
        head: status.proof.candidate_commit,
      }]);
      const aggregate = validateAssemblyPreparationTransition(
        repo,
        plan,
        status,
        {
          beforeSnapshot: originalBefore,
          afterSnapshot: before,
          recordRootAdmission: productExclusionAdmission,
          evidenceAdmission,
          profile,
        },
      );
      return receipt('prepareAssembly', {
        changed: false,
        ...aggregate,
        before,
        after: before,
      });
    }
    const firstWork = allPlannedWork(plan)[0].work.id;
    const approvalDigest = selectAuthoritativeStatusFromSnapshot(
      plan,
      firstWork,
      records,
    ).status.plan.approval.digest;
    const candidate = before.release.head;
    const identity = productTreeIdentity(repo, candidate, productExclusionAdmission);
    const status = canonicalStatus({
      $schema: STATUS_SCHEMA,
      schema_version: STATUS_VERSION,
      kind: 'assembly',
      release: plan.metadata.release,
      owner_ref: plan.metadata.release_ref,
      authority_ref: plan.metadata.release_ref,
      target_ref: plan.metadata.target_ref,
      plan: {
        digest: plan.digest,
        approval: {
          ref: plan.metadata.approval_ref,
          digest: approvalDigest,
        },
      },
      stage: 'verify',
      status: 'ready',
      next_role: 'verifier',
      outcome: 'none',
      proof: {
        digest: digestBytes(exactProofBytes),
        producer_invocation: producerInvocation,
        repository: plan.metadata.repository,
        base_commit: candidate,
        candidate_commit: candidate,
        candidate_tree: identity.candidateTree,
        product_tree: identity.productTree,
        plan_digest: plan.digest,
        approval_digest: approvalDigest,
        components: plan.metadata.tracks.map((track) => {
          const head = trackRefSnapshot(before, track.id).head;
          if (head === null) fail('INCOMPLETE_ASSEMBLY', `track ${track.id} has no owner head`);
          return { track_id: track.id, head };
        }),
      },
    }, plan);
    const evidenceAdmission = admit(status);
    const prepared = unsafePrepareRecordTransition(repo, {
      expectedHead: before.release.head,
      message: `Prepare Baton assembly ${plan.metadata.release}`,
      recordPathAdmission,
      productExclusionAdmission,
      changes: {
        [assemblyProofPath(plan)]: exactProofBytes,
        [assemblyStatusPath(plan)]: statusBytes(status),
      },
    });
    const prospective = deriveProspectiveRefSnapshot(plan, before, [{
      ref: before.release.ref,
      head: prepared.commit,
    }]);
    const aggregate = validateAssemblyPreparationTransition(
      repo,
      plan,
      status,
      {
        beforeSnapshot: before,
        afterSnapshot: prospective,
        recordRootAdmission: productExclusionAdmission,
        evidenceAdmission,
        profile,
      },
    );
    unsafeAtomicUpdateRefs(repo, [
      {
        kind: 'update',
        ref: before.release.ref,
        newHead: prepared.commit,
        expectedHead: before.release.head,
      },
      ...verifySnapshotOperations(before, new Set([before.release.ref])),
    ]);
    const after = captureRefSnapshot(repo, plan);
    assertExactHead(after, before.release.ref, prepared.commit);
    validateAssemblyPreparationTransition(
      repo,
      plan,
      status,
      {
        beforeSnapshot: before,
        afterSnapshot: after,
        recordRootAdmission: productExclusionAdmission,
        evidenceAdmission,
        profile,
      },
    );
    return receipt('prepareAssembly', {
      changed: true,
      ...aggregate,
      before,
      after,
    });
  }

  function integrateRelease(options) {
    exactOptions(options, [], [], 'integrateRelease');
    const before = captureRefSnapshot(repo, plan);
    const records = readAuthoritativeRecordSnapshot(
      repo,
      plan,
      before,
      { recordRootAdmission: recordPathAdmission },
    );
    const selected = selectAssemblyFromSnapshot(plan, records);
    if (!selected) fail('AUTHORITATIVE_STATUS_MISSING', 'assembly has not been prepared');
    const previous = selected.status;
    if (statusProjection(previous) === 'merge/complete/none' && previous.outcome === 'merged') {
      if (before.target.head !== previous.merge?.result_commit) {
        fail('ACTION_EFFECT_MISMATCH', 'terminal assembly does not match the current target');
      }
      const parents = commitParents(repo, before.release.head);
      if (parents.length !== 1) {
        fail('UNEXPECTED_RECORD_TRANSITION', 'terminal assembly status has no exact predecessor');
      }
      const prior = parseStatusBytes(
        readFileAtOID(repo, parents[0], assemblyStatusPath(plan)),
        {
          planDigest: plan.digest,
          approvalRef: plan.metadata.approval_ref,
        },
      );
      const originalBefore = deriveProspectiveRefSnapshot(plan, before, [
        { ref: before.target.ref, head: previous.merge.expected_target },
        { ref: before.release.ref, head: parents[0] },
      ]);
      const aggregate = validateAssemblyMergeTransition(
        repo,
        plan,
        prior,
        previous,
        {
          beforeSnapshot: originalBefore,
          afterSnapshot: before,
          recordRootAdmission: productExclusionAdmission,
          evidenceAdmission: admit(prior),
          profile,
        },
      );
      return receipt('integrateRelease', {
        changed: false,
        ...aggregate,
        before,
        after: before,
      });
    }
    const evidenceAdmission = admit(previous);
    validateAssemblyStatus(repo, plan, previous, {
      snapshot: before,
      recordRootAdmission: productExclusionAdmission,
    });
    const integration = unsafePrepareExactComposition(repo, {
      targetRef: plan.metadata.target_ref,
      expectedHead: before.target.head,
      candidate: previous.proof.candidate_commit,
      productExclusionAdmission,
    });
    const next = mergedAssemblyStatus(
      previous,
      plan,
      before.target.head,
      integration.result,
    );
    unsafeValidateTransition(previous, next, 'MERGED');
    const finalStatus = unsafePrepareRecordTransition(repo, {
      expectedHead: before.release.head,
      message: `Integrate Baton release ${plan.metadata.release}`,
      recordPathAdmission,
      productExclusionAdmission,
      changes: {
        [assemblyStatusPath(plan)]: statusBytes(next),
      },
    });
    const prospective = deriveProspectiveRefSnapshot(plan, before, [
      { ref: before.target.ref, head: integration.result },
      { ref: before.release.ref, head: finalStatus.commit },
    ]);
    const aggregate = validateAssemblyMergeTransition(
      repo,
      plan,
      previous,
      next,
      {
        beforeSnapshot: before,
        afterSnapshot: prospective,
        recordRootAdmission: productExclusionAdmission,
        evidenceAdmission,
        profile,
      },
    );
    unsafeAtomicUpdateRefs(repo, [
      {
        kind: 'update',
        ref: before.target.ref,
        newHead: integration.result,
        expectedHead: before.target.head,
      },
      {
        kind: 'update',
        ref: before.release.ref,
        newHead: finalStatus.commit,
        expectedHead: before.release.head,
      },
      ...before.tracks.map((track) => ({
        kind: 'verify',
        ref: track.ref,
        expectedHead: track.head,
      })),
    ]);
    const after = captureRefSnapshot(repo, plan);
    assertExactHead(after, before.target.ref, integration.result);
    assertExactHead(after, before.release.ref, finalStatus.commit);
    validateAssemblyMergeTransition(
      repo,
      plan,
      previous,
      next,
      {
        beforeSnapshot: before,
        afterSnapshot: after,
        recordRootAdmission: productExclusionAdmission,
        evidenceAdmission,
        profile,
      },
    );
    return receipt('integrateRelease', {
      changed: true,
      ...aggregate,
      before,
      after,
    });
  }

  return frozen({
    installApprovedPlan,
    reboundPristinePlan,
    recordTransition,
    materializeTrack,
    composeTrack,
    prepareAssembly,
    integrateRelease,
  });
}

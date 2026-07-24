#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import {
  GitRecordError,
  captureHeadRefs,
  readFileAtOID,
  repositoryRoot,
  resolveCapturedRecordPathAdmission,
  unsafeRunGit,
  verifyReleaseIntegration,
} from '../records/git.mjs';
import {
  RecordError,
  captureRefSnapshot,
  nextWorkForTrack,
  parsePlanBytes,
  readAuthoritativeRecordSnapshot,
  selectAssemblyFromSnapshot,
  selectAuthoritativeStatusFromSnapshot,
  validateAssemblyProjection,
  validateProofGitTopology,
  validateStatusHandoffsAtRef,
} from '../records/records.mjs';

export const BOARD_VERSION = 'baton.board/v1';

const RELEASE_PREFIX = 'refs/heads/release-wt/';
const MAX_RELEASES = 32;
const MAX_REPOSITORY_CACHE = 32;
const MAX_DIAGNOSTIC_TEXT = 1000;
const OPERATION_BY_ROLE = Object.freeze({
  planner: 'baton-plan',
  implementer: 'baton-implement',
  captain: 'baton-design-review',
  verifier: 'baton-verify',
  merge: 'baton-merge',
});

function byteCompare(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

function frozen(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) frozen(item);
  return Object.freeze(value);
}

function safeText(value, repository = '') {
  let text = typeof value === 'string' ? value : String(value ?? '');
  if (repository) text = text.split(repository).join('<repository>');
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '\ufffd')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .slice(0, MAX_DIAGNOSTIC_TEXT);
}

function diagnostic(error, repository, context = {}) {
  const code = (
    (error instanceof RecordError || error instanceof GitRecordError)
    && typeof error.code === 'string'
  )
    ? error.code
    : 'BOARD_PROJECTION_FAILED';
  return frozen({
    code,
    release: context.release ?? null,
    track: context.track ?? null,
    work: context.work ?? null,
    message: safeText(error?.message ?? 'board projection failed', repository),
  });
}

function boardDiagnostic(code, message, context = {}) {
  return frozen({
    code,
    release: context.release ?? null,
    track: context.track ?? null,
    work: context.work ?? null,
    message,
  });
}

function repositoryIdentity(value) {
  if (
    value.startsWith('/')
    || value.startsWith('\\\\')
    || /^[A-Za-z]:[\\/]/.test(value)
  ) {
    throw new RecordError(
      'INVALID_REPOSITORY_IDENTITY',
      'plan repository must be a portable identity, not an absolute path',
    );
  }
  return value;
}

function parseReleaseListing(raw) {
  let rendered;
  try {
    rendered = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch (error) {
    throw new GitRecordError(
      'MALFORMED_GIT_OUTPUT',
      'release ref listing was not valid UTF-8',
      error,
    );
  }
  const releases = [];
  const seen = new Set();
  for (const line of rendered.split('\n').filter(Boolean)) {
    const fields = line.split('\t');
    if (fields.length !== 3) {
      throw new GitRecordError('MALFORMED_GIT_OUTPUT', 'release ref listing was malformed');
    }
    const [ref, head, type] = fields;
    if (
      !ref.startsWith(RELEASE_PREFIX)
      || ref.length === RELEASE_PREFIX.length
      || ref.slice(RELEASE_PREFIX.length).includes('/')
      || type !== 'commit'
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)
      || seen.has(ref)
    ) {
      throw new GitRecordError('INVALID_RELEASE_REF', `invalid release ref listing entry ${ref}`);
    }
    seen.add(ref);
    releases.push(frozen({
      release: ref.slice(RELEASE_PREFIX.length),
      ref,
      head,
    }));
  }
  if (releases.length > MAX_RELEASES) {
    throw new GitRecordError(
      'RESOURCE_LIMIT',
      `repository has more than ${MAX_RELEASES} Baton release refs`,
    );
  }
  releases.sort((left, right) => byteCompare(left.ref, right.ref));
  return frozen(releases);
}

export function discoverReleaseHeads(repo) {
  const raw = unsafeRunGit(
    repo,
    [
      'for-each-ref',
      '--format=%(refname)%09%(objectname)%09%(objecttype)',
      'refs/heads/release-wt',
    ],
    {
      encoding: null,
      label: 'discover Baton release refs',
    },
  );
  return parseReleaseListing(raw);
}

function operationDescriptor(operation, scope, release, track = null, work = null) {
  return frozen({
    operation,
    scope,
    release,
    track,
    work,
  });
}

function operationForStatus(status, release, track, work, scope = 'work') {
  const operation = OPERATION_BY_ROLE[status.next_role];
  if (!operation) return null;
  return operationDescriptor(operation, scope, release, track, work);
}

function projectBlocker(status) {
  if (!status.blocker) return null;
  return frozen({
    code: status.blocker.code,
    summary: status.blocker.summary,
  });
}

function projectWork(work, selection, nextOperation) {
  const status = selection.status;
  return frozen({
    id: work.id,
    depends_on: frozen([...work.depends_on]),
    stage: status.stage,
    status: status.status,
    next_role: status.next_role,
    outcome: status.outcome,
    blocker: projectBlocker(status),
    source: frozen({
      mode: selection.source,
      ref: selection.ref,
      head: selection.head,
    }),
    next_operation: nextOperation,
  });
}

function sameFrozenHead(statuses) {
  const heads = new Set(statuses.map((status) => status.merge?.frozen_track_head));
  return heads.size === 1 ? [...heads][0] : null;
}

function trackState(track, selections) {
  const statuses = track.work.map((work) => selections.get(work.id).status);
  const composed = statuses.every((status) => (
    status.stage === 'merge'
    && status.status === 'complete'
    && status.outcome === 'merged'
  ));
  const ready = statuses.every((status) => (
    status.stage === 'merge'
    && status.status === 'ready'
    && status.next_role === 'merge'
    && status.outcome === 'pass'
    && status.authority_ref === track.ref
  ));
  if (composed) {
    const head = sameFrozenHead(statuses);
    if (head === null) {
      throw new RecordError(
        'INCONSISTENT_FROZEN_HEAD',
        `track ${track.id} completed work does not bind one frozen head`,
      );
    }
    return frozen({ composition: 'composed', frozen_head: head });
  }
  if (ready) return frozen({ composition: 'ready', frozen_head: selections.get(track.work[0].id).head });
  return frozen({ composition: 'pending', frozen_head: null });
}

function verifySelectedStatus(repo, plan, selection, admission) {
  if (selection.status.design || selection.status.proof) {
    validateStatusHandoffsAtRef(repo, plan, selection.status, selection.head);
  }
  if (selection.status.proof) {
    validateProofGitTopology(repo, selection.status, {
      repository: plan.metadata.repository,
      authorityHead: selection.head,
    });
  }
}

function materialisationMode(records, trackId, composition) {
  if (composition === 'composed') return 'transferred';
  return records.refs.some((entry) => entry.track_id === trackId) ? 'owner' : 'baseline';
}

function projectTracks(repo, plan, snapshot, records, admission) {
  const selections = new Map();
  for (const track of plan.metadata.tracks) {
    for (const work of track.work) {
      const selection = selectAuthoritativeStatusFromSnapshot(plan, work.id, records);
      verifySelectedStatus(repo, plan, selection, admission);
      selections.set(work.id, selection);
    }
  }

  const states = new Map(plan.metadata.tracks.map((track) => (
    [track.id, trackState(track, selections)]
  )));
  const projected = [];
  const nextOperations = [];

  for (const track of plan.metadata.tracks) {
    const state = states.get(track.id);
    const dependencyBlockers = track.depends_on.filter((dependency) => (
      states.get(dependency)?.composition !== 'composed'
    ));
    const statuses = Object.fromEntries(track.work.map((work) => (
      [work.id, selections.get(work.id).status]
    )));
    const nextWorkId = nextWorkForTrack(plan, statuses, track.id);
    let nextOperation = null;
    if (dependencyBlockers.length === 0) {
      if (state.composition === 'ready') {
        nextOperation = operationDescriptor(
          'baton-merge',
          'track',
          plan.metadata.release,
          track.id,
        );
      } else if (state.composition === 'pending' && nextWorkId !== null) {
        nextOperation = operationForStatus(
          selections.get(nextWorkId).status,
          plan.metadata.release,
          track.id,
          nextWorkId,
        );
      }
    }
    if (nextOperation) nextOperations.push(nextOperation);
    const work = track.work.map((item) => projectWork(
      item,
      selections.get(item.id),
      nextOperation?.scope === 'work' && nextOperation.work === item.id
        ? nextOperation
        : null,
    ));
    const captured = snapshot.tracks.find((entry) => entry.id === track.id);
    projected.push(frozen({
      id: track.id,
      ref: track.ref,
      head: captured?.head ?? null,
      depends_on: frozen([...track.depends_on]),
      blockers: frozen([...dependencyBlockers]),
      materialisation: materialisationMode(records, track.id, state.composition),
      composition: state.composition,
      frozen_head: state.frozen_head,
      work: frozen(work),
      next_operation: nextOperation,
    }));
  }
  return frozen({
    tracks: frozen(projected),
    next_operations: frozen(nextOperations),
    all_composed: [...states.values()].every((state) => state.composition === 'composed'),
    any_blocked: [...selections.values()].some((selection) => selection.status.status === 'blocked'),
  });
}

function projectAssembly(repo, plan, snapshot, records, admission, allComposed) {
  const selection = selectAssemblyFromSnapshot(plan, records);
  if (selection === null) {
    const nextOperation = allComposed
      ? operationDescriptor('baton-merge', 'assembly', plan.metadata.release)
      : null;
    return frozen({
      assembly: frozen({
        stage: 'verify',
        status: allComposed ? 'ready' : 'waiting',
        next_role: allComposed ? 'merge' : 'none',
        outcome: 'none',
        blocker: null,
        source: null,
        next_operation: nextOperation,
      }),
      next_operation: nextOperation,
      complete: false,
      blocked: false,
    });
  }

  validateAssemblyProjection(repo, plan, selection.status, {
    snapshot,
    recordRootAdmission: admission,
  });
  let complete = false;
  if (
    selection.status.stage === 'merge'
    && selection.status.status === 'complete'
    && selection.status.outcome === 'merged'
  ) {
    const binding = selection.status.merge;
    verifyReleaseIntegration(
      repo,
      binding.expected_target,
      selection.status.proof.candidate_commit,
      binding.result_commit,
    );
    if (snapshot.target.head !== binding.result_commit) {
      throw new RecordError(
        'MOVED_TARGET',
        `release target does not equal recorded result for ${plan.metadata.release}`,
      );
    }
    complete = true;
  }
  const nextOperation = complete
    ? null
    : operationForStatus(
      selection.status,
      plan.metadata.release,
      null,
      null,
      'assembly',
    );
  return frozen({
    assembly: frozen({
      stage: selection.status.stage,
      status: selection.status.status,
      next_role: selection.status.next_role,
      outcome: selection.status.outcome,
      blocker: projectBlocker(selection.status),
      source: frozen({
        mode: selection.source,
        ref: selection.ref,
        head: selection.head,
      }),
      next_operation: nextOperation,
    }),
    next_operation: nextOperation,
    complete,
    blocked: selection.status.status === 'blocked',
  });
}

function releaseStatus(tracks, assembly) {
  if (assembly.complete) return 'complete';
  if (tracks.any_blocked || assembly.blocked) return 'blocked';
  if (!tracks.all_composed) return 'in_progress';
  if (assembly.assembly.source === null) return 'assembly_ready';
  if (assembly.assembly.stage === 'merge' && assembly.assembly.status === 'ready') {
    return 'merge_ready';
  }
  return 'assembly';
}

function planPath(release) {
  return `.baton/releases/${release}/plan.md`;
}

function readPlanAtReleaseHead(repo, release) {
  const plan = parsePlanBytes(readFileAtOID(repo, release.head, planPath(release.release)));
  if (
    plan.metadata.release !== release.release
    || plan.metadata.release_ref !== release.ref
  ) {
    throw new RecordError(
      'RELEASE_PLAN_MISMATCH',
      `approved plan does not match discovered release ${release.release}`,
    );
  }
  return plan;
}

function refreshReleaseHead(repo, ref) {
  const [captured] = captureHeadRefs(repo, [ref]);
  return captured.head;
}

function captureStableRelease(repo, discovered, captureSnapshot, attempts = 2) {
  let expected = discovered;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let plan;
    try {
      plan = readPlanAtReleaseHead(repo, expected);
    } catch (error) {
      const current = refreshReleaseHead(repo, expected.ref);
      if (attempt + 1 < attempts && current !== null && current !== expected.head) {
        expected = frozen({ ...expected, head: current });
        continue;
      }
      throw error;
    }
    let snapshot;
    try {
      snapshot = captureSnapshot(repo, plan);
    } catch (error) {
      const current = refreshReleaseHead(repo, expected.ref);
      if (attempt + 1 < attempts && current !== null && current !== expected.head) {
        expected = frozen({ ...expected, head: current });
        continue;
      }
      throw error;
    }
    if (snapshot.release.head === expected.head) return frozen({ plan, snapshot });
    if (attempt + 1 < attempts && snapshot.release.head !== null) {
      expected = frozen({ ...expected, head: snapshot.release.head });
      continue;
    }
  }
  throw new GitRecordError(
    'REF_SNAPSHOT_UNSTABLE',
    `release ref ${discovered.ref} moved during two snapshot attempts`,
  );
}

function projectCapturedRelease(repo, plan, snapshot, admission) {
  repositoryIdentity(plan.metadata.repository);
  const records = readAuthoritativeRecordSnapshot(repo, plan, snapshot, {
    recordRootAdmission: admission,
  });
  const tracks = projectTracks(repo, plan, snapshot, records, admission);
  const assembly = projectAssembly(
    repo,
    plan,
    snapshot,
    records,
    admission,
    tracks.all_composed,
  );
  const nextOperations = [...tracks.next_operations];
  if (assembly.next_operation) nextOperations.push(assembly.next_operation);
  return frozen({
    schema_version: BOARD_VERSION,
    release: plan.metadata.release,
    repository: repositoryIdentity(plan.metadata.repository),
    valid: true,
    diagnostics: frozen([]),
    plan_digest: plan.digest,
    release_ref: plan.metadata.release_ref,
    release_head: snapshot.release.head,
    target_ref: plan.metadata.target_ref,
    target_head: snapshot.target.head,
    status: releaseStatus(tracks, assembly),
    tracks: tracks.tracks,
    assembly: assembly.assembly,
    next_operations: frozen(nextOperations),
  });
}

function projectRelease(repo, discovered, admission, captureSnapshot) {
  const captured = captureStableRelease(repo, discovered, captureSnapshot);
  return frozen({
    ...captured,
    release: projectCapturedRelease(
      repo,
      captured.plan,
      captured.snapshot,
      admission,
    ),
  });
}

function sameRefSnapshot(left, right) {
  return (
    left.release.ref === right.release.ref
    && left.release.head === right.release.head
    && left.target.ref === right.target.ref
    && left.target.head === right.target.head
    && left.tracks.length === right.tracks.length
    && left.tracks.every((entry, index) => (
      entry.id === right.tracks[index].id
      && entry.ref === right.tracks[index].ref
      && entry.head === right.tracks[index].head
    ))
  );
}

function invalidRelease(discovered, error, repository) {
  const item = diagnostic(error, repository, { release: discovered.release });
  return frozen({
    schema_version: BOARD_VERSION,
    release: discovered.release,
    repository: null,
    valid: false,
    diagnostics: frozen([item]),
    plan_digest: null,
    release_ref: discovered.ref,
    release_head: discovered.head,
    target_ref: null,
    target_head: null,
    status: 'invalid',
    tracks: frozen([]),
    assembly: null,
    next_operations: frozen([]),
  });
}

export function createBoardOracle({ captureSnapshot = captureRefSnapshot } = {}) {
  if (typeof captureSnapshot !== 'function') {
    throw new TypeError('captureSnapshot must be a function');
  }
  const repositoryCache = new Map();
  return frozen({
    project(repo = process.cwd(), options = {}) {
      let root;
      try {
        root = repositoryRoot(repo);
      } catch (error) {
        const item = diagnostic(error, '');
        return frozen({
          schema_version: BOARD_VERSION,
          repository: null,
          valid: false,
          diagnostics: frozen([item]),
          releases: frozen([]),
          next_operations: frozen([]),
        });
      }
      let admission;
      const getAdmission = () => {
        if (admission) return admission;
        admission = options.recordPathAdmission
          ?? resolveCapturedRecordPathAdmission(root);
        return admission;
      };
      const cacheable = options.recordPathAdmission === undefined;
      const cache = cacheable
        ? (repositoryCache.get(root) ?? new Map())
        : null;
      if (cacheable && !repositoryCache.has(root)) {
        if (repositoryCache.size >= MAX_REPOSITORY_CACHE) {
          repositoryCache.delete(repositoryCache.keys().next().value);
        }
        repositoryCache.set(root, cache);
      }
      let discovered;
      try {
        discovered = discoverReleaseHeads(root);
      } catch (error) {
        const item = diagnostic(error, root);
        return frozen({
          schema_version: BOARD_VERSION,
          repository: null,
          valid: false,
          diagnostics: frozen([item]),
          releases: frozen([]),
          next_operations: frozen([]),
        });
      }

      const activeRefs = new Set(discovered.map((entry) => entry.ref));
      if (cache) {
        for (const ref of cache.keys()) {
          if (!activeRefs.has(ref)) cache.delete(ref);
        }
      }
      const releases = discovered.map((entry) => {
        try {
          const cached = cache?.get(entry.ref);
          if (cached && cached.snapshot.release.head === entry.head) {
            const snapshot = captureSnapshot(root, cached.plan);
            if (snapshot.release.head === entry.head) {
              if (sameRefSnapshot(snapshot, cached.snapshot)) return cached.release;
              const release = projectCapturedRelease(
                root,
                cached.plan,
                snapshot,
                getAdmission(),
              );
              cache.set(entry.ref, frozen({
                plan: cached.plan,
                snapshot,
                release,
              }));
              return release;
            }
            if (snapshot.release.head !== null) {
              const captured = captureStableRelease(
                root,
                frozen({ ...entry, head: snapshot.release.head }),
                captureSnapshot,
                1,
              );
              const release = projectCapturedRelease(
                root,
                captured.plan,
                captured.snapshot,
                getAdmission(),
              );
              cache.set(entry.ref, frozen({ ...captured, release }));
              return release;
            }
          }
          const projected = projectRelease(
            root,
            entry,
            getAdmission(),
            captureSnapshot,
          );
          if (cache) cache.set(entry.ref, projected);
          return projected.release;
        } catch (error) {
          cache?.delete(entry.ref);
          return invalidRelease(entry, error, root);
        }
      });
      const diagnostics = releases.flatMap((release) => release.diagnostics);
      const identities = new Set(
        releases.filter((release) => release.valid).map((release) => release.repository),
      );
      if (identities.size > 1) {
        diagnostics.push(boardDiagnostic(
          'REPOSITORY_IDENTITY_MISMATCH',
          'approved releases name different repository identities',
        ));
      }
      const valid = diagnostics.length === 0;
      const repositoryIdentity = identities.size === 1 ? [...identities][0] : null;
      return frozen({
        schema_version: BOARD_VERSION,
        repository: repositoryIdentity,
        valid,
        diagnostics: frozen(diagnostics),
        releases: frozen(releases),
        next_operations: frozen(
          releases.filter((release) => release.valid).flatMap((release) => release.next_operations),
        ),
      });
    },
  });
}

const defaultOracle = createBoardOracle();

export function projectBoard(repo = process.cwd(), options = {}) {
  return defaultOracle.project(repo, options);
}

export function boardBytes(board) {
  if (!board || board.schema_version !== BOARD_VERSION) {
    throw new TypeError(`board must be ${BOARD_VERSION}`);
  }
  return Buffer.from(`${JSON.stringify(board)}\n`);
}

function usage() {
  return 'Usage: node reference/board/oracle.mjs [repository]\n';
}

function main(argv) {
  if (
    argv.length > 1
    || (argv.length === 1 && argv[0].startsWith('-'))
  ) {
    process.stderr.write(usage());
    process.exitCode = (
      argv.length === 1
      && (argv[0] === '--help' || argv[0] === '-h')
    ) ? 0 : 64;
    return;
  }
  let board;
  try {
    board = projectBoard(argv[0] ?? process.cwd());
  } catch (error) {
    process.stderr.write(`${safeText(error?.message ?? 'invalid repository')}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(boardBytes(board));
  process.exitCode = board.valid ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}

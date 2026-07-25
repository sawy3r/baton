import { types as utilTypes } from 'node:util';

import {
  captureHeadRefs,
  productTreeIdentity,
  readFilesAtOID,
  readFirstParentHistory,
  repositoryRoot,
  resolveProductExclusionAdmission,
  resolveRecordPathAdmission,
  unsafeAtomicUpdateRefs,
  unsafePrepareExactComposition,
  unsafePrepareMetadataCommit,
  unsafePrepareRecordTransition,
} from './git.mjs';
import {
  RECEIPT_TRAILER,
  digestBytes,
  parsePlanBytes,
  parseReceiptCommitMessage,
  parseReceiptHistoryEntry,
  renderReceiptCommit,
} from './receipts.mjs';

const RECORD_ROOT = '.baton/releases';
const MAX_SUMMARY = 280;
const MAX_DETAIL = 8_192;

export class BatonActionError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BatonActionError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new BatonActionError(code, message, cause);
}

function exactOptions(value, required, optional, label) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail('INVALID_ACTION_INPUT', `${label} requires one plain options object`);
  }
  const allowed = new Set([...required, ...optional]);
  const result = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      fail('INVALID_ACTION_INPUT', `${label} received an unknown option`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('INVALID_ACTION_INPUT', `${label} options must be plain enumerable data`);
    }
    result[key] = descriptor.value;
  }
  for (const key of required) {
    if (!Object.hasOwn(result, key)) {
      fail('INVALID_ACTION_INPUT', `${label} requires ${key}`);
    }
  }
  return Object.freeze(result);
}

function text(value, label, maximum, { nonempty = true } = {}) {
  if (
    typeof value !== 'string'
    || Buffer.byteLength(value, 'utf8') > maximum
    || (nonempty && value.trim().length === 0)
  ) {
    fail(
      'INVALID_ACTION_INPUT',
      `${label} must be ${nonempty ? 'a non-empty' : 'an'} UTF-8 string of at most ${maximum} bytes`,
    );
  }
  return value;
}

function detailBytes(value = Buffer.alloc(0)) {
  if (!(typeof value === 'string' || Buffer.isBuffer(value))) {
    fail('INVALID_ACTION_INPUT', 'detail must be a string or Buffer');
  }
  const result = Buffer.from(value);
  if (result.byteLength > MAX_DETAIL) {
    fail('INVALID_ACTION_INPUT', `detail must be at most ${MAX_DETAIL} bytes`);
  }
  return result;
}

function frozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) frozen(nested, seen);
  return Object.freeze(value);
}

function receiptResult(action, changed, details) {
  return frozen({
    kind: 'baton.action-result/v2',
    action,
    changed,
    ...details,
  });
}

function releaseRef(release) {
  return `refs/heads/release-wt/${release}`;
}

function trackRef(release, track) {
  return `refs/heads/track/${release}/${track}`;
}

function planPath(release) {
  return `${RECORD_ROOT}/${release}/plan.md`;
}

function captureMap(repo, refs) {
  return new Map(captureHeadRefs(repo, refs).map(({ ref, head }) => [ref, head]));
}

function receiptHistory(repo, head) {
  const rows = readFirstParentHistory(repo, head);
  const entries = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.message.includes(Buffer.from(RECEIPT_TRAILER))) continue;
    const parent = rows[index + 1];
    if (!parent || row.parents[0] !== parent.oid) {
      fail(
        'HISTORY_LIMIT',
        `cannot establish the parent tree for receipt ${row.oid}`,
      );
    }
    entries.push(parseReceiptHistoryEntry({
      oid: row.oid,
      parents: row.parents,
      tree: row.tree,
      parent_tree: parent.tree,
      message: row.message,
    }));
  }
  return Object.freeze(entries);
}

function fileAt(repo, commit, relativePath) {
  const [entry] = readFilesAtOID(repo, commit, [relativePath]);
  return entry;
}

function currentPlan(repo, release, releaseHead) {
  const entry = fileAt(repo, releaseHead, planPath(release));
  if (!entry?.bytes || !entry.object) {
    fail('PLAN_NOT_FOUND', `release ${release} has no current plan`);
  }
  return Object.freeze({
    parsed: parsePlanBytes(entry.bytes),
    object: entry.object,
  });
}

function findApproval(repo, releaseHead, planObject) {
  const approval = receiptHistory(repo, releaseHead).find(({ receipt }) => (
    receipt.role === 'planner'
    && receipt.result === 'approved'
    && receipt.plan === planObject
  ));
  if (
    !approval
    || approval.receipt.binds !== approval.parent
  ) {
    fail('PLAN_NOT_APPROVED', `plan ${planObject} has no applicable approval receipt`);
  }
  return approval;
}

function assertRevision(previous, next, previousObject) {
  if (next.metadata.revision !== previous.metadata.revision + 1) {
    fail('INVALID_PLAN_REVISION', 'plan revision must advance by exactly one');
  }
  if (next.metadata.previous_plan !== previousObject) {
    fail('INVALID_PLAN_REVISION', 'plan previous_plan must bind the current plan blob');
  }
  for (const field of ['release', 'repository', 'target_ref']) {
    if (next.metadata[field] !== previous.metadata[field]) {
      fail(
        'REPLACED_RELEASE_AUTHORITY',
        `plan revision cannot change ${field}; create a new release`,
      );
    }
  }
  if (next.metadata.approval_ref === previous.metadata.approval_ref) {
    fail('STALE_APPROVAL', 'plan revision requires a new protected approval reference');
  }
}

function planReceipt({
  release,
  planObject,
  planCommit,
  target,
  summary,
  detail,
}) {
  const message = renderReceiptCommit({
    subject: `baton(${release}): approve plan`,
    detail,
    receipt: {
      version: 1,
      release,
      role: 'planner',
      result: 'approved',
      plan: planObject,
      binds: planCommit,
      detail: digestBytes(Buffer.alloc(0)),
      summary,
      target,
    },
  });
  return Object.freeze({
    message,
    receipt: parseReceiptCommitMessage(message).receipt,
  });
}

function planResult({
  changed,
  parsed,
  planObject,
  approval,
  ref,
  target,
}) {
  return receiptResult('recordPlanRevision', changed, {
    release: parsed.metadata.release,
    revision: parsed.metadata.revision,
    plan: planObject,
    ref,
    target,
    receipt_commit: approval.oid,
    receipt: approval.receipt,
  });
}

function createAdmissions(repo, resolveBehavioralInertness) {
  const recordPathAdmission = resolveRecordPathAdmission(repo);
  const productExclusionAdmission = resolveProductExclusionAdmission(repo, {
    recordPathAdmission,
    resolveBehavioralInertness,
  });
  return Object.freeze({ recordPathAdmission, productExclusionAdmission });
}

export function createBatonActions(options) {
  const admitted = exactOptions(
    options,
    ['repo', 'resolveBehavioralInertness'],
    [],
    'createBatonActions',
  );
  if (typeof admitted.repo !== 'string' || admitted.repo.length === 0) {
    fail('INVALID_ACTION_INPUT', 'repo must be a non-empty path');
  }
  if (typeof admitted.resolveBehavioralInertness !== 'function') {
    fail('INVALID_ACTION_INPUT', 'resolveBehavioralInertness must be a function');
  }
  const repo = repositoryRoot(admitted.repo);
  const admissions = createAdmissions(repo, admitted.resolveBehavioralInertness);

  function recordPlanRevision(rawOptions) {
    const input = exactOptions(
      rawOptions,
      ['planBytes', 'summary'],
      ['detail'],
      'recordPlanRevision',
    );
    const parsed = parsePlanBytes(Buffer.from(input.planBytes));
    const summary = text(input.summary, 'summary', MAX_SUMMARY);
    const detail = detailBytes(input.detail);
    const release = parsed.metadata.release;
    const targetRef = parsed.metadata.target_ref;
    const ownerRef = releaseRef(release);
    const refs = captureMap(repo, [targetRef, ownerRef]);
    const target = refs.get(targetRef);
    const priorHead = refs.get(ownerRef);
    if (!target) fail('TARGET_NOT_FOUND', `target ${targetRef} does not exist`);

    let parent;
    if (priorHead === null) {
      if (parsed.metadata.revision !== 1 || parsed.metadata.previous_plan !== null) {
        fail('INVALID_PLAN_REVISION', 'a new release must begin at plan revision 1');
      }
      if (fileAt(repo, target, planPath(release)).object !== null) {
        fail('RELEASE_ALREADY_RECORDED', `target already contains release ${release}`);
      }
      parent = target;
    } else {
      const previous = currentPlan(repo, release, priorHead);
      if (previous.parsed.bytes.equals(parsed.bytes)) {
        const approval = findApproval(repo, priorHead, previous.object);
        if (approval.receipt.target !== target) {
          fail(
            'TARGET_MOVED',
            'the target changed after this plan approval; record a new plan revision',
          );
        }
        return planResult({
          changed: false,
          parsed: previous.parsed,
          planObject: previous.object,
          approval: {
            oid: approval.oid,
            receipt: approval.receipt,
          },
          ref: ownerRef,
          target,
        });
      }
      assertRevision(previous.parsed, parsed, previous.object);
      parent = priorHead;
    }

    const preparedPlan = unsafePrepareRecordTransition(repo, {
      expectedHead: parent,
      message: `baton(${release}): plan revision ${parsed.metadata.revision}`,
      ...admissions,
      changes: {
        [planPath(release)]: parsed.bytes,
      },
    });
    const planObject = fileAt(repo, preparedPlan.commit, planPath(release)).object;
    if (!planObject) fail('PLAN_NOT_FOUND', 'prepared plan blob could not be resolved');
    const rendered = planReceipt({
      release,
      planObject,
      planCommit: preparedPlan.commit,
      target,
      summary,
      detail,
    });
    const preparedApproval = unsafePrepareMetadataCommit(repo, {
      expectedHead: preparedPlan.commit,
      message: rendered.message,
    });
    const operations = [
      { kind: 'verify', ref: targetRef, expectedHead: target },
      priorHead === null
        ? { kind: 'create', ref: ownerRef, newHead: preparedApproval.commit }
        : {
          kind: 'update',
          ref: ownerRef,
          newHead: preparedApproval.commit,
          expectedHead: priorHead,
        },
    ];
    unsafeAtomicUpdateRefs(repo, operations);
    return planResult({
      changed: true,
      parsed,
      planObject,
      approval: {
        oid: preparedApproval.commit,
        receipt: rendered.receipt,
      },
      ref: ownerRef,
      target,
    });
  }

  return Object.freeze({
    recordPlanRevision,
  });
}

export const referenceNames = Object.freeze({
  releaseRef,
  trackRef,
  planPath,
});

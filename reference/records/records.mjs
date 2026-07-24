#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  GitRecordError,
  assertCandidate,
  assertCanonicalRecordRoot,
  assertStructuralRecordOnlyTransition,
  assertRecordRootAtRef,
  commitParents,
  isAncestor,
  productTreeIdentity,
  readFileAtOID,
  readRecordTreeAtOID,
  resolveRef,
  changedPathsBetween,
  captureHeadRefs,
  readFilesAtOID,
  readReleaseProjectionFilesAtOID,
  unsafeRunGit as runGit,
} from './git.mjs';

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
export const RECORD_LIMITS = Object.freeze({
  json_depth: 64,
  plan_bytes: 1_048_576,
  status_bytes: 262_144,
  evidence_bytes: 1_048_576,
  tracks: 64,
  work_per_track: 256,
  work_total: 1024,
  list_items: 256,
  proof_components: 64,
});
const STATUS_SCHEMA = 'https://baton.sawy3r.net/schemas/work-status-v1.json';
const STATUS_VERSION = 'baton.work-status/v1';
const PLAN_VERSION = 'baton.plan/v1';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const OBJECT_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const INVOCATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const PLAN_OPEN = '```baton-plan-v1\n';
const PLAN_CLOSE = '\n```\n';
const planAdmissions = new WeakMap();
const refSnapshots = new WeakMap();
const recordSnapshots = new WeakMap();
const evidenceAdmissions = new WeakSet();

export class RecordError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RecordError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new RecordError(code, message);
}

function decodeUTF8(bytes, label) {
  if (typeof bytes === 'string') return bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new RecordError('INVALID_UTF8', `${label} is not valid UTF-8`, error);
  }
}

function assertUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail('INVALID_UNICODE', 'string contains a lone high surrogate');
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('INVALID_UNICODE', 'string contains a lone low surrogate');
    }
  }
}

class StrictJSONParser {
  constructor(text) {
    this.text = text;
    this.offset = 0;
  }

  parse() {
    this.space();
    const value = this.value();
    this.space();
    if (this.offset !== this.text.length) {
      fail('TRAILING_JSON', `strict JSON has trailing input at byte ${this.offset}`);
    }
    return value;
  }

  space() {
    while (/[\t\n\r ]/.test(this.text[this.offset] ?? '')) this.offset += 1;
  }

  value(depth = 0) {
    if (depth > RECORD_LIMITS.json_depth) {
      fail('RESOURCE_LIMIT', `strict JSON exceeds maximum depth ${RECORD_LIMITS.json_depth}`);
    }
    this.space();
    const character = this.text[this.offset];
    if (
      this.text.startsWith('NaN', this.offset)
      || this.text.startsWith('Infinity', this.offset)
      || this.text.startsWith('-Infinity', this.offset)
    ) {
      fail('NONFINITE_NUMBER', `non-finite number at byte ${this.offset}`);
    }
    if (character === '{') return this.object(depth);
    if (character === '[') return this.array(depth);
    if (character === '"') return this.string();
    if (character === '-' || (character >= '0' && character <= '9')) return this.number();
    if (this.text.startsWith('true', this.offset)) {
      this.offset += 4;
      return true;
    }
    if (this.text.startsWith('false', this.offset)) {
      this.offset += 5;
      return false;
    }
    if (this.text.startsWith('null', this.offset)) {
      this.offset += 4;
      return null;
    }
    fail('INVALID_JSON', `unexpected token at byte ${this.offset}`);
  }

  object(depth) {
    this.offset += 1;
    this.space();
    const result = {};
    const names = new Set();
    if (this.text[this.offset] === '}') {
      this.offset += 1;
      return result;
    }
    for (;;) {
      if (this.text[this.offset] !== '"') fail('INVALID_JSON', `expected object name at byte ${this.offset}`);
      const name = this.string();
      if (names.has(name)) fail('DUPLICATE_NAME', `duplicate object name ${JSON.stringify(name)}`);
      names.add(name);
      this.space();
      if (this.text[this.offset] !== ':') fail('INVALID_JSON', `expected ':' at byte ${this.offset}`);
      this.offset += 1;
      Object.defineProperty(result, name, {
        value: this.value(depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.space();
      if (this.text[this.offset] === '}') {
        this.offset += 1;
        return result;
      }
      if (this.text[this.offset] !== ',') fail('INVALID_JSON', `expected ',' at byte ${this.offset}`);
      this.offset += 1;
      this.space();
    }
  }

  array(depth) {
    this.offset += 1;
    this.space();
    const result = [];
    if (this.text[this.offset] === ']') {
      this.offset += 1;
      return result;
    }
    for (;;) {
      result.push(this.value(depth + 1));
      this.space();
      if (this.text[this.offset] === ']') {
        this.offset += 1;
        return result;
      }
      if (this.text[this.offset] !== ',') fail('INVALID_JSON', `expected ',' at byte ${this.offset}`);
      this.offset += 1;
      this.space();
    }
  }

  string() {
    const start = this.offset;
    this.offset += 1;
    let escaped = false;
    for (; this.offset < this.text.length; this.offset += 1) {
      const character = this.text[this.offset];
      if (!escaped && character === '"') {
        this.offset += 1;
        let value;
        try {
          value = JSON.parse(this.text.slice(start, this.offset));
        } catch (error) {
          throw new RecordError('INVALID_JSON', `invalid JSON string at byte ${start}`, error);
        }
        assertUnicode(value);
        return value;
      }
      if (!escaped && character.charCodeAt(0) < 0x20) {
        fail('INVALID_JSON', `unescaped control character at byte ${this.offset}`);
      }
      if (!escaped && character === '\\') {
        escaped = true;
      } else {
        escaped = false;
      }
    }
    fail('INVALID_JSON', `unterminated string at byte ${start}`);
  }

  number() {
    const remaining = this.text.slice(this.offset);
    const match = remaining.match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) fail('INVALID_JSON', `invalid number at byte ${this.offset}`);
    const raw = match[0];
    this.offset += raw.length;
    const next = this.text[this.offset];
    if (next !== undefined && !/[\t\n\r ,}\]]/.test(next)) {
      fail('INVALID_JSON', `invalid number delimiter at byte ${this.offset}`);
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) fail('NONFINITE_NUMBER', `non-finite number ${raw}`);
    if (Number.isInteger(value) && Math.abs(value) > MAX_SAFE_INTEGER) {
      fail('UNSAFE_INTEGER', `integer-valued number outside interoperable range: ${raw}`);
    }
    return value;
  }
}

export function strictParseJSON(bytes, label = 'JSON', { maxBytes = RECORD_LIMITS.plan_bytes } = {}) {
  const byteLength = typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength;
  if (byteLength > maxBytes) {
    fail('RESOURCE_LIMIT', `${label} exceeds maximum size ${maxBytes} bytes`);
  }
  return new StrictJSONParser(decodeUTF8(bytes, label)).parse();
}

export function digestBytes(bytes) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_SHAPE', `${label} must be an object`);
  }
  return value;
}

function exactKeys(value, required, optional, label) {
  object(value, label);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('UNKNOWN_FIELD', `${label} has unknown field ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('MISSING_FIELD', `${label} is missing ${key}`);
  }
}

function string(value, label, { min = 1, max = 1000, pattern } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail('INVALID_FIELD', `${label} must be a string of ${min}-${max} characters`);
  }
  assertUnicode(value);
  if (pattern && !pattern.test(value)) fail('INVALID_FIELD', `${label} has an invalid value`);
  return value;
}

function boundedArray(value, label, { nonempty = false, max = RECORD_LIMITS.list_items } = {}) {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) {
    fail('INVALID_FIELD', `${label} must be ${nonempty ? 'a non-empty' : 'an'} array`);
  }
  if (value.length > max) fail('RESOURCE_LIMIT', `${label} exceeds maximum length ${max}`);
  return value;
}

function strings(value, label, {
  nonempty = false,
  pathValues = false,
  max = RECORD_LIMITS.list_items,
} = {}) {
  boundedArray(value, label, { nonempty, max });
  const seen = new Set();
  return value.map((item, index) => {
    const parsed = pathValues
      ? repositoryPath(item, `${label}[${index}]`)
      : string(item, `${label}[${index}]`);
    if (seen.has(parsed)) fail('DUPLICATE_IDENTITY', `${label} repeats ${parsed}`);
    seen.add(parsed);
    return parsed;
  });
}

function identity(value, label) {
  return string(value, label, { max: 128, pattern: IDENTITY_PATTERN });
}

function digest(value, label) {
  return string(value, label, { max: 71, pattern: DIGEST_PATTERN });
}

function objectId(value, label) {
  return string(value, label, { max: 64, pattern: OBJECT_PATTERN });
}

function invocation(value, label) {
  return string(value, label, { max: 200, pattern: INVOCATION_PATTERN });
}

export function validateHeadRef(value, label = 'ref') {
  string(value, label, { max: 250 });
  if (!value.startsWith('refs/heads/')) fail('INVALID_REF', `${label} must be a full refs/heads ref`);
  const tail = value.slice('refs/heads/'.length);
  const segments = tail.split('/');
  if (
    segments.some((segment) => (
      segment === ''
      || segment === '.'
      || segment === '..'
      || segment.startsWith('.')
      || segment.endsWith('.')
      || segment.endsWith('.lock')
    ))
    || tail.includes('..')
    || tail.includes('@{')
    || /[\\ ~^:?*[\]\u0000-\u001f\u007f]/.test(tail)
  ) {
    fail('INVALID_REF', `${label} is not a canonical branch ref`);
  }
  return value;
}

export function repositoryPath(value, label = 'path', { allowRoot = true } = {}) {
  string(value, label, { max: 1000 });
  if (allowRoot && value === '.') return value;
  if (
    path.isAbsolute(value)
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail('INVALID_PATH', `${label} must be repository-relative`);
  }
  const segments = value.split('/');
  if (
    segments[0] === '.git'
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    fail('INVALID_PATH', `${label} is not canonical`);
  }
  return value;
}

function recordRoot(value) {
  const parsed = repositoryPath(value, 'plan.record_root', { allowRoot: false });
  if (parsed !== '.baton/releases') {
    fail('INVALID_RECORD_ROOT', 'plan.record_root must be exactly .baton/releases in v1');
  }
  return parsed;
}

function pathContains(parent, child) {
  return parent === '.' || child === parent || child.startsWith(`${parent}/`);
}

function pathsOverlap(left, right) {
  return pathContains(left, right) || pathContains(right, left);
}

function validatePlanWork(value, label, root) {
  exactKeys(
    value,
    ['id', 'outcome', 'scope', 'acceptance', 'checks', 'constraints', 'depends_on'],
    [],
    label,
  );
  const id = identity(value.id, `${label}.id`);
  string(value.outcome, `${label}.outcome`, { max: 1000 });
  exactKeys(value.scope, ['include', 'exclude'], [], `${label}.scope`);
  const include = strings(value.scope.include, `${label}.scope.include`, {
    nonempty: true,
    pathValues: true,
  });
  const exclude = strings(value.scope.exclude, `${label}.scope.exclude`, { pathValues: true });
  for (const scopedPath of [...include, ...exclude]) {
    if (pathContains(root, scopedPath) || pathContains(scopedPath, root)) {
      fail('RECORD_ROOT_IN_PRODUCT_SCOPE', `${label} scope overlaps record root ${root}`);
    }
  }
  boundedArray(value.acceptance, `${label}.acceptance`, { nonempty: true });
  const acceptanceIds = new Set();
  const acceptance = value.acceptance.map((criterion, index) => {
    const criterionLabel = `${label}.acceptance[${index}]`;
    exactKeys(criterion, ['id', 'text'], [], criterionLabel);
    const criterionId = identity(criterion.id, `${criterionLabel}.id`);
    if (acceptanceIds.has(criterionId)) {
      fail('DUPLICATE_IDENTITY', `${label} repeats acceptance ${criterionId}`);
    }
    acceptanceIds.add(criterionId);
    return {
      id: criterionId,
      text: string(criterion.text, `${criterionLabel}.text`, { max: 2000 }),
    };
  });
  return {
    id,
    outcome: value.outcome,
    scope: { include, exclude },
    acceptance,
    checks: strings(value.checks, `${label}.checks`),
    constraints: strings(value.constraints, `${label}.constraints`),
    depends_on: strings(value.depends_on, `${label}.depends_on`).map((dependency) => (
      identity(dependency, `${label}.depends_on`)
    )),
  };
}

function detectCycle(nodes, edges, code, label) {
  const visiting = new Set();
  const visited = new Set();
  function visit(node) {
    if (visiting.has(node)) fail(code, `${label} contains a cycle through ${node}`);
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dependency of edges.get(node) ?? []) visit(dependency);
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of nodes) visit(node);
}

function dependencyClosure(trackId, trackEdges, memo = new Map()) {
  if (memo.has(trackId)) return memo.get(trackId);
  const result = new Set();
  memo.set(trackId, result);
  for (const dependency of trackEdges.get(trackId) ?? []) {
    result.add(dependency);
    for (const nested of dependencyClosure(dependency, trackEdges, memo)) result.add(nested);
  }
  return result;
}

export function validatePlanMetadata(value) {
  exactKeys(
    value,
    [
      'schema_version',
      'release',
      'repository',
      'target_ref',
      'release_ref',
      'record_root',
      'approval_ref',
      'tracks',
    ],
    [],
    'plan',
  );
  if (value.schema_version !== PLAN_VERSION) fail('INVALID_VERSION', `plan.schema_version must be ${PLAN_VERSION}`);
  const release = identity(value.release, 'plan.release');
  const repository = string(value.repository, 'plan.repository', { max: 500 });
  if (/[\u0000-\u001f\u007f]/.test(repository)) {
    fail('INVALID_FIELD', 'plan.repository contains a control character');
  }
  const targetRef = validateHeadRef(value.target_ref, 'plan.target_ref');
  const releaseRef = validateHeadRef(value.release_ref, 'plan.release_ref');
  if (releaseRef !== `refs/heads/release-wt/${release}`) {
    fail('INVALID_REF', `plan.release_ref must be refs/heads/release-wt/${release}`);
  }
  if (targetRef === releaseRef) fail('INVALID_REF', 'plan target and release refs must differ');
  const root = recordRoot(value.record_root);
  const approvalRef = artifactRef(value.approval_ref, 'plan.approval_ref');
  boundedArray(value.tracks, 'plan.tracks', { nonempty: true, max: RECORD_LIMITS.tracks });

  const trackIds = new Set();
  const workIds = new Set();
  const workTrack = new Map();
  const workOrder = new Map();
  const tracks = value.tracks.map((track, trackIndex) => {
    const label = `plan.tracks[${trackIndex}]`;
    exactKeys(track, ['id', 'ref', 'depends_on', 'touch_surfaces', 'work'], [], label);
    const id = identity(track.id, `${label}.id`);
    if (trackIds.has(id)) fail('DUPLICATE_IDENTITY', `plan repeats track ${id}`);
    trackIds.add(id);
    const ref = validateHeadRef(track.ref, `${label}.ref`);
    if (ref !== `refs/heads/track/${release}/${id}`) {
      fail('INVALID_REF', `${label}.ref must be refs/heads/track/${release}/${id}`);
    }
    const dependsOn = strings(track.depends_on, `${label}.depends_on`).map((dependency) => (
      identity(dependency, `${label}.depends_on`)
    ));
    const touchSurfaces = strings(track.touch_surfaces, `${label}.touch_surfaces`, {
      nonempty: true,
      pathValues: true,
    });
    for (const touch of touchSurfaces) {
      if (pathsOverlap(touch, root)) {
        fail('RECORD_ROOT_IN_PRODUCT_SCOPE', `${label} touch surface overlaps record root ${root}`);
      }
    }
    boundedArray(track.work, `${label}.work`, {
      nonempty: true,
      max: RECORD_LIMITS.work_per_track,
    });
    const work = track.work.map((item, workIndex) => {
      const parsed = validatePlanWork(item, `${label}.work[${workIndex}]`, root);
      for (const scopedPath of [...parsed.scope.include, ...parsed.scope.exclude]) {
        if (!touchSurfaces.some((touch) => pathContains(touch, scopedPath))) {
          fail(
            'WORK_OUTSIDE_TRACK_SCOPE',
            `${label}.work[${workIndex}] scope ${scopedPath} is outside track ${id} touch surfaces`,
          );
        }
      }
      for (const excluded of parsed.scope.exclude) {
        if (!parsed.scope.include.some((included) => pathContains(included, excluded))) {
          fail(
            'INVALID_WORK_SCOPE',
            `${label}.work[${workIndex}] exclude ${excluded} is not inside an included path`,
          );
        }
      }
      if (workIds.has(parsed.id)) fail('DUPLICATE_IDENTITY', `plan repeats work ${parsed.id}`);
      workIds.add(parsed.id);
      workTrack.set(parsed.id, id);
      workOrder.set(parsed.id, workIndex);
      return parsed;
    });
    return { id, ref, depends_on: dependsOn, touch_surfaces: touchSurfaces, work };
  });
  if (workIds.size > RECORD_LIMITS.work_total) {
    fail('RESOURCE_LIMIT', `plan exceeds maximum total work ${RECORD_LIMITS.work_total}`);
  }

  const trackEdges = new Map(tracks.map((track) => [track.id, track.depends_on]));
  for (const track of tracks) {
    for (const dependency of track.depends_on) {
      if (!trackIds.has(dependency)) fail('DANGLING_DEPENDENCY', `track ${track.id} depends on unknown ${dependency}`);
      if (dependency === track.id) fail('DEPENDENCY_CYCLE', `track ${track.id} depends on itself`);
    }
  }
  detectCycle(trackIds, trackEdges, 'DEPENDENCY_CYCLE', 'track graph');

  const workEdges = new Map();
  for (const track of tracks) {
    const closure = dependencyClosure(track.id, trackEdges);
    for (const work of track.work) {
      workEdges.set(work.id, work.depends_on);
      for (const dependency of work.depends_on) {
        if (!workIds.has(dependency)) {
          fail('DANGLING_DEPENDENCY', `work ${work.id} depends on unknown ${dependency}`);
        }
        const dependencyTrack = workTrack.get(dependency);
        if (dependencyTrack === track.id && workOrder.get(dependency) >= workOrder.get(work.id)) {
          fail('OUT_OF_ORDER_DEPENDENCY', `work ${work.id} depends on later work ${dependency}`);
        }
        if (dependencyTrack !== track.id && !closure.has(dependencyTrack)) {
          fail(
            'UNDECLARED_TRACK_DEPENDENCY',
            `work ${work.id} depends on ${dependency} without track dependency ${dependencyTrack}`,
          );
        }
      }
    }
  }
  detectCycle(workIds, workEdges, 'DEPENDENCY_CYCLE', 'work graph');

  for (let leftIndex = 0; leftIndex < tracks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tracks.length; rightIndex += 1) {
      const left = tracks[leftIndex];
      const right = tracks[rightIndex];
      const related = dependencyClosure(left.id, trackEdges).has(right.id)
        || dependencyClosure(right.id, trackEdges).has(left.id);
      if (related) continue;
      for (const leftWork of left.work) {
        for (const rightWork of right.work) {
          for (const leftPath of leftWork.scope.include) {
            for (const rightPath of rightWork.scope.include) {
              if (pathsOverlap(leftPath, rightPath)) {
                fail(
                  'PARALLEL_WORK_SCOPE_CONFLICT',
                  `independent work ${leftWork.id} and ${rightWork.id} overlap at ${leftPath} / ${rightPath}`,
                );
              }
            }
          }
        }
      }
      for (const leftPath of left.touch_surfaces) {
        for (const rightPath of right.touch_surfaces) {
          if (pathsOverlap(leftPath, rightPath)) {
            fail(
              'PARALLEL_TOUCH_CONFLICT',
              `independent tracks ${left.id} and ${right.id} overlap at ${leftPath} / ${rightPath}`,
            );
          }
        }
      }
    }
  }

  return {
    schema_version: PLAN_VERSION,
    release,
    repository,
    target_ref: targetRef,
    release_ref: releaseRef,
    record_root: root,
    approval_ref: approvalRef,
    tracks,
  };
}

export function parsePlanBytes(bytes) {
  const raw = Buffer.from(bytes);
  if (raw.byteLength > RECORD_LIMITS.plan_bytes) {
    fail('RESOURCE_LIMIT', `plan.md exceeds maximum size ${RECORD_LIMITS.plan_bytes} bytes`);
  }
  const text = decodeUTF8(raw, 'plan.md');
  if (!text.startsWith(PLAN_OPEN)) {
    fail('INVALID_PLAN_FENCE', 'plan.md must begin at byte zero with ```baton-plan-v1');
  }
  const close = text.indexOf(PLAN_CLOSE, PLAN_OPEN.length);
  if (close < 0) fail('INVALID_PLAN_FENCE', 'plan.md is missing the exact closing fence');
  const metadataText = text.slice(PLAN_OPEN.length, close);
  if (metadataText.length === 0) fail('INVALID_PLAN_METADATA', 'plan metadata is empty');
  const metadata = validatePlanMetadata(strictParseJSON(metadataText, 'plan metadata', {
    maxBytes: RECORD_LIMITS.plan_bytes,
  }));
  const digest = digestBytes(raw);
  const plan = {
    metadata: freezeNested(metadata),
    digest,
    markdown: text.slice(close + PLAN_CLOSE.length),
  };
  Object.defineProperty(plan, 'bytes', {
    enumerable: true,
    get() {
      return Buffer.from(raw);
    },
  });
  Object.freeze(plan);
  planAdmissions.set(plan, Object.freeze({
    digest,
    bytes: Buffer.from(raw),
  }));
  return plan;
}

export function requirePlanAdmission(plan) {
  const admission = (
    plan !== null
    && typeof plan === 'object'
    && planAdmissions.get(plan)
  );
  if (
    !admission
    || plan.digest !== admission.digest
    || digestBytes(admission.bytes) !== admission.digest
  ) {
    fail(
      'PLAN_ADMISSION_REQUIRED',
      'operation requires the immutable parsed plan bound to its exact raw digest',
    );
  }
  return admission;
}

function artifactRef(value, label) {
  string(value, label);
  if (/[\u0000-\u001f\u007f]/.test(value)) fail('INVALID_FIELD', `${label} contains a control character`);
  return value;
}

function validatePlanBinding(value) {
  exactKeys(value, ['digest', 'approval'], [], 'status.plan');
  digest(value.digest, 'status.plan.digest');
  exactKeys(value.approval, ['ref', 'digest'], [], 'status.plan.approval');
  artifactRef(value.approval.ref, 'status.plan.approval.ref');
  digest(value.approval.digest, 'status.plan.approval.digest');
}

function validateMaterialization(value) {
  exactKeys(value, ['base_commit', 'dependencies'], [], 'status.materialization');
  objectId(value.base_commit, 'status.materialization.base_commit');
  boundedArray(value.dependencies, 'status.materialization.dependencies', {
    max: RECORD_LIMITS.tracks,
  });
  const tracks = new Set();
  for (const [index, dependency] of value.dependencies.entries()) {
    const label = `status.materialization.dependencies[${index}]`;
    exactKeys(dependency, ['track_id', 'frozen_head'], [], label);
    const trackId = identity(dependency.track_id, `${label}.track_id`);
    objectId(dependency.frozen_head, `${label}.frozen_head`);
    if (tracks.has(trackId)) {
      fail('DUPLICATE_IDENTITY', `status.materialization repeats dependency ${trackId}`);
    }
    tracks.add(trackId);
  }
}

function validateDesign(value) {
  exactKeys(value, ['digest', 'producer_invocation'], [], 'status.design');
  digest(value.digest, 'status.design.digest');
  invocation(value.producer_invocation, 'status.design.producer_invocation');
}

function validateCaptain(value) {
  exactKeys(value, ['outcome', 'invocation', 'plan_digest', 'design_digest'], [], 'status.captain');
  if (!['proceed', 'revise', 'escalate'].includes(value.outcome)) {
    fail('INVALID_FIELD', 'status.captain.outcome is invalid');
  }
  invocation(value.invocation, 'status.captain.invocation');
  digest(value.plan_digest, 'status.captain.plan_digest');
  digest(value.design_digest, 'status.captain.design_digest');
}

function validateProof(value) {
  exactKeys(
    value,
    [
      'digest',
      'producer_invocation',
      'repository',
      'base_commit',
      'candidate_commit',
      'candidate_tree',
      'product_tree',
      'plan_digest',
      'approval_digest',
      'components',
    ],
    ['design_digest', 'captain_invocation'],
    'status.proof',
  );
  digest(value.digest, 'status.proof.digest');
  invocation(value.producer_invocation, 'status.proof.producer_invocation');
  string(value.repository, 'status.proof.repository', { max: 500 });
  objectId(value.base_commit, 'status.proof.base_commit');
  objectId(value.candidate_commit, 'status.proof.candidate_commit');
  objectId(value.candidate_tree, 'status.proof.candidate_tree');
  digest(value.product_tree, 'status.proof.product_tree');
  digest(value.plan_digest, 'status.proof.plan_digest');
  digest(value.approval_digest, 'status.proof.approval_digest');
  if (Object.hasOwn(value, 'design_digest')) digest(value.design_digest, 'status.proof.design_digest');
  if (Object.hasOwn(value, 'captain_invocation')) {
    invocation(value.captain_invocation, 'status.proof.captain_invocation');
  }
  boundedArray(value.components, 'status.proof.components', { max: RECORD_LIMITS.proof_components });
  const tracks = new Set();
  for (const [index, component] of value.components.entries()) {
    exactKeys(component, ['track_id', 'head'], [], `status.proof.components[${index}]`);
    identity(component.track_id, `status.proof.components[${index}].track_id`);
    objectId(component.head, `status.proof.components[${index}].head`);
    if (tracks.has(component.track_id)) {
      fail('DUPLICATE_IDENTITY', `status.proof repeats component ${component.track_id}`);
    }
    tracks.add(component.track_id);
  }
}

function validateVerification(value) {
  exactKeys(
    value,
    [
      'outcome',
      'invocation',
      'attestation_ref',
      'attestation_digest',
      'plan_digest',
      'proof_digest',
      'candidate_commit',
      'product_tree',
    ],
    [],
    'status.verification',
  );
  if (!['pass', 'fail', 'blocked'].includes(value.outcome)) {
    fail('INVALID_FIELD', 'status.verification.outcome is invalid');
  }
  invocation(value.invocation, 'status.verification.invocation');
  artifactRef(value.attestation_ref, 'status.verification.attestation_ref');
  digest(value.attestation_digest, 'status.verification.attestation_digest');
  digest(value.plan_digest, 'status.verification.plan_digest');
  digest(value.proof_digest, 'status.verification.proof_digest');
  objectId(value.candidate_commit, 'status.verification.candidate_commit');
  digest(value.product_tree, 'status.verification.product_tree');
}

function validateMerge(value) {
  exactKeys(
    value,
    [
      'scope',
      'passed_candidate',
      'expected_target',
      'outcome',
      'observed_target',
      'result_commit',
      'plan_digest',
      'verification_attestation_digest',
    ],
    ['frozen_track_head'],
    'status.merge',
  );
  if (!['track', 'release'].includes(value.scope)) fail('INVALID_FIELD', 'status.merge.scope is invalid');
  objectId(value.passed_candidate, 'status.merge.passed_candidate');
  if (Object.hasOwn(value, 'frozen_track_head')) {
    objectId(value.frozen_track_head, 'status.merge.frozen_track_head');
  }
  objectId(value.expected_target, 'status.merge.expected_target');
  if (value.outcome !== 'merged') fail('INVALID_FIELD', 'status.merge.outcome must be merged');
  objectId(value.observed_target, 'status.merge.observed_target');
  objectId(value.result_commit, 'status.merge.result_commit');
  digest(value.plan_digest, 'status.merge.plan_digest');
  digest(value.verification_attestation_digest, 'status.merge.verification_attestation_digest');
  if (value.observed_target !== value.expected_target) {
    fail('MOVED_TARGET', 'Merge observed target must equal its expected target');
  }
}

function present(value, key) {
  return Object.hasOwn(value, key);
}

function absent(value, keys, label) {
  for (const key of keys) {
    if (present(value, key)) fail('INVALID_STATE_BINDING', `${label} cannot contain ${key}`);
  }
}

function requirePresent(value, keys, label) {
  for (const key of keys) {
    if (!present(value, key)) fail('INVALID_STATE_BINDING', `${label} requires ${key}`);
  }
}

function projection(value) {
  return `${value.stage}/${value.status}/${value.next_role}`;
}

export function validateStatusSemantics(value, expected = {}) {
  exactKeys(
    value,
    [
      '$schema',
      'schema_version',
      'kind',
      'release',
      'owner_ref',
      'authority_ref',
      'target_ref',
      'plan',
      'stage',
      'status',
      'next_role',
      'outcome',
    ],
    [
      'work_id',
      'track_id',
      'materialization',
      'blocker',
      'design',
      'captain',
      'proof',
      'verification',
      'merge',
    ],
    'status',
  );
  if (value.$schema !== STATUS_SCHEMA) fail('INVALID_SCHEMA', `status.$schema must be ${STATUS_SCHEMA}`);
  if (value.schema_version !== STATUS_VERSION) {
    fail('INVALID_VERSION', `status.schema_version must be ${STATUS_VERSION}`);
  }
  if (!['work', 'assembly'].includes(value.kind)) fail('INVALID_FIELD', 'status.kind is invalid');
  identity(value.release, 'status.release');
  validateHeadRef(value.owner_ref, 'status.owner_ref');
  validateHeadRef(value.authority_ref, 'status.authority_ref');
  validateHeadRef(value.target_ref, 'status.target_ref');
  validatePlanBinding(value.plan);
  if (!['plan', 'design', 'implement', 'verify', 'merge'].includes(value.stage)) {
    fail('INVALID_FIELD', 'status.stage is invalid');
  }
  if (!['ready', 'blocked', 'complete'].includes(value.status)) {
    fail('INVALID_FIELD', 'status.status is invalid');
  }
  if (!['planner', 'implementer', 'captain', 'verifier', 'merge', 'none'].includes(value.next_role)) {
    fail('INVALID_FIELD', 'status.next_role is invalid');
  }
  if (!['none', 'proceed', 'revise', 'escalate', 'pass', 'fail', 'blocked', 'merged'].includes(value.outcome)) {
    fail('INVALID_FIELD', 'status.outcome is invalid');
  }
  if (value.status === 'blocked') {
    requirePresent(value, ['blocker'], 'blocked status');
    exactKeys(value.blocker, ['code', 'summary'], [], 'status.blocker');
    string(value.blocker.code, 'status.blocker.code', {
      max: 64,
      pattern: /^[a-z][a-z0-9_]{0,63}$/,
    });
    string(value.blocker.summary, 'status.blocker.summary');
  } else if (present(value, 'blocker')) {
    fail('INVALID_STATE_BINDING', 'only blocked status may contain blocker');
  }
  if (present(value, 'design')) validateDesign(value.design);
  if (present(value, 'materialization')) validateMaterialization(value.materialization);
  if (present(value, 'captain')) validateCaptain(value.captain);
  if (present(value, 'proof')) validateProof(value.proof);
  if (present(value, 'verification')) validateVerification(value.verification);
  if (present(value, 'merge')) validateMerge(value.merge);

  const releaseRef = `refs/heads/release-wt/${value.release}`;
  if (value.kind === 'work') {
    requirePresent(value, ['work_id', 'track_id'], 'work status');
    identity(value.work_id, 'status.work_id');
    identity(value.track_id, 'status.track_id');
    const trackRef = `refs/heads/track/${value.release}/${value.track_id}`;
    if (value.owner_ref !== trackRef) fail('INVALID_OWNER', `work owner_ref must be ${trackRef}`);
    if (![releaseRef, trackRef].includes(value.authority_ref)) {
      fail('INVALID_OWNER', 'work authority_ref must be its release baseline or owning track');
    }
    if (value.authority_ref === trackRef) {
      requirePresent(value, ['materialization'], 'materialised work');
    } else if (value.stage === 'merge' && value.status === 'complete') {
      requirePresent(value, ['materialization'], 'completed work');
    } else if (present(value, 'materialization')) {
      fail('INVALID_STATE_BINDING', 'release baseline work cannot claim materialization');
    }
    if (present(value, 'proof')) {
      requirePresent(value.proof, ['design_digest', 'captain_invocation'], 'work proof');
      if (value.proof.components.length !== 0) {
        fail('INVALID_STATE_BINDING', 'work proof cannot contain assembly components');
      }
    }
    if (present(value, 'merge') && value.merge.scope !== 'track') {
      fail('INVALID_STATE_BINDING', 'work Merge scope must be track');
    }
    if (present(value, 'merge') && !present(value.merge, 'frozen_track_head')) {
      fail('INVALID_STATE_BINDING', 'track Merge requires frozen_track_head');
    }
  } else {
    absent(value, ['work_id', 'track_id', 'materialization', 'design', 'captain'], 'assembly status');
    if (value.owner_ref !== releaseRef || value.authority_ref !== releaseRef) {
      fail('INVALID_OWNER', `assembly owner and authority refs must be ${releaseRef}`);
    }
    requirePresent(value, ['proof'], 'assembly status');
    if (present(value.proof, 'design_digest') || present(value.proof, 'captain_invocation')) {
      fail('INVALID_STATE_BINDING', 'assembly proof cannot bind one work design or Captain');
    }
    if (value.proof.components.length === 0) {
      fail('INVALID_STATE_BINDING', 'assembly proof requires composed track heads');
    }
    if (present(value, 'merge')) {
      if (value.merge.scope !== 'release') fail('INVALID_STATE_BINDING', 'assembly Merge scope must be release');
      if (present(value.merge, 'frozen_track_head')) {
        fail('INVALID_STATE_BINDING', 'release Merge cannot contain frozen_track_head');
      }
    }
    if (!['verify', 'merge'].includes(value.stage)) {
      fail('INVALID_STATE_BINDING', 'assembly status begins at verify');
    }
  }

  if (present(value, 'captain')) {
    requirePresent(value, ['design'], 'Captain gate');
    if (value.captain.plan_digest !== value.plan.digest) {
      fail('STALE_BINDING', 'Captain binds a stale plan');
    }
    if (value.captain.design_digest !== value.design.digest) {
      fail('STALE_BINDING', 'Captain binds a stale design');
    }
    if (value.captain.invocation === value.design.producer_invocation) {
      fail('SELF_REVIEW', 'Captain invocation equals design producer');
    }
  }
  if (present(value, 'proof')) {
    if (value.proof.plan_digest !== value.plan.digest) fail('STALE_BINDING', 'proof binds a stale plan');
    if (value.proof.approval_digest !== value.plan.approval.digest) {
      fail('STALE_BINDING', 'proof binds stale approval');
    }
    if (value.kind === 'work') {
      requirePresent(value, ['design', 'captain'], 'work proof');
      if (value.captain.outcome !== 'proceed') fail('MISSING_PROCEED', 'implementation requires Captain PROCEED');
      if (value.proof.design_digest !== value.design.digest) fail('STALE_BINDING', 'proof binds a stale design');
      if (value.proof.captain_invocation !== value.captain.invocation) {
        fail('STALE_BINDING', 'proof binds a stale Captain invocation');
      }
      if (value.proof.producer_invocation === value.captain.invocation) {
        fail('SELF_REVIEW', 'proof producer equals Captain invocation');
      }
    }
  }
  if (present(value, 'verification')) {
    requirePresent(value, ['proof'], 'verification');
    if (value.verification.plan_digest !== value.plan.digest) fail('STALE_BINDING', 'Verifier binds stale plan');
    if (value.verification.proof_digest !== value.proof.digest) fail('STALE_BINDING', 'Verifier binds stale proof');
    if (value.verification.candidate_commit !== value.proof.candidate_commit) {
      fail('STALE_BINDING', 'Verifier binds stale candidate');
    }
    if (value.verification.product_tree !== value.proof.product_tree) {
      fail('STALE_BINDING', 'Verifier binds stale product tree');
    }
    const forbiddenInvocations = new Set([value.proof.producer_invocation]);
    if (present(value, 'design')) forbiddenInvocations.add(value.design.producer_invocation);
    if (present(value, 'captain')) forbiddenInvocations.add(value.captain.invocation);
    if (forbiddenInvocations.has(value.verification.invocation)) {
      fail('SELF_REVIEW', 'Verifier invocation is not independent');
    }
  }
  if (present(value, 'merge')) {
    requirePresent(value, ['proof', 'verification'], 'Merge');
    if (value.verification.outcome !== 'pass') fail('UNVERIFIED_MERGE', 'Merge requires PASS');
    if (value.merge.passed_candidate !== value.proof.candidate_commit) {
      fail('STALE_BINDING', 'Merge binds stale candidate');
    }
    if (value.merge.plan_digest !== value.plan.digest) fail('STALE_BINDING', 'Merge binds stale plan');
    if (value.merge.verification_attestation_digest !== value.verification.attestation_digest) {
      fail('STALE_BINDING', 'Merge binds stale Verifier dispatch');
    }
  }

  const state = projection(value);
  const allowed = new Set();
  if (value.kind === 'work') {
    allowed.add('design/ready/implementer');
    allowed.add('design/ready/captain');
    allowed.add('design/blocked/planner');
    allowed.add('implement/ready/implementer');
  }
  allowed.add('verify/ready/verifier');
  if (value.kind === 'assembly') allowed.add('verify/ready/planner');
  allowed.add('verify/blocked/planner');
  allowed.add('merge/ready/merge');
  allowed.add('merge/complete/none');
  allowed.add('plan/blocked/planner');
  if (!allowed.has(state)) fail('INVALID_PROJECTION', `invalid durable projection ${state}`);

  if (state === 'design/ready/implementer') {
    absent(value, ['proof', 'verification', 'merge'], state);
    if (value.outcome === 'none') {
      absent(value, ['design', 'captain'], 'initial design state');
    } else if (value.outcome === 'revise') {
      requirePresent(value, ['design', 'captain'], 'revision state');
      if (value.captain.outcome !== 'revise') fail('INVALID_STATE_BINDING', 'revision requires Captain REVISE');
    } else {
      fail('INVALID_STATE_BINDING', `${state} outcome must be none or revise`);
    }
  } else if (state === 'design/ready/captain') {
    requirePresent(value, ['design'], state);
    absent(value, ['captain', 'proof', 'verification', 'merge'], state);
    if (value.outcome !== 'none') fail('INVALID_STATE_BINDING', `${state} outcome must be none`);
  } else if (state === 'design/blocked/planner') {
    requirePresent(value, ['design', 'captain', 'blocker'], state);
    absent(value, ['proof', 'verification', 'merge'], state);
    if (value.captain.outcome !== 'escalate' || value.outcome !== 'escalate') {
      fail('INVALID_STATE_BINDING', `${state} requires Captain ESCALATE`);
    }
  } else if (state === 'implement/ready/implementer') {
    requirePresent(value, ['design', 'captain'], state);
    absent(value, ['merge'], state);
    if (value.captain.outcome !== 'proceed') fail('INVALID_STATE_BINDING', `${state} requires PROCEED`);
    if (value.outcome === 'proceed') {
      absent(value, ['proof', 'verification'], 'first implementation state');
    } else if (value.outcome === 'fail') {
      requirePresent(value, ['proof', 'verification'], 'repair state');
      if (value.verification.outcome !== 'fail') fail('INVALID_STATE_BINDING', 'repair requires Verifier FAIL');
    } else {
      fail('INVALID_STATE_BINDING', `${state} outcome must be proceed or fail`);
    }
  } else if (state === 'verify/ready/verifier') {
    requirePresent(value, ['proof'], state);
    absent(value, ['verification', 'merge'], state);
    if (value.outcome !== 'none') fail('INVALID_STATE_BINDING', `${state} outcome must be none`);
  } else if (state === 'verify/ready/planner') {
    if (value.kind !== 'assembly') fail('INVALID_STATE_BINDING', `${state} is assembly-only`);
    requirePresent(value, ['proof', 'verification'], state);
    absent(value, ['merge', 'blocker'], state);
    if (value.verification.outcome !== 'fail' || value.outcome !== 'fail') {
      fail('INVALID_STATE_BINDING', `${state} requires Verifier FAIL`);
    }
  } else if (state === 'verify/blocked/planner') {
    requirePresent(value, ['proof', 'verification', 'blocker'], state);
    absent(value, ['merge'], state);
    if (value.verification.outcome !== 'blocked' || value.outcome !== 'blocked') {
      fail('INVALID_STATE_BINDING', `${state} requires Verifier BLOCKED`);
    }
  } else if (state === 'merge/ready/merge') {
    requirePresent(value, ['proof', 'verification'], state);
    absent(value, ['merge'], state);
    if (value.verification.outcome !== 'pass' || value.outcome !== 'pass') {
      fail('INVALID_STATE_BINDING', `${state} requires Verifier PASS`);
    }
  } else if (state === 'merge/complete/none') {
    requirePresent(value, ['proof', 'verification', 'merge'], state);
    if (value.status !== 'complete' || value.outcome !== 'merged') {
      fail('INVALID_STATE_BINDING', `${state} requires complete/merged`);
    }
    if (value.kind === 'work' && value.authority_ref !== releaseRef) {
      fail('INVALID_OWNER', 'completed work authority must transfer to release-wt');
    }
  } else if (state === 'plan/blocked/planner') {
    requirePresent(value, ['blocker'], state);
    absent(value, ['design', 'captain', 'proof', 'verification', 'merge'], state);
    if (value.outcome !== 'blocked') fail('INVALID_STATE_BINDING', `${state} outcome must be blocked`);
  }

  if (expected.planDigest && value.plan.digest !== expected.planDigest) {
    fail('STALE_BINDING', 'status does not bind the expected plan');
  }
  if (expected.approvalRef && value.plan.approval.ref !== expected.approvalRef) {
    fail('STALE_BINDING', 'status does not bind the expected approval reference');
  }
  if (expected.approvalDigest && value.plan.approval.digest !== expected.approvalDigest) {
    fail('STALE_BINDING', 'status does not bind the expected approval digest');
  }
  if (expected.designDigest && value.design?.digest !== expected.designDigest) {
    fail('STALE_BINDING', 'status does not bind the expected design');
  }
  if (expected.proofDigest && value.proof?.digest !== expected.proofDigest) {
    fail('STALE_BINDING', 'status does not bind the expected proof');
  }
  return value;
}

export function parseStatusBytes(bytes, expected = {}) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return validateStatusSemantics(
    strictParseJSON(raw, 'status.json', { maxBytes: RECORD_LIMITS.status_bytes }),
    expected,
  );
}

function resolveTrustedEvidence(resolveEvidence, request) {
  if (typeof resolveEvidence !== 'function') {
    fail('EVIDENCE_RESOLVER_REQUIRED', 'trusted admission requires an evidence resolver');
  }
  let result;
  try {
    result = resolveEvidence(Object.freeze({ ...request }));
  } catch (error) {
    throw new RecordError(
      'UNRESOLVED_EVIDENCE',
      `cannot resolve ${request.kind} evidence ${request.ref}`,
      error,
    );
  }
  if (
    !result
    || typeof result !== 'object'
    || Array.isArray(result)
    || !isDeepStrictEqual(Object.keys(result).sort(), ['bytes', 'provenance'])
    || !Object.hasOwn(result, 'bytes')
    || !result.provenance
    || typeof result.provenance !== 'object'
  ) {
    fail('UNRESOLVED_EVIDENCE', `resolver returned no trusted ${request.kind} evidence`);
  }
  if (
    typeof result.bytes !== 'string'
    && !Buffer.isBuffer(result.bytes)
    && !(result.bytes instanceof Uint8Array)
  ) {
    fail('UNRESOLVED_EVIDENCE', `${request.kind} evidence bytes have an invalid type`);
  }
  const evidenceBytes = Buffer.from(result.bytes);
  if (evidenceBytes.byteLength > RECORD_LIMITS.evidence_bytes) {
    fail(
      'RESOURCE_LIMIT',
      `${request.kind} evidence exceeds maximum size ${RECORD_LIMITS.evidence_bytes} bytes`,
    );
  }
  const provenance = frozenCopy(result.provenance);
  const resolvedRef = provenance.ref;
  if (
    provenance.kind !== request.kind
    || resolvedRef !== request.ref
    || digestBytes(evidenceBytes) !== request.digest
  ) {
    fail('EVIDENCE_BINDING_MISMATCH', `${request.kind} evidence does not match its recorded ref and digest`);
  }
  return provenance;
}

function validateApprovalProvenance(provenance, status, profile) {
  exactKeys(
    provenance,
    [
      'kind',
      'ref',
      'protected',
      'decision',
      'plan_digest',
      'authorizer_isolated',
      'delivery_writable',
    ],
    [],
    'approval provenance',
  );
  if (
    provenance.kind !== 'approval'
    || provenance.ref !== status.plan.approval.ref
    || provenance.protected !== true
    || provenance.decision !== 'approved'
    || provenance.plan_digest !== status.plan.digest
    || provenance.authorizer_isolated !== true
    || provenance.delivery_writable !== false
  ) {
    fail('UNTRUSTED_EVIDENCE_PROVENANCE', 'approval provenance does not establish protected approval');
  }
  artifactRef(provenance.ref, 'approval provenance.ref');
  digest(provenance.plan_digest, 'approval provenance.plan_digest');
}

function validateDispatchProvenance(provenance, status, profile) {
  exactKeys(
    provenance,
    [
      'kind',
      'ref',
      'protected',
      'role',
      'fresh_context',
      'read_only',
      'invocation',
      'plan_digest',
      'proof_digest',
      'candidate_commit',
      'product_tree',
    ],
    ['engine_controlled'],
    'Verifier dispatch provenance',
  );
  if (
    provenance.kind !== 'verifier_dispatch'
    || provenance.ref !== status.verification.attestation_ref
    || provenance.protected !== true
    || provenance.role !== 'verifier'
    || provenance.fresh_context !== true
    || provenance.read_only !== true
    || provenance.invocation !== status.verification.invocation
    || provenance.plan_digest !== status.plan.digest
    || provenance.proof_digest !== status.proof.digest
    || provenance.candidate_commit !== status.proof.candidate_commit
    || provenance.product_tree !== status.proof.product_tree
    || (profile === 'autonomous' && provenance.engine_controlled !== true)
  ) {
    fail('UNTRUSTED_EVIDENCE_PROVENANCE', 'Verifier dispatch provenance is not exact');
  }
  artifactRef(provenance.ref, 'Verifier dispatch provenance.ref');
  invocation(provenance.invocation, 'Verifier dispatch provenance.invocation');
  digest(provenance.plan_digest, 'Verifier dispatch provenance.plan_digest');
  digest(provenance.proof_digest, 'Verifier dispatch provenance.proof_digest');
  objectId(provenance.candidate_commit, 'Verifier dispatch provenance.candidate_commit');
  digest(provenance.product_tree, 'Verifier dispatch provenance.product_tree');
}

function freezeNested(value) {
  const seen = new WeakSet();
  function freezeValue(item, depth = 0) {
    if (item === null || typeof item !== 'object' || Object.isFrozen(item)) return item;
    if (depth > RECORD_LIMITS.json_depth) fail('RESOURCE_LIMIT', 'trusted object exceeds maximum depth');
    if (seen.has(item)) return item;
    seen.add(item);
    for (const nested of Object.values(item)) freezeValue(nested, depth + 1);
    return Object.freeze(item);
  }
  return freezeValue(value);
}

function frozenCopy(value) {
  return freezeNested(structuredClone(value));
}

/**
 * Convert a structurally valid durable status into a guided/autonomous trusted
 * admission. The resolver is the single external seam: it must return the
 * exact bytes plus protected provenance for the requested ref.
 */
export function resolveStatusEvidence(status, { profile, resolveEvidence } = {}) {
  validateStatusSemantics(status);
  if (!['guided', 'autonomous'].includes(profile)) {
    fail('INVALID_ADMISSION_PROFILE', 'trusted admission profile must be guided or autonomous');
  }
  const approval = resolveTrustedEvidence(resolveEvidence, {
    kind: 'approval',
    ref: status.plan.approval.ref,
    digest: status.plan.approval.digest,
    plan_digest: status.plan.digest,
  });
  validateApprovalProvenance(approval, status, profile);

  let verification;
  if (status.verification) {
    verification = resolveTrustedEvidence(resolveEvidence, {
      kind: 'verifier_dispatch',
      ref: status.verification.attestation_ref,
      digest: status.verification.attestation_digest,
      invocation: status.verification.invocation,
      plan_digest: status.plan.digest,
      proof_digest: status.proof.digest,
      candidate_commit: status.proof.candidate_commit,
      product_tree: status.proof.product_tree,
    });
    validateDispatchProvenance(verification, status, profile);
  }
  const admittedStatus = frozenCopy(status);
  const admission = Object.freeze({
    kind: 'baton.evidence-admission/v1',
    profile,
    status: admittedStatus,
    approval,
    verification: verification
      ? verification
      : null,
  });
  evidenceAdmissions.add(admission);
  return admission;
}

export function requireEvidenceAdmission(status, admission, profile) {
  if (
    !admission
    || !evidenceAdmissions.has(admission)
    || admission.kind !== 'baton.evidence-admission/v1'
    || admission.profile !== profile
    || !isDeepStrictEqual(admission.status, status)
  ) {
    fail(
      'EVIDENCE_ADMISSION_REQUIRED',
      'action requires a matching status evidence admission for the selected profile',
    );
  }
  return admission;
}

export function findTrack(plan, trackId) {
  const track = plan.metadata.tracks.find((candidate) => candidate.id === trackId);
  if (!track) fail('UNKNOWN_TRACK', `plan has no track ${trackId}`);
  return track;
}

export function findWork(plan, workId) {
  for (const track of plan.metadata.tracks) {
    const work = track.work.find((candidate) => candidate.id === workId);
    if (work) return { track, work };
  }
  fail('UNKNOWN_WORK', `plan has no work ${workId}`);
}

export function workStatusPath(plan, workId) {
  return `${plan.metadata.record_root}/${plan.metadata.release}/work/${workId}/status.json`;
}

export function workDesignPath(plan, workId) {
  return `${plan.metadata.record_root}/${plan.metadata.release}/work/${workId}/design.md`;
}

export function workProofPath(plan, workId) {
  return `${plan.metadata.record_root}/${plan.metadata.release}/work/${workId}/proof.md`;
}

export function assemblyStatusPath(plan) {
  return `${plan.metadata.record_root}/${plan.metadata.release}/assembly/status.json`;
}

export function assemblyProofPath(plan) {
  return `${plan.metadata.record_root}/${plan.metadata.release}/assembly/proof.md`;
}

export function releasePlanPath(plan) {
  return `${plan.metadata.record_root}/${plan.metadata.release}/plan.md`;
}

export function validatePristineRecordNamespace(
  repo,
  plan,
  head,
  {
    recordRootAdmission,
    expectAbsent = false,
  } = {},
) {
  requirePlanAdmission(plan);
  if (typeof expectAbsent !== 'boolean') {
    fail('INVALID_NAMESPACE_EXPECTATION', 'expectAbsent must be one boolean');
  }
  const prefix = `${plan.metadata.record_root}/${plan.metadata.release}`;
  const entries = readRecordTreeAtOID(repo, head, recordRootAdmission, prefix);
  const expectedPaths = expectAbsent
    ? []
    : [
      releasePlanPath(plan),
      ...plan.metadata.tracks.flatMap((track) => (
        track.work.map((work) => workStatusPath(plan, work.id))
      )),
    ].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const observedPaths = entries
    .map((entry) => entry.path)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (
    !isDeepStrictEqual(observedPaths, expectedPaths)
    || entries.some((entry) => entry.mode !== '100644' || entry.type !== 'blob')
  ) {
    fail(
      'UNBOUND_RECORD_NAMESPACE',
      `${prefix} contains files outside its exact pristine plan namespace`,
    );
  }
  return Object.freeze({
    head,
    prefix,
    paths: Object.freeze(observedPaths),
  });
}

export function validateHandoffDigestAtRef(repo, ref, relativePath, expectedDigest) {
  repositoryPath(relativePath, 'handoff path', { allowRoot: false });
  digest(expectedDigest, 'handoff digest');
  const bytes = readFileAtOID(repo, ref, relativePath);
  const observed = digestBytes(bytes);
  if (observed !== expectedDigest) {
    fail('STALE_BINDING', `${relativePath} digest is ${observed}, expected ${expectedDigest}`);
  }
  return { path: relativePath, digest: observed, bytes };
}

export function validateStatusHandoffsAtRef(repo, plan, status, ref) {
  validateStatusSemantics(status, {
    planDigest: plan.digest,
    approvalRef: plan.metadata.approval_ref,
  });
  assertRecordRootAtRef(repo, ref, plan.metadata.record_root);
  const result = {};
  if (status.design) {
    result.design = validateHandoffDigestAtRef(
      repo,
      ref,
      workDesignPath(plan, status.work_id),
      status.design.digest,
    );
  }
  if (status.proof) {
    result.proof = validateHandoffDigestAtRef(
      repo,
      ref,
      status.kind === 'work'
        ? workProofPath(plan, status.work_id)
        : assemblyProofPath(plan),
      status.proof.digest,
    );
  }
  return result;
}

export function validateCapturedStatusHandoffs(plan, status, handoffs) {
  requirePlanAdmission(plan);
  validateStatusSemantics(status, {
    planDigest: plan.digest,
    approvalRef: plan.metadata.approval_ref,
  });
  if (!Array.isArray(handoffs)) {
    fail('INVALID_RECORD_SNAPSHOT', 'captured handoffs must be one immutable batch');
  }
  const observed = new Map();
  for (const [index, handoff] of handoffs.entries()) {
    if (
      handoff === null
      || typeof handoff !== 'object'
      || Array.isArray(handoff)
      || !isDeepStrictEqual(Object.keys(handoff).sort(), ['digest', 'path'])
      || typeof handoff.path !== 'string'
      || !DIGEST_PATTERN.test(handoff.digest)
      || observed.has(handoff.path)
    ) {
      fail('INVALID_RECORD_SNAPSHOT', `captured handoff ${index} is invalid`);
    }
    observed.set(handoff.path, handoff.digest);
  }
  const result = {};
  const admit = (name, relativePath, expectedDigest) => {
    const observedDigest = observed.get(relativePath);
    if (observedDigest !== expectedDigest) {
      fail(
        'STALE_BINDING',
        `${relativePath} digest is ${observedDigest ?? 'missing'}, expected ${expectedDigest}`,
      );
    }
    result[name] = { path: relativePath, digest: observedDigest };
  };
  if (status.design) {
    admit(
      'design',
      workDesignPath(plan, status.work_id),
      status.design.digest,
    );
  }
  if (status.proof) {
    admit(
      'proof',
      status.kind === 'work'
        ? workProofPath(plan, status.work_id)
        : assemblyProofPath(plan),
      status.proof.digest,
    );
  }
  return result;
}

export function validateWorkStatusIdentity(status, plan, track, work) {
  if (
    status.kind !== 'work'
    || status.release !== plan.metadata.release
    || status.work_id !== work.id
    || status.track_id !== track.id
    || status.owner_ref !== track.ref
    || status.target_ref !== plan.metadata.target_ref
  ) {
    fail('STATUS_IDENTITY_MISMATCH', `status identity does not match plan work ${work.id}`);
  }
  validateStatusSemantics(status, {
    planDigest: plan.digest,
    approvalRef: plan.metadata.approval_ref,
  });
}

function readBoundStatus(repo, ref, relativePath, plan, track, work) {
  let bytes;
  try {
    assertRecordRootAtRef(repo, ref, plan.metadata.record_root);
    bytes = readFileAtOID(repo, ref, relativePath);
  } catch (error) {
    if (error instanceof GitRecordError) {
      throw new RecordError('AUTHORITATIVE_STATUS_MISSING', `missing ${relativePath} at ${ref}`, error);
    }
    throw error;
  }
  const status = parseStatusBytes(bytes);
  validateWorkStatusIdentity(status, plan, track, work);
  return { bytes, status };
}

export function captureRefSnapshot(repo, plan) {
  requirePlanAdmission(plan);
  const requested = [
    plan.metadata.target_ref,
    plan.metadata.release_ref,
    ...plan.metadata.tracks.map((track) => track.ref),
  ];
  const captured = captureHeadRefs(repo, requested);
  const [target, release, ...capturedTracks] = captured;
  if (target.head === null || release.head === null) {
    fail('REF_NOT_FOUND', 'target and release refs must exist when a snapshot is captured');
  }
  const snapshot = Object.freeze({
    release,
    target,
    tracks: Object.freeze(plan.metadata.tracks.map((track, index) => Object.freeze({
      id: track.id,
      ref: track.ref,
      head: capturedTracks[index].head,
    }))),
  });
  refSnapshots.set(snapshot, plan.digest);
  return snapshot;
}

export function validateRefSnapshot(plan, snapshot) {
  requirePlanAdmission(plan);
  if (
    !snapshot
    || refSnapshots.get(snapshot) !== plan.digest
    || snapshot.release?.ref !== plan.metadata.release_ref
    || snapshot.target?.ref !== plan.metadata.target_ref
    || !Array.isArray(snapshot.tracks)
  ) {
    fail('INVALID_SNAPSHOT', 'operation requires one captured plan-ref snapshot');
  }
  objectId(snapshot.release.head, 'snapshot.release.head');
  objectId(snapshot.target.head, 'snapshot.target.head');
  for (const [index, track] of plan.metadata.tracks.entries()) {
    const entry = snapshot.tracks[index];
    if (!entry || entry.ref !== track.ref || (entry.head !== null && !OBJECT_PATTERN.test(entry.head))) {
      fail('INVALID_SNAPSHOT', `snapshot does not bind track ${track.id}`);
    }
  }
  return snapshot;
}

/**
 * Mint a plan-bound prospective snapshot from one admitted captured snapshot.
 * This is used only to validate prepared immutable commit OIDs before a ref
 * transaction. It does not claim that any ref has moved.
 */
export function deriveProspectiveRefSnapshot(plan, snapshot, overrides) {
  validateRefSnapshot(plan, snapshot);
  if (!Array.isArray(overrides) || overrides.length === 0) {
    fail('INVALID_SNAPSHOT', 'prospective snapshot requires at least one exact head override');
  }
  const admittedRefs = new Set([
    plan.metadata.target_ref,
    plan.metadata.release_ref,
    ...plan.metadata.tracks.map((track) => track.ref),
  ]);
  const heads = new Map();
  for (const [index, override] of overrides.entries()) {
    if (
      override === null
      || typeof override !== 'object'
      || Array.isArray(override)
      || !isDeepStrictEqual(Object.keys(override).sort(), ['head', 'ref'])
      || !admittedRefs.has(override.ref)
      || (override.head !== null && !OBJECT_PATTERN.test(override.head))
      || heads.has(override.ref)
    ) {
      fail('INVALID_SNAPSHOT', `prospective snapshot override ${index} is not one exact plan ref`);
    }
    heads.set(override.ref, override.head);
  }
  const replace = (entry) => Object.freeze({
    ref: entry.ref,
    head: heads.has(entry.ref) ? heads.get(entry.ref) : entry.head,
  });
  const prospective = Object.freeze({
    release: replace(snapshot.release),
    target: replace(snapshot.target),
    tracks: Object.freeze(plan.metadata.tracks.map((track, index) => Object.freeze({
      id: track.id,
      ...replace(snapshot.tracks[index]),
    }))),
  });
  refSnapshots.set(prospective, plan.digest);
  return prospective;
}

export function trackRefSnapshot(snapshot, trackId) {
  const entry = snapshot?.tracks?.find((track) => track.id === trackId);
  if (!entry) fail('INVALID_SNAPSHOT', `snapshot does not bind track ${trackId}`);
  return entry;
}

function parsePlannedWorkStatusFiles(plan, head, plannedWork, files) {
  return Object.freeze(files.map((file, index) => {
    const { track, work } = plannedWork[index];
    if (file.bytes === null) {
      fail('AUTHORITATIVE_STATUS_MISSING', `missing ${file.path} at captured head ${head}`);
    }
    const status = parseStatusBytes(file.bytes, {
      planDigest: plan.digest,
      approvalRef: plan.metadata.approval_ref,
    });
    validateWorkStatusIdentity(status, plan, track, work);
    return Object.freeze({ work_id: work.id, status: frozenCopy(status) });
  }));
}

function parsedStatusBatch(repo, plan, head, plannedWork) {
  const paths = plannedWork.map(({ work }) => workStatusPath(plan, work.id));
  return parsePlannedWorkStatusFiles(
    plan,
    head,
    plannedWork,
    readFilesAtOID(repo, head, paths),
  );
}

function parsedReleaseBatch(repo, plan, head, plannedWork) {
  const paths = plannedWork.flatMap(({ work }) => [
    workStatusPath(plan, work.id),
    workDesignPath(plan, work.id),
    workProofPath(plan, work.id),
  ]);
  paths.push(assemblyStatusPath(plan), assemblyProofPath(plan));
  const files = readReleaseProjectionFilesAtOID(repo, head, paths);
  const statusFiles = plannedWork.map((ignored, index) => files[index * 3]);
  const handoffs = [];
  for (let index = 0; index < plannedWork.length; index += 1) {
    for (const file of [files[(index * 3) + 1], files[(index * 3) + 2]]) {
      if (file.bytes !== null) {
        handoffs.push(Object.freeze({
          path: file.path,
          digest: digestBytes(file.bytes),
        }));
      }
    }
  }
  const assemblyFile = files.at(-2);
  const assemblyProofFile = files.at(-1);
  let assembly = null;
  if (assemblyFile.bytes !== null) {
    const status = parseStatusBytes(assemblyFile.bytes, {
      planDigest: plan.digest,
      approvalRef: plan.metadata.approval_ref,
    });
    if (
      status.kind !== 'assembly'
      || status.release !== plan.metadata.release
      || status.owner_ref !== plan.metadata.release_ref
      || status.authority_ref !== plan.metadata.release_ref
      || status.target_ref !== plan.metadata.target_ref
    ) {
      fail('STATUS_IDENTITY_MISMATCH', 'assembly status does not match the approved release');
    }
    assembly = frozenCopy(status);
  }
  if (assemblyProofFile.bytes !== null) {
    handoffs.push(Object.freeze({
      path: assemblyProofFile.path,
      digest: digestBytes(assemblyProofFile.bytes),
    }));
  }
  return Object.freeze({
    statuses: parsePlannedWorkStatusFiles(
      plan,
      head,
      plannedWork,
      statusFiles,
    ),
    assembly,
    handoffs: Object.freeze(handoffs),
  });
}

function capturedFirstParentHistory(repo, base, head, label) {
  const rendered = runGit(
    repo,
    [
      'rev-list',
      '--first-parent',
      '--parents',
      '--reverse',
      '--max-count=10001',
      `${base}..${head}`,
    ],
    { label },
  ).trim();
  const lines = rendered === '' ? [] : rendered.split('\n');
  if (lines.length > 10_000) {
    fail('RESOURCE_LIMIT', `${label} exceeds 10000 commits`);
  }
  const history = lines.map((line) => {
    const [commit, ...parents] = line.split(' ');
    if (
      !OBJECT_PATTERN.test(commit)
      || parents.length === 0
      || parents.some((parent) => !OBJECT_PATTERN.test(parent))
    ) {
      fail('MALFORMED_GIT_OUTPUT', `${label} is malformed`);
    }
    return { commit, parents };
  });
  let expectedParent = base;
  for (const entry of history) {
    if (entry.parents[0] !== expectedParent) {
      fail('INVALID_CANDIDATE_ANCESTRY', `${label} does not descend from its exact base`);
    }
    expectedParent = entry.commit;
  }
  if (history.length > 0 && history.at(-1).commit !== head) {
    fail('INVALID_CANDIDATE_ANCESTRY', `${label} does not reach its exact head`);
  }
  return history;
}

function parsedOwnerProjectionBatch(repo, plan, head, plannedWork) {
  const paths = plannedWork.flatMap(({ work }) => [
    workStatusPath(plan, work.id),
    workDesignPath(plan, work.id),
    workProofPath(plan, work.id),
  ]);
  const files = readFilesAtOID(repo, head, paths);
  const statusFiles = plannedWork.map((ignored, index) => files[index * 3]);
  const handoffs = [];
  for (let index = 0; index < plannedWork.length; index += 1) {
    for (const file of [files[(index * 3) + 1], files[(index * 3) + 2]]) {
      if (file.bytes !== null) {
        handoffs.push(Object.freeze({
          path: file.path,
          digest: digestBytes(file.bytes),
        }));
      }
    }
  }
  return Object.freeze({
    statuses: parsePlannedWorkStatusFiles(plan, head, plannedWork, statusFiles),
    handoffs: Object.freeze(handoffs),
  });
}

function validateOwnerMarker(
  repo,
  plan,
  track,
  ownerHead,
  releaseHead,
  statuses,
  recordRootAdmission,
) {
  const first = statuses[0]?.status;
  if (!first?.materialization) {
    fail('INVALID_OWNER_MARKER', `track ${track.id} has no durable materialization`);
  }
  const materialization = first.materialization;
  for (const entry of statuses) {
    if (
      entry.status.authority_ref !== track.ref
      || !isDeepStrictEqual(entry.status.materialization, materialization)
    ) {
      fail('INVALID_OWNER_MARKER', `track ${track.id} does not share one materialization`);
    }
  }
  validateMaterializationEvidence(repo, plan, track.id, materialization);
  const history = capturedFirstParentHistory(
    repo,
    materialization.base_commit,
    ownerHead,
    `materialization lineage for ${track.id}`,
  );
  if (history.length === 0) {
    fail('INVALID_OWNER_MARKER', `track ${track.id} has no materialization marker commit`);
  }
  const marker = history[0].commit;
  const statusPaths = track.work.map((work) => workStatusPath(plan, work.id));
  assertStructuralRecordOnlyTransition(
    repo,
    materialization.base_commit,
    marker,
    recordRootAdmission,
    statusPaths,
  );
  if (!isAncestor(repo, marker, releaseHead)) {
    fail('INVALID_OWNER_MARKER', `track ${track.id} marker is not retained by the release`);
  }
  const markerStatuses = marker === ownerHead
    ? statuses
    : parsedStatusBatch(
      repo,
      plan,
      marker,
      track.work.map((work) => ({ track, work })),
    );
  for (const [index, entry] of markerStatuses.entries()) {
    if (
      entry.status.authority_ref !== track.ref
      || !isDeepStrictEqual(entry.status.materialization, materialization)
      || projection(entry.status) !== 'design/ready/implementer'
      || entry.status.outcome !== 'none'
    ) {
      fail('INVALID_OWNER_MARKER', `track ${track.id}/${track.work[index].id} marker is not pristine`);
    }
  }
  return marker;
}

function assertNoErasedOwnerMarker(repo, plan, track, releaseHead) {
  const statusPaths = track.work.map((work) => workStatusPath(plan, work.id));
  const rendered = runGit(
    repo,
    [
      'rev-list',
      '--first-parent',
      '--max-count=10001',
      releaseHead,
      '--',
      ...statusPaths,
    ],
    { label: `inspect materialization lineage for ${track.id}` },
  ).trim();
  const commits = rendered ? rendered.split('\n') : [];
  if (commits.length > 10_000) {
    fail('RESOURCE_LIMIT', `release lineage for ${track.id} exceeds 10000 record commits`);
  }
  for (const commit of commits) {
    let statuses;
    try {
      statuses = parsedStatusBatch(
        repo,
        plan,
        commit,
        track.work.map((work) => ({ track, work })),
      );
    } catch (error) {
      if (
        error instanceof RecordError
        && ['AUTHORITATIVE_STATUS_MISSING', 'STALE_BINDING', 'STATUS_IDENTITY_MISMATCH']
          .includes(error.code)
      ) {
        continue;
      }
      throw error;
    }
    const materialization = statuses[0]?.status.materialization;
    if (
      materialization
      && statuses.every((entry) => (
        entry.status.authority_ref === track.ref
        && isDeepStrictEqual(entry.status.materialization, materialization)
      ))
    ) {
      fail(
        'ERASED_OWNER_MARKER',
        `track ${track.id} was materialized in release history but its owner is absent`,
      );
    }
  }
}

/**
 * Read every authoritative status with one bounded Git batch per captured ref.
 * This is a structural/authority snapshot for projections; it is deliberately
 * not a guided or autonomous trusted admission.
 */
export function readAuthoritativeRecordSnapshot(
  repo,
  plan,
  snapshot,
  { recordRootAdmission } = {},
) {
  validateRefSnapshot(plan, snapshot);
  const allWork = plan.metadata.tracks.flatMap((track) => (
    track.work.map((work) => ({ track, work }))
  ));
  const releaseBatch = parsedReleaseBatch(repo, plan, snapshot.release.head, allWork);
  const refs = [{
    ref: snapshot.release.ref,
    head: snapshot.release.head,
    track_id: null,
    contained_in_release: true,
    statuses: releaseBatch.statuses,
    assembly: releaseBatch.assembly,
    handoffs: releaseBatch.handoffs,
  }];
  for (const track of plan.metadata.tracks) {
    const captured = trackRefSnapshot(snapshot, track.id);
    if (captured.head === null) {
      assertNoErasedOwnerMarker(repo, plan, track, snapshot.release.head);
      continue;
    }
    const ownerBatch = parsedOwnerProjectionBatch(
      repo,
      plan,
      captured.head,
      track.work.map((work) => ({ track, work })),
    );
    const { statuses } = ownerBatch;
    refs.push({
      ref: captured.ref,
      head: captured.head,
      track_id: track.id,
      contained_in_release: isAncestor(repo, captured.head, snapshot.release.head),
      materialization_marker: validateOwnerMarker(
        repo,
        plan,
        track,
        captured.head,
        snapshot.release.head,
        statuses,
        recordRootAdmission,
      ),
      statuses,
      handoffs: ownerBatch.handoffs,
    });
  }
  const result = Object.freeze({
    kind: 'baton.structural-authority-snapshot/v1',
    plan_digest: plan.digest,
    ref_snapshot: snapshot,
    refs: Object.freeze(refs.map((entry) => Object.freeze(entry))),
  });
  recordSnapshots.set(result, plan.digest);
  return result;
}

export function selectAuthoritativeStatusFromSnapshot(plan, workId, records) {
  requirePlanAdmission(plan);
  if (
    !records
    || recordSnapshots.get(records) !== plan.digest
    || records.plan_digest !== plan.digest
    || records.kind !== 'baton.structural-authority-snapshot/v1'
  ) {
    fail('INVALID_RECORD_SNAPSHOT', 'selection requires one captured structural-authority snapshot');
  }
  const { track, work } = findWork(plan, workId);
  const release = records.refs[0];
  const releaseStatus = release.statuses.find((entry) => entry.work_id === work.id)?.status;
  if (!releaseStatus) fail('AUTHORITATIVE_STATUS_MISSING', `release snapshot lacks ${work.id}`);
  const owner = records.refs.find((entry) => entry.track_id === track.id);
  if (!owner) {
    assertPristineBaseline(releaseStatus, plan.metadata.release_ref, workId);
    return Object.freeze({
      ref: release.ref,
      head: release.head,
      source: 'baseline',
      status: releaseStatus,
      handoffs: release.handoffs,
    });
  }
  const ownerStatus = owner.statuses.find((entry) => entry.work_id === work.id)?.status;
  if (!ownerStatus) fail('AUTHORITATIVE_STATUS_MISSING', `owner snapshot lacks ${work.id}`);
  if (ownerStatus.authority_ref !== track.ref) {
    fail('INVALID_OWNER', `materialised work ${workId} must use owning-track authority`);
  }
  if (
    releaseStatus.stage === 'merge'
    && releaseStatus.status === 'complete'
    && releaseStatus.merge?.scope === 'track'
    && releaseStatus.authority_ref === plan.metadata.release_ref
  ) {
    if (
      releaseStatus.merge.frozen_track_head !== owner.head
      || owner.contained_in_release !== true
    ) {
      fail('INVALID_AUTHORITY_TRANSFER', `release status for ${workId} does not prove exact track composition`);
    }
    return Object.freeze({
      ref: release.ref,
      head: release.head,
      source: 'composed',
      status: releaseStatus,
      handoffs: release.handoffs,
    });
  }
  return Object.freeze({
    ref: owner.ref,
    head: owner.head,
    source: 'owner',
    status: ownerStatus,
    handoffs: owner.handoffs,
  });
}

export function selectAssemblyFromSnapshot(plan, records) {
  requirePlanAdmission(plan);
  if (
    !records
    || recordSnapshots.get(records) !== plan.digest
    || records.plan_digest !== plan.digest
    || records.kind !== 'baton.structural-authority-snapshot/v1'
  ) {
    fail('INVALID_RECORD_SNAPSHOT', 'selection requires one captured structural-authority snapshot');
  }
  const release = records.refs[0];
  if (release.assembly === null) return null;
  return Object.freeze({
    ref: release.ref,
    head: release.head,
    source: 'release',
    status: release.assembly,
    handoffs: release.handoffs,
  });
}

function assertPristineBaseline(status, releaseRef, workId) {
  if (
    status.authority_ref !== releaseRef
    || projection(status) !== 'design/ready/implementer'
    || status.outcome !== 'none'
    || [
      'materialization',
      'blocker',
      'design',
      'captain',
      'proof',
      'verification',
      'merge',
    ].some((field) => present(status, field))
  ) {
    fail(
      'INVALID_BASELINE',
      `work ${workId} without a captured owner must have one pristine release baseline`,
    );
  }
}

export function selectAuthoritativeStatus(
  repo,
  plan,
  workId,
  snapshot,
  { recordRootAdmission } = {},
) {
  return selectAuthoritativeStatusFromSnapshot(
    plan,
    workId,
    readAuthoritativeRecordSnapshot(repo, plan, snapshot, {
      recordRootAdmission,
    }),
  );
}

export function expectedTrackMaterialization(repo, plan, trackId, snapshot) {
  validateRefSnapshot(plan, snapshot);
  const track = findTrack(plan, trackId);
  const exactReleaseHead = snapshot.release.head;
  const capturedPlan = parsePlanBytes(readFileAtOID(repo, exactReleaseHead, releasePlanPath(plan)));
  if (capturedPlan.digest !== plan.digest) {
    fail('STALE_BINDING', 'materialization base does not contain the exact approved plan');
  }
  const dependencies = [];
  for (const dependencyId of track.depends_on) {
    const dependency = findTrack(plan, dependencyId);
    const dependencyHead = trackRefSnapshot(snapshot, dependencyId).head;
    if (dependencyHead === null) {
      fail('UNMET_TRACK_DEPENDENCY', `dependency ${dependency.id} has no captured owner head`);
    }
    if (!isAncestor(repo, dependencyHead, exactReleaseHead)) {
      fail(
        'UNMET_TRACK_DEPENDENCY',
        `release head ${exactReleaseHead} does not contain dependency ${dependency.id} at ${dependencyHead}`,
      );
    }
    for (const work of dependency.work) {
      const status = readBoundStatus(
        repo,
        exactReleaseHead,
        workStatusPath(plan, work.id),
        plan,
        dependency,
        work,
      ).status;
      if (
        status.stage !== 'merge'
        || status.status !== 'complete'
        || status.authority_ref !== snapshot.release.ref
        || status.merge?.frozen_track_head !== dependencyHead
      ) {
        fail('UNMET_TRACK_DEPENDENCY', `dependency ${dependency.id}/${work.id} lacks exact transfer`);
      }
    }
    dependencies.push({ track_id: dependency.id, frozen_head: dependencyHead });
  }
  return { base_commit: exactReleaseHead, dependencies };
}

export function validateMaterializationEvidence(repo, plan, trackId, materialization) {
  requirePlanAdmission(plan);
  const track = findTrack(plan, trackId);
  validateMaterialization(materialization);
  const capturedPlan = parsePlanBytes(
    readFileAtOID(repo, materialization.base_commit, releasePlanPath(plan)),
  );
  if (capturedPlan.digest !== plan.digest) {
    fail('STALE_BINDING', 'materialization base does not contain the exact approved plan');
  }
  if (materialization.dependencies.length !== track.depends_on.length) {
    fail('INVALID_MATERIALIZATION', `track ${trackId} does not bind every dependency exactly once`);
  }
  for (const [index, dependencyId] of track.depends_on.entries()) {
    const dependency = findTrack(plan, dependencyId);
    const captured = materialization.dependencies[index];
    if (captured.track_id !== dependencyId) {
      fail(
        'INVALID_MATERIALIZATION',
        `materialization dependency ${index} must be ${dependencyId}`,
      );
    }
    if (!isAncestor(repo, captured.frozen_head, materialization.base_commit)) {
      fail(
        'UNMET_TRACK_DEPENDENCY',
        `materialization base does not contain dependency ${dependencyId} at ${captured.frozen_head}`,
      );
    }
    for (const work of dependency.work) {
      const status = readBoundStatus(
        repo,
        materialization.base_commit,
        workStatusPath(plan, work.id),
        plan,
        dependency,
        work,
      ).status;
      if (
        status.stage !== 'merge'
        || status.status !== 'complete'
        || status.authority_ref !== plan.metadata.release_ref
        || status.merge?.frozen_track_head !== captured.frozen_head
      ) {
        fail('UNMET_TRACK_DEPENDENCY', `dependency ${dependency.id}/${work.id} lacks exact transfer`);
      }
    }
  }
  return materialization;
}

export function validateTrackMaterialization(repo, plan, trackId, statuses, snapshot = null) {
  requirePlanAdmission(plan);
  const track = findTrack(plan, trackId);
  const firstStatus = statuses instanceof Map
    ? statuses.get(track.work[0].id)
    : statuses?.[track.work[0].id];
  if (!firstStatus) {
    fail('AUTHORITATIVE_STATUS_MISSING', `missing materialised status for ${track.work[0].id}`);
  }
  const expected = snapshot
    ? expectedTrackMaterialization(repo, plan, trackId, snapshot)
    : validateMaterializationEvidence(repo, plan, trackId, firstStatus.materialization);
  for (const work of track.work) {
    const status = statuses instanceof Map ? statuses.get(work.id) : statuses?.[work.id];
    if (!status) fail('AUTHORITATIVE_STATUS_MISSING', `missing materialised status for ${work.id}`);
    validateWorkStatusIdentity(status, plan, track, work);
    if (
      status.authority_ref !== track.ref
      || !isDeepStrictEqual(status.materialization, expected)
    ) {
      fail(
        'INVALID_MATERIALIZATION',
        `work ${work.id} does not share the captured materialization base for track ${trackId}`,
      );
    }
  }
  return expected;
}

export function nextWorkForTrack(plan, statuses, trackId) {
  requirePlanAdmission(plan);
  const track = findTrack(plan, trackId);
  const observed = [];
  for (const work of track.work) {
    const status = statuses instanceof Map ? statuses.get(work.id) : statuses[work.id];
    if (!status) fail('AUTHORITATIVE_STATUS_MISSING', `missing status for ${work.id}`);
    validateWorkStatusIdentity(status, plan, track, work);
    observed.push({ work, status });
  }
  const completed = observed.filter(({ status }) => (
    status.stage === 'merge' && status.status === 'complete'
  ));
  if (completed.length > 0 && completed.length !== observed.length) {
    fail('PARTIAL_TRACK_TRANSFER', `track ${trackId} has only some work transferred to release-wt`);
  }
  for (const { work, status } of observed) {
    const passedInTrack = (
      status.stage === 'merge'
      && status.status === 'ready'
      && status.next_role === 'merge'
      && status.outcome === 'pass'
      && status.authority_ref === track.ref
    );
    const transferred = status.stage === 'merge' && status.status === 'complete';
    if (!passedInTrack && !transferred) return work.id;
  }
  return null;
}

export function assertWorkMayAdvance(plan, statuses, trackId, workId) {
  requirePlanAdmission(plan);
  const expected = nextWorkForTrack(plan, statuses, trackId);
  if (expected === null) fail('TRACK_WORK_COMPLETE', `track ${trackId} has no remaining work to implement`);
  if (expected !== workId) {
    fail('OUT_OF_ORDER_WORK', `track ${trackId} must advance ${expected} before ${workId}`);
  }
  return findWork(plan, workId).work;
}

export function assertTrackReadyForComposition(plan, statuses, trackId) {
  requirePlanAdmission(plan);
  const track = findTrack(plan, trackId);
  for (const work of track.work) {
    const status = statuses instanceof Map ? statuses.get(work.id) : statuses[work.id];
    if (!status) fail('AUTHORITATIVE_STATUS_MISSING', `missing status for ${work.id}`);
    validateWorkStatusIdentity(status, plan, track, work);
    if (
      status.stage !== 'merge'
      || status.status !== 'ready'
      || status.next_role !== 'merge'
      || status.outcome !== 'pass'
      || status.authority_ref !== track.ref
    ) {
      fail('TRACK_NOT_READY', `work ${work.id} has not passed on owning track ${trackId}`);
    }
  }
  return track;
}

export function validateProofGitTopology(repo, status, options = {}) {
  validateStatusSemantics(status);
  if (!status.proof) fail('MISSING_PROOF', 'Git proof validation requires status.proof');
  if (options.repository && status.proof.repository !== options.repository) {
    fail('REPOSITORY_MISMATCH', 'proof repository does not match the approved plan');
  }
  const candidate = assertCandidate(repo, status.proof.base_commit, status.proof.candidate_commit);
  if (candidate.base !== status.proof.base_commit || candidate.candidate !== status.proof.candidate_commit) {
    fail('OBJECT_ID_MISMATCH', 'proof must use exact full Git object identities');
  }
  let authorityHead = null;
  if (options.authorityHead) {
    authorityHead = resolveRef(repo, options.authorityHead);
    if (!isAncestor(repo, candidate.candidate, authorityHead)) {
      fail('CANDIDATE_NOT_ON_AUTHORITY', 'proof candidate is not reachable from its authoritative ref head');
    }
  }
  return {
    ...candidate,
    authorityHead,
  };
}

function reachesCommit(parents, candidate, base) {
  if (candidate === base) return true;
  const pending = [candidate];
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const parent of parents.get(current) ?? []) {
      if (parent === base) return true;
      if (parents.has(parent) && !visited.has(parent)) pending.push(parent);
    }
  }
  return false;
}

export function validateProjectionProofTopology(
  repo,
  plan,
  trackId,
  statuses,
  authorityHead,
) {
  requirePlanAdmission(plan);
  const track = findTrack(plan, trackId);
  objectId(authorityHead, 'captured authority head');
  if (!Array.isArray(statuses)) {
    fail('INVALID_RECORD_SNAPSHOT', 'projection proof validation requires captured statuses');
  }
  const proven = [];
  let materialization = null;
  for (const status of statuses) {
    const work = track.work.find((candidate) => candidate.id === status?.work_id);
    if (!work) fail('STATUS_IDENTITY_MISMATCH', `status does not belong to track ${trackId}`);
    validateWorkStatusIdentity(status, plan, track, work);
    if (!status.proof) continue;
    if (status.proof.repository !== plan.metadata.repository) {
      fail('REPOSITORY_MISMATCH', 'proof repository does not match the approved plan');
    }
    if (!status.materialization) {
      fail('INVALID_MATERIALIZATION', `proof for ${work.id} has no materialization`);
    }
    if (materialization === null) {
      materialization = status.materialization;
    } else if (!isDeepStrictEqual(materialization, status.materialization)) {
      fail('INVALID_MATERIALIZATION', `track ${trackId} proofs use different materializations`);
    }
    proven.push(status);
  }
  if (proven.length === 0) return Object.freeze({ proofs: 0, commits: 0 });

  const rootBase = materialization.base_commit;
  const commits = [...new Set([
    rootBase,
    ...proven.flatMap((status) => [
      status.proof.base_commit,
      status.proof.candidate_commit,
    ]),
  ])];
  const independent = runGit(
    repo,
    ['merge-base', '--independent', authorityHead, ...commits],
    { label: `validate captured proof reachability for ${trackId}` },
  ).trim().split('\n').filter(Boolean);
  if (independent.length !== 1 || independent[0] !== authorityHead) {
    fail(
      'CANDIDATE_NOT_ON_AUTHORITY',
      `track ${trackId} proof commits are not all reachable from the captured authority`,
    );
  }

  const rendered = runGit(
    repo,
    [
      'rev-list',
      '--parents',
      '--topo-order',
      '--ancestry-path',
      '--max-count=10001',
      `${rootBase}..${authorityHead}`,
    ],
    { label: `read captured proof graph for ${trackId}` },
  ).trim();
  const lines = rendered === '' ? [] : rendered.split('\n');
  if (lines.length > 10_000) {
    fail('RESOURCE_LIMIT', `captured proof graph for ${trackId} exceeds 10000 commits`);
  }
  const parents = new Map();
  for (const line of lines) {
    const [commit, ...commitParents] = line.split(' ');
    if (
      !OBJECT_PATTERN.test(commit)
      || commitParents.some((parent) => !OBJECT_PATTERN.test(parent))
      || parents.has(commit)
    ) {
      fail('MALFORMED_GIT_OUTPUT', `captured proof graph for ${trackId} is malformed`);
    }
    parents.set(commit, commitParents);
  }
  for (const status of proven) {
    if (!reachesCommit(
      parents,
      status.proof.candidate_commit,
      status.proof.base_commit,
    )) {
      fail(
        'INVALID_CANDIDATE_ANCESTRY',
        `candidate ${status.proof.candidate_commit} does not descend from base ${status.proof.base_commit}`,
      );
    }
  }
  return Object.freeze({ proofs: proven.length, commits: lines.length });
}

export function validateProofGitIdentity(repo, status, recordRootAdmission, options = {}) {
  const topology = validateProofGitTopology(repo, status, options);
  const identity = productTreeIdentity(repo, topology.candidate, recordRootAdmission);
  if (identity.candidateTree !== status.proof.candidate_tree) {
    fail('STALE_BINDING', 'proof candidate tree does not match Git');
  }
  if (identity.productTree !== status.proof.product_tree) {
    fail('STALE_BINDING', 'proof product tree does not match Git');
  }
  if (topology.authorityHead && options.requireCurrentProduct === true) {
    const current = productTreeIdentity(repo, topology.authorityHead, recordRootAdmission);
    if (current.productTree !== identity.productTree) {
      fail('STALE_BINDING', 'authoritative ref product no longer matches the passed candidate');
    }
  }
  return identity;
}

function productChangedPaths(repo, base, candidate, recordRoot) {
  return changedPathsBetween(repo, base, candidate)
    .filter((changedPath) => (
      changedPath !== recordRoot && !changedPath.startsWith(`${recordRoot}/`)
    ));
}

function candidateCommits(repo, base, candidate) {
  const reverse = [];
  let current = candidate;
  for (let count = 0; current !== base; count += 1) {
    if (count >= 10_000) fail('RESOURCE_LIMIT', 'candidate history exceeds 10000 commits');
    const parents = commitParents(repo, current);
    if (parents.length === 0) {
      fail('INVALID_CANDIDATE_ANCESTRY', `candidate first-parent history does not reach ${base}`);
    }
    reverse.push({ commit: current, parents });
    current = parents[0];
  }
  return reverse.reverse();
}

function assertRegularRecordFile(repo, commit, relativePath) {
  const raw = runGit(repo, ['ls-tree', '-z', commit, '--', relativePath], {
    encoding: null,
    label: `inspect candidate record ${relativePath}`,
  });
  const rendered = raw.toString('utf8');
  const expectedSuffix = `\t${relativePath}\0`;
  if (!rendered.endsWith(expectedSuffix) || !rendered.startsWith('100644 blob ')) {
    fail('INVALID_RECORD_MUTATION', `candidate record ${relativePath} is not one regular file`);
  }
}

function admittedCandidateRecordPaths(plan, track, workIndex) {
  const result = new Set();
  for (const index of [workIndex - 1, workIndex]) {
    if (index < 0) continue;
    const work = track.work[index];
    result.add(workStatusPath(plan, work.id));
    result.add(workDesignPath(plan, work.id));
    result.add(workProofPath(plan, work.id));
  }
  return result;
}

function sameStringSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function validateWorkCandidate(
  repo,
  plan,
  status,
  previousStatus,
  { authorityHead, recordRootAdmission } = {},
) {
  requirePlanAdmission(plan);
  const { track, work } = findWork(plan, status.work_id);
  validateWorkStatusIdentity(status, plan, track, work);
  if (!status.proof) fail('MISSING_PROOF', `work ${work.id} has no candidate proof`);
  if (!authorityHead) fail('INVALID_SNAPSHOT', 'work candidate admission requires a captured authority head');
  objectId(authorityHead, 'captured authority head');
  validateMaterializationEvidence(repo, plan, track.id, status.materialization);

  const workIndex = track.work.findIndex((candidate) => candidate.id === work.id);
  let expectedBase;
  if (workIndex === 0) {
    if (previousStatus !== undefined && previousStatus !== null) {
      fail('INVALID_CANDIDATE_BASE', `first work ${work.id} cannot name a prior work candidate`);
    }
    expectedBase = status.materialization.base_commit;
  } else {
    const priorWork = track.work[workIndex - 1];
    if (!previousStatus) {
      fail('AUTHORITATIVE_STATUS_MISSING', `work ${work.id} requires prior work ${priorWork.id}`);
    }
    validateWorkStatusIdentity(previousStatus, plan, track, priorWork);
    if (
      !previousStatus.proof
      || previousStatus.verification?.outcome !== 'pass'
      || !isDeepStrictEqual(previousStatus.materialization, status.materialization)
    ) {
      fail('INVALID_CANDIDATE_BASE', `prior work ${priorWork.id} is not one passed candidate on this materialization`);
    }
    expectedBase = previousStatus.proof.candidate_commit;
  }
  if (status.proof.base_commit !== expectedBase) {
    fail(
      'INVALID_CANDIDATE_BASE',
      `work ${work.id} base ${status.proof.base_commit} must equal ${expectedBase}`,
    );
  }
  validateStatusHandoffsAtRef(repo, plan, status, authorityHead);
  const identity = validateProofGitIdentity(repo, status, recordRootAdmission, {
    repository: plan.metadata.repository,
    authorityHead,
  });
  const changedPaths = productChangedPaths(
    repo,
    expectedBase,
    status.proof.candidate_commit,
    plan.metadata.record_root,
  );
  const allowedRecords = admittedCandidateRecordPaths(plan, track, workIndex);
  const collectiveMaterializationPaths = new Set(
    track.work.map((plannedWork) => workStatusPath(plan, plannedWork.id)),
  );
  const recordTransitions = [];
  const historyEvents = [];
  let sawCollectiveMaterialization = workIndex !== 0;
  const initialStatuses = {};
  for (const plannedWork of track.work) {
    const initial = parseStatusBytes(
      readFileAtOID(repo, expectedBase, workStatusPath(plan, plannedWork.id)),
      {
        planDigest: plan.digest,
        approvalRef: plan.metadata.approval_ref,
      },
    );
    validateWorkStatusIdentity(initial, plan, track, plannedWork);
    initialStatuses[plannedWork.id] = initial;
  }
  const history = candidateCommits(repo, expectedBase, status.proof.candidate_commit);
  for (const [index, entry] of history.entries()) {
    const parent = entry.parents[0];
    const paths = changedPathsBetween(repo, parent, entry.commit);
    const recordPaths = paths.filter((changedPath) => (
      changedPath === plan.metadata.record_root
      || changedPath.startsWith(`${plan.metadata.record_root}/`)
    ));
    const productPaths = paths.filter((changedPath) => !recordPaths.includes(changedPath));
    if (recordPaths.length > 0 && productPaths.length > 0) {
      fail('MIXED_CANDIDATE_COMMIT', `candidate history commit ${entry.commit} mixes product and records`);
    }
    if (recordPaths.length > 0) {
      const eventTransitions = [];
      if (index === history.length - 1) {
        fail('CANDIDATE_CONTAINS_RECORDS', 'final candidate commit must be product-only');
      }
      if (entry.parents.length !== 1) {
        fail('INVALID_RECORD_MUTATION', `record commit ${entry.commit} must have one parent`);
      }
      assertStructuralRecordOnlyTransition(repo, parent, entry.commit, recordRootAdmission);
      const observedRecordPaths = new Set(recordPaths);
      const collectiveMaterialization = (
        workIndex === 0
        && index === 0
        && parent === status.materialization.base_commit
        && sameStringSet(observedRecordPaths, collectiveMaterializationPaths)
      );
      if (workIndex === 0 && index === 0 && !collectiveMaterialization) {
        fail(
          'INVALID_MATERIALIZATION',
          'first work history must begin with the exact collective materialization transition',
        );
      }
      if (collectiveMaterialization) sawCollectiveMaterialization = true;
      if (!collectiveMaterialization) {
        const changedWorkIds = new Set();
        for (const plannedWork of track.work) {
          const prefix = `${plan.metadata.record_root}/${plan.metadata.release}/work/${plannedWork.id}/`;
          if (recordPaths.some((changedPath) => changedPath.startsWith(prefix))) {
            changedWorkIds.add(plannedWork.id);
          }
        }
        if (changedWorkIds.size !== 1) {
          fail(
            'CROSS_WORK_RECORD_COMMIT',
            `candidate record commit ${entry.commit} must belong to exactly one work identity`,
          );
        }
      }
      for (const changedPath of recordPaths) {
        if (!collectiveMaterialization && !allowedRecords.has(changedPath)) {
          fail('INVALID_RECORD_MUTATION', `candidate history changed unadmitted record ${changedPath}`);
        }
        assertRegularRecordFile(repo, entry.commit, changedPath);
        if (changedPath.endsWith('/status.json')) {
          const before = parseStatusBytes(readFileAtOID(repo, parent, changedPath), {
            planDigest: plan.digest,
            approvalRef: plan.metadata.approval_ref,
          });
          const after = parseStatusBytes(readFileAtOID(repo, entry.commit, changedPath), {
            planDigest: plan.digest,
            approvalRef: plan.metadata.approval_ref,
          });
          const transition = {
            commit: entry.commit,
            path: changedPath,
            before,
            after,
            collective_materialization: collectiveMaterialization,
          };
          recordTransitions.push(transition);
          eventTransitions.push(transition);
        }
      }
      historyEvents.push({
        kind: 'record',
        commit: entry.commit,
        transitions: eventTransitions,
      });
      continue;
    }
    for (const changedPath of productPaths) {
      if (
        !work.scope.include.some((included) => pathContains(included, changedPath))
        || work.scope.exclude.some((excluded) => pathContains(excluded, changedPath))
        || !track.touch_surfaces.some((surface) => pathContains(surface, changedPath))
      ) {
        fail('WORK_SCOPE_VIOLATION', `work ${work.id} changed out-of-scope path ${changedPath}`);
      }
    }
    historyEvents.push({
      kind: 'product',
      commit: entry.commit,
      paths: productPaths,
    });
  }
  if (!sawCollectiveMaterialization) {
    fail('INVALID_MATERIALIZATION', 'first work candidate does not descend from collective materialization');
  }
  if (history.length === 0 || changedPathsBetween(
    repo,
    history.at(-1).parents[0],
    history.at(-1).commit,
  ).length === 0) {
    fail('EMPTY_CANDIDATE', `work ${work.id} candidate has no final product change`);
  }
  return {
    ...identity,
    base: expectedBase,
    changed_paths: changedPaths,
    record_transitions: recordTransitions,
    history_events: historyEvents,
    initial_statuses: initialStatuses,
    work_index: workIndex,
    track_id: track.id,
    work_id: work.id,
  };
}

export function validateWorkRecordTail(
  repo,
  plan,
  status,
  authorityHead,
  recordRootAdmission,
) {
  requirePlanAdmission(plan);
  const { track, work } = findWork(plan, status.work_id);
  validateWorkStatusIdentity(status, plan, track, work);
  if (!status.proof) fail('MISSING_PROOF', `work ${work.id} has no candidate proof`);
  objectId(authorityHead, 'captured authority head');
  const allowedRecords = new Set([
    workStatusPath(plan, work.id),
    workDesignPath(plan, work.id),
    workProofPath(plan, work.id),
  ]);
  const recordTransitions = [];
  for (const entry of candidateCommits(
    repo,
    status.proof.candidate_commit,
    authorityHead,
  )) {
    if (entry.parents.length !== 1) {
      fail('INVALID_RECORD_MUTATION', `post-candidate commit ${entry.commit} must have one parent`);
    }
    const parent = entry.parents[0];
    const paths = changedPathsBetween(repo, parent, entry.commit);
    if (paths.some((changedPath) => (
      changedPath !== plan.metadata.record_root
      && !changedPath.startsWith(`${plan.metadata.record_root}/`)
    ))) {
      fail('PRODUCT_AFTER_CANDIDATE', `work ${work.id} changed product after its candidate`);
    }
    assertStructuralRecordOnlyTransition(repo, parent, entry.commit, recordRootAdmission);
    for (const changedPath of paths) {
      if (!allowedRecords.has(changedPath)) {
        fail('INVALID_RECORD_MUTATION', `post-candidate history changed unadmitted record ${changedPath}`);
      }
      assertRegularRecordFile(repo, entry.commit, changedPath);
      if (changedPath.endsWith('/status.json')) {
        recordTransitions.push({
          commit: entry.commit,
          path: changedPath,
          before: parseStatusBytes(readFileAtOID(repo, parent, changedPath), {
            planDigest: plan.digest,
            approvalRef: plan.metadata.approval_ref,
          }),
          after: parseStatusBytes(readFileAtOID(repo, entry.commit, changedPath), {
            planDigest: plan.digest,
            approvalRef: plan.metadata.approval_ref,
          }),
          collective_materialization: false,
        });
      }
    }
  }
  return { record_transitions: recordTransitions };
}

export function validateAssemblyProjection(repo, plan, status, options = {}) {
  requirePlanAdmission(plan);
  const snapshot = validateRefSnapshot(plan, options.snapshot);
  validateStatusSemantics(status, {
    planDigest: plan.digest,
    approvalRef: plan.metadata.approval_ref,
  });
  if (
    status.kind !== 'assembly'
    || status.release !== plan.metadata.release
    || status.owner_ref !== plan.metadata.release_ref
    || status.authority_ref !== plan.metadata.release_ref
    || status.target_ref !== plan.metadata.target_ref
  ) {
    fail('STATUS_IDENTITY_MISMATCH', 'assembly status does not match the approved release');
  }
  if (options.capturedHandoffs === undefined) {
    validateStatusHandoffsAtRef(repo, plan, status, snapshot.release.head);
  } else {
    validateCapturedStatusHandoffs(plan, status, options.capturedHandoffs);
  }
  validateProofGitTopology(repo, status, {
    repository: plan.metadata.repository,
    authorityHead: snapshot.release.head,
  });

  const expectedTracks = plan.metadata.tracks;
  if (status.proof.components.length !== expectedTracks.length) {
    fail('INCOMPLETE_ASSEMBLY', 'assembly proof must name every planned track exactly once');
  }
  const releaseHead = snapshot.release.head;
  for (const [index, track] of expectedTracks.entries()) {
    const component = status.proof.components[index];
    if (component.track_id !== track.id) {
      fail('INCOMPLETE_ASSEMBLY', `assembly component ${index} must be track ${track.id}`);
    }
    const exactTrackHead = trackRefSnapshot(snapshot, track.id).head;
    if (exactTrackHead === null) {
      fail('INCOMPLETE_ASSEMBLY', `assembly has no captured owner head for track ${track.id}`);
    }
    if (component.head !== exactTrackHead) {
      fail('STALE_BINDING', `assembly component ${track.id} does not bind its exact frozen head`);
    }
    if (
      !isAncestor(repo, exactTrackHead, status.proof.candidate_commit)
      || !isAncestor(repo, exactTrackHead, releaseHead)
    ) {
      fail('INCOMPLETE_ASSEMBLY', `assembly candidate does not contain track ${track.id}`);
    }
    for (const work of track.work) {
      let transfer;
      if (options.capturedTransfers === undefined) {
        transfer = readBoundStatus(
          repo,
          releaseHead,
          workStatusPath(plan, work.id),
          plan,
          track,
          work,
        ).status;
      } else {
        const captured = options.capturedTransfers.find((entry) => entry.work_id === work.id);
        if (!captured) {
          fail('AUTHORITATIVE_STATUS_MISSING', `release snapshot lacks ${work.id}`);
        }
        transfer = captured.status;
        validateWorkStatusIdentity(transfer, plan, track, work);
      }
      if (
        transfer.stage !== 'merge'
        || transfer.status !== 'complete'
        || transfer.merge?.scope !== 'track'
        || transfer.merge.frozen_track_head !== exactTrackHead
      ) {
        fail('INCOMPLETE_ASSEMBLY', `work ${work.id} lacks exact release authority transfer`);
      }
    }
  }
  return status;
}

export function validateAssemblyStatus(repo, plan, status, options = {}) {
  validateAssemblyProjection(repo, plan, status, options);
  validateProofGitIdentity(repo, status, options.recordRootAdmission, {
    repository: plan.metadata.repository,
    authorityHead: options.snapshot.release.head,
    requireCurrentProduct: true,
  });
  return status;
}

export function validateRecordRootInRepository(repo, plan, ref) {
  const root = assertCanonicalRecordRoot(repo, plan.metadata.record_root);
  if (ref) assertRecordRootAtRef(repo, ref, root);
  return root;
}

function usage() {
  return [
    'Usage:',
    '  node reference/records/records.mjs plan <plan.md>',
    '  node reference/records/records.mjs status <status.json>',
    '  node reference/records/records.mjs digest <file>',
  ].join('\n');
}

async function main(argv) {
  const [command, ...args] = argv;
  if (command === 'plan' && args.length === 1) {
    const parsed = parsePlanBytes(readFileSync(args[0]));
    process.stdout.write(`${JSON.stringify({ digest: parsed.digest, metadata: parsed.metadata })}\n`);
    return;
  }
  if (command === 'status' && args.length === 1) {
    const status = parseStatusBytes(readFileSync(args[0]));
    process.stdout.write(`${JSON.stringify(status)}\n`);
    return;
  }
  if (command === 'digest' && args.length === 1) {
    process.stdout.write(`${digestBytes(readFileSync(args[0]))}\n`);
    return;
  }
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.code ?? 'ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

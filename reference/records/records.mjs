#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GitRecordError,
  assertCandidate,
  assertCanonicalRecordRoot,
  assertRecordRootAtRef,
  isAncestor,
  productTreeIdentity,
  readFileAtRef,
  refExists,
  resolveRef,
} from './git.mjs';

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const STATUS_SCHEMA = 'https://baton.sawy3r.net/schemas/work-status-v1.json';
const STATUS_VERSION = 'baton.work-status/v1';
const PLAN_VERSION = 'baton.plan/v1';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const OBJECT_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const INVOCATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const PLAN_OPEN = '```baton-plan-v1\n';
const PLAN_CLOSE = '\n```\n';

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

  value() {
    this.space();
    const character = this.text[this.offset];
    if (
      this.text.startsWith('NaN', this.offset)
      || this.text.startsWith('Infinity', this.offset)
      || this.text.startsWith('-Infinity', this.offset)
    ) {
      fail('NONFINITE_NUMBER', `non-finite number at byte ${this.offset}`);
    }
    if (character === '{') return this.object();
    if (character === '[') return this.array();
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

  object() {
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
        value: this.value(),
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

  array() {
    this.offset += 1;
    this.space();
    const result = [];
    if (this.text[this.offset] === ']') {
      this.offset += 1;
      return result;
    }
    for (;;) {
      result.push(this.value());
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

export function strictParseJSON(bytes, label = 'JSON') {
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

function strings(value, label, { nonempty = false, pathValues = false } = {}) {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) {
    fail('INVALID_FIELD', `${label} must be ${nonempty ? 'a non-empty' : 'an'} array`);
  }
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
  if (parsed === '.git' || parsed.startsWith('.git/')) {
    fail('INVALID_RECORD_ROOT', 'plan.record_root cannot be inside .git');
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
  if (!Array.isArray(value.acceptance) || value.acceptance.length === 0) {
    fail('INVALID_FIELD', `${label}.acceptance must be a non-empty array`);
  }
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
  if (!Array.isArray(value.tracks) || value.tracks.length === 0) {
    fail('INVALID_FIELD', 'plan.tracks must be a non-empty array');
  }

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
    if (!Array.isArray(track.work) || track.work.length === 0) {
      fail('INVALID_FIELD', `${label}.work must be a non-empty array`);
    }
    const work = track.work.map((item, workIndex) => {
      const parsed = validatePlanWork(item, `${label}.work[${workIndex}]`, root);
      if (workIds.has(parsed.id)) fail('DUPLICATE_IDENTITY', `plan repeats work ${parsed.id}`);
      workIds.add(parsed.id);
      workTrack.set(parsed.id, id);
      workOrder.set(parsed.id, workIndex);
      return parsed;
    });
    return { id, ref, depends_on: dependsOn, touch_surfaces: touchSurfaces, work };
  });

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
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const text = decodeUTF8(raw, 'plan.md');
  if (!text.startsWith(PLAN_OPEN)) {
    fail('INVALID_PLAN_FENCE', 'plan.md must begin at byte zero with ```baton-plan-v1');
  }
  const close = text.indexOf(PLAN_CLOSE, PLAN_OPEN.length);
  if (close < 0) fail('INVALID_PLAN_FENCE', 'plan.md is missing the exact closing fence');
  const metadataText = text.slice(PLAN_OPEN.length, close);
  if (metadataText.length === 0) fail('INVALID_PLAN_METADATA', 'plan metadata is empty');
  const metadata = validatePlanMetadata(strictParseJSON(metadataText, 'plan metadata'));
  return {
    metadata,
    digest: digestBytes(raw),
    markdown: text.slice(close + PLAN_CLOSE.length),
    bytes: raw,
  };
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
  if (!Array.isArray(value.components)) fail('INVALID_FIELD', 'status.proof.components must be an array');
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
      'fresh_context',
      'read_only',
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
  if (value.fresh_context !== true || value.read_only !== true) {
    fail('UNTRUSTED_VERIFIER_DISPATCH', 'Verifier dispatch must attest fresh_context=true and read_only=true');
  }
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
    ['work_id', 'track_id', 'blocker', 'design', 'captain', 'proof', 'verification', 'merge'],
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
    absent(value, ['work_id', 'track_id', 'design', 'captain'], 'assembly status');
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
  return validateStatusSemantics(strictParseJSON(bytes, 'status.json'), expected);
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

export function validateHandoffDigestAtRef(repo, ref, relativePath, expectedDigest) {
  repositoryPath(relativePath, 'handoff path', { allowRoot: false });
  digest(expectedDigest, 'handoff digest');
  const bytes = readFileAtRef(repo, ref, relativePath);
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

function assertStatusIdentity(status, plan, track, work) {
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
    bytes = readFileAtRef(repo, ref, relativePath);
  } catch (error) {
    if (error instanceof GitRecordError) {
      throw new RecordError('AUTHORITATIVE_STATUS_MISSING', `missing ${relativePath} at ${ref}`, error);
    }
    throw error;
  }
  const status = parseStatusBytes(bytes);
  assertStatusIdentity(status, plan, track, work);
  return { bytes, status };
}

export function selectAuthoritativeStatus(repo, plan, workId) {
  const { track, work } = findWork(plan, workId);
  const statusPath = workStatusPath(plan, workId);
  const releaseRef = plan.metadata.release_ref;
  if (!refExists(repo, track.ref)) {
    const baseline = readBoundStatus(repo, releaseRef, statusPath, plan, track, work);
    if (baseline.status.authority_ref !== releaseRef) {
      fail('INVALID_OWNER', `unmaterialised work ${workId} must use release baseline authority`);
    }
    return { ref: releaseRef, source: 'baseline', ...baseline };
  }

  const owner = readBoundStatus(repo, track.ref, statusPath, plan, track, work);
  if (owner.status.authority_ref !== track.ref) {
    fail('INVALID_OWNER', `materialised work ${workId} must use owning-track authority`);
  }
  let release;
  try {
    release = readBoundStatus(repo, releaseRef, statusPath, plan, track, work);
  } catch (error) {
    if (error instanceof RecordError) {
      return { ref: track.ref, source: 'owner', ...owner };
    }
    throw error;
  }
  if (
    release.status.stage === 'merge'
    && release.status.status === 'complete'
    && release.status.merge?.scope === 'track'
    && release.status.authority_ref === releaseRef
  ) {
    const frozen = release.status.merge.frozen_track_head;
    const ownerHead = resolveRef(repo, track.ref);
    const releaseHead = resolveRef(repo, releaseRef);
    if (frozen !== ownerHead || !isAncestor(repo, frozen, releaseHead)) {
      fail('INVALID_AUTHORITY_TRANSFER', `release status for ${workId} does not prove exact track composition`);
    }
    return { ref: releaseRef, source: 'composed', ...release };
  }
  return { ref: track.ref, source: 'owner', ...owner };
}

export function validateTrackMaterialization(repo, plan, trackId, releaseHead) {
  const track = findTrack(plan, trackId);
  const exactReleaseHead = resolveRef(repo, releaseHead);
  for (const dependencyId of track.depends_on) {
    const dependency = findTrack(plan, dependencyId);
    const dependencyHead = resolveRef(repo, dependency.ref);
    if (!isAncestor(repo, dependencyHead, exactReleaseHead)) {
      fail(
        'UNMET_TRACK_DEPENDENCY',
        `release head ${exactReleaseHead} does not contain dependency ${dependency.id} at ${dependencyHead}`,
      );
    }
    for (const work of dependency.work) {
      const status = readBoundStatus(
        repo,
        plan.metadata.release_ref,
        workStatusPath(plan, work.id),
        plan,
        dependency,
        work,
      ).status;
      if (
        status.stage !== 'merge'
        || status.status !== 'complete'
        || status.merge?.frozen_track_head !== dependencyHead
      ) {
        fail('UNMET_TRACK_DEPENDENCY', `dependency ${dependency.id}/${work.id} lacks exact transfer`);
      }
    }
  }
  return exactReleaseHead;
}

export function nextWorkForTrack(plan, statuses, trackId) {
  const track = findTrack(plan, trackId);
  const observed = [];
  for (const work of track.work) {
    const status = statuses instanceof Map ? statuses.get(work.id) : statuses[work.id];
    if (!status) fail('AUTHORITATIVE_STATUS_MISSING', `missing status for ${work.id}`);
    assertStatusIdentity(status, plan, track, work);
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
  const expected = nextWorkForTrack(plan, statuses, trackId);
  if (expected === null) fail('TRACK_WORK_COMPLETE', `track ${trackId} has no remaining work to implement`);
  if (expected !== workId) {
    fail('OUT_OF_ORDER_WORK', `track ${trackId} must advance ${expected} before ${workId}`);
  }
  return findWork(plan, workId).work;
}

export function assertTrackReadyForComposition(plan, statuses, trackId) {
  const track = findTrack(plan, trackId);
  for (const work of track.work) {
    const status = statuses instanceof Map ? statuses.get(work.id) : statuses[work.id];
    if (!status) fail('AUTHORITATIVE_STATUS_MISSING', `missing status for ${work.id}`);
    assertStatusIdentity(status, plan, track, work);
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

export function validateProofGitIdentity(repo, status, recordRoot, options = {}) {
  validateStatusSemantics(status);
  if (!status.proof) fail('MISSING_PROOF', 'Git proof validation requires status.proof');
  if (options.repository && status.proof.repository !== options.repository) {
    fail('REPOSITORY_MISMATCH', 'proof repository does not match the approved plan');
  }
  const candidate = assertCandidate(repo, status.proof.base_commit, status.proof.candidate_commit);
  if (candidate.base !== status.proof.base_commit || candidate.candidate !== status.proof.candidate_commit) {
    fail('OBJECT_ID_MISMATCH', 'proof must use exact full Git object identities');
  }
  const identity = productTreeIdentity(repo, candidate.candidate, recordRoot, {
    recordRootConsumed: options.recordRootConsumed === true,
  });
  if (identity.candidateTree !== status.proof.candidate_tree) {
    fail('STALE_BINDING', 'proof candidate tree does not match Git');
  }
  if (identity.productTree !== status.proof.product_tree) {
    fail('STALE_BINDING', 'proof product tree does not match Git');
  }
  if (options.authorityHead) {
    const authorityHead = resolveRef(repo, options.authorityHead);
    if (!isAncestor(repo, candidate.candidate, authorityHead)) {
      fail('CANDIDATE_NOT_ON_AUTHORITY', 'proof candidate is not reachable from its authoritative ref head');
    }
    if (options.requireCurrentProduct === true) {
      const current = productTreeIdentity(repo, authorityHead, recordRoot, {
        recordRootConsumed: options.recordRootConsumed === true,
      });
      if (current.productTree !== identity.productTree) {
        fail('STALE_BINDING', 'authoritative ref product no longer matches the passed candidate');
      }
    }
  }
  return identity;
}

export function validateAssemblyStatus(repo, plan, status, options = {}) {
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
  validateStatusHandoffsAtRef(repo, plan, status, plan.metadata.release_ref);
  validateProofGitIdentity(repo, status, plan.metadata.record_root, {
    repository: plan.metadata.repository,
    recordRootConsumed: options.recordRootConsumed === true,
    authorityHead: plan.metadata.release_ref,
    requireCurrentProduct: true,
  });

  const expectedTracks = plan.metadata.tracks;
  if (status.proof.components.length !== expectedTracks.length) {
    fail('INCOMPLETE_ASSEMBLY', 'assembly proof must name every planned track exactly once');
  }
  const releaseHead = resolveRef(repo, plan.metadata.release_ref);
  for (const [index, track] of expectedTracks.entries()) {
    const component = status.proof.components[index];
    if (component.track_id !== track.id) {
      fail('INCOMPLETE_ASSEMBLY', `assembly component ${index} must be track ${track.id}`);
    }
    const exactTrackHead = resolveRef(repo, track.ref);
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
      const transfer = readBoundStatus(
        repo,
        plan.metadata.release_ref,
        workStatusPath(plan, work.id),
        plan,
        track,
        work,
      ).status;
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
    '  node reference/records/records.mjs product-tree <repo> <commit> <record-root>',
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
  if (command === 'product-tree' && args.length === 3) {
    process.stdout.write(`${JSON.stringify(productTreeIdentity(args[0], args[1], args[2]))}\n`);
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

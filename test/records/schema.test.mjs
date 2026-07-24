import assert from 'node:assert/strict';
import { readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  parsePlanBytes,
  parseStatusBytes,
  strictParseJSON,
  validateHeadRef,
  validatePlanMetadata,
  validateRecordRootInRepository,
  validateStatusSemantics,
} from '../../reference/records/records.mjs';
import {
  clone,
  initialAssemblyStatus,
  initialWorkStatus,
  makePlanBytes,
  makePlanMetadata,
  temporaryRepository,
} from './helpers.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

function throwsCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code);
}

test('the seven retained raw strict-JSON fixtures have deterministic outcomes', () => {
  const cases = new Map([
    ['raw-valid-edge.json', null],
    ['raw-invalid-duplicate-key.json', 'DUPLICATE_NAME'],
    ['raw-invalid-nonfinite.json', 'NONFINITE_NUMBER'],
    ['raw-invalid-unicode.json', 'INVALID_UNICODE'],
    ['raw-invalid-unsafe-exponent.json', 'UNSAFE_INTEGER'],
    ['raw-invalid-unsafe-float.json', 'UNSAFE_INTEGER'],
    ['raw-invalid-unsafe-integer.json', 'UNSAFE_INTEGER'],
  ]);
  for (const [fixture, expectedCode] of cases) {
    const bytes = readFileSync(path.join(ROOT, 'conformance/fixtures', fixture));
    if (expectedCode === null) {
      assert.ok(strictParseJSON(bytes));
    } else {
      throwsCode(() => strictParseJSON(bytes), expectedCode);
    }
  }
});

test('strict JSON rejects trailing values and invalid UTF-8', () => {
  throwsCode(() => strictParseJSON(Buffer.from('{} true')), 'TRAILING_JSON');
  throwsCode(() => strictParseJSON(Buffer.from([0x7b, 0xff, 0x7d])), 'INVALID_UTF8');
});

test('hostile object names remain own fields and cannot mutate parser prototypes', () => {
  const parsed = strictParseJSON(Buffer.from(
    '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
  ));
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.equal(Object.hasOwn(parsed, 'constructor'), true);
  assert.equal({}.polluted, undefined);

  const hostilePlan = strictParseJSON(Buffer.from(
    JSON.stringify(makePlanMetadata()).replace(/}$/, ',"__proto__":true}'),
  ));
  throwsCode(() => validatePlanMetadata(hostilePlan), 'UNKNOWN_FIELD');
});

test('the authored schema itself is strict JSON with no duplicate names', () => {
  const bytes = readFileSync(path.join(ROOT, 'schemas/work-status-v1.json'));
  const schema = strictParseJSON(bytes, 'work-status-v1 schema');
  assert.equal(schema.$id, 'https://baton.sawy3r.net/schemas/work-status-v1.json');
  throwsCode(
    () => strictParseJSON(Buffer.from('{"properties":{},"properties":{}}')),
    'DUPLICATE_NAME',
  );
});

test('plan identity is the raw complete file and the format is singular and closed', () => {
  const bytes = makePlanBytes();
  const parsed = parsePlanBytes(bytes);
  assert.equal(parsed.metadata.tracks.length, 3);
  assert.match(parsed.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(parsed.markdown, '\n# Release v1.0.0\n');

  throwsCode(() => parsePlanBytes(Buffer.concat([Buffer.from('\n'), bytes])), 'INVALID_PLAN_FENCE');
  throwsCode(() => parsePlanBytes(Buffer.from('```yaml\n{}\n```\n')), 'INVALID_PLAN_FENCE');
  throwsCode(() => parsePlanBytes(Buffer.from('```baton-plan-v1\n{} trailing\n```\n')), 'TRAILING_JSON');

  const unknown = makePlanMetadata();
  unknown.extra = true;
  throwsCode(() => validatePlanMetadata(unknown), 'UNKNOWN_FIELD');
});

test('parsed plan authority is deeply immutable and keeps its raw bytes private', () => {
  const source = makePlanBytes();
  const expected = Buffer.from(source);
  const parsed = parsePlanBytes(source);
  const track = parsed.metadata.tracks[0];
  const work = track.work[0];

  for (const value of [
    parsed,
    parsed.metadata,
    parsed.metadata.tracks,
    track,
    track.depends_on,
    track.touch_surfaces,
    track.work,
    work,
    work.scope,
    work.scope.include,
    work.scope.exclude,
    work.acceptance,
    work.acceptance[0],
    work.checks,
    work.constraints,
    work.depends_on,
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }

  source.fill(0);
  assert.deepEqual(parsed.bytes, expected);
  const exposed = parsed.bytes;
  exposed.fill(0);
  assert.deepEqual(parsed.bytes, expected);
  assert.equal(parsed.digest, parsePlanBytes(expected).digest);
  assert.throws(() => {
    work.scope.include[0] = '.';
  }, TypeError);
});

test('plan rejects invalid refs, escaping paths, dependency cycles, and parallel touch conflicts', () => {
  throwsCode(() => validateHeadRef('refs/heads/topic/../main'), 'INVALID_REF');
  throwsCode(() => validateHeadRef('main'), 'INVALID_REF');

  const escaping = makePlanMetadata();
  escaping.tracks[0].work[0].scope.include = ['../secret'];
  throwsCode(() => validatePlanMetadata(escaping), 'INVALID_PATH');

  const controlPath = makePlanMetadata();
  controlPath.tracks[0].work[0].scope.include = ['src/\nsecret'];
  throwsCode(() => validatePlanMetadata(controlPath), 'INVALID_PATH');

  const gitInternal = makePlanMetadata();
  gitInternal.tracks[0].work[0].scope.include = ['.git/config'];
  throwsCode(() => validatePlanMetadata(gitInternal), 'INVALID_PATH');

  const cycle = makePlanMetadata();
  cycle.tracks[0].depends_on = ['T3'];
  throwsCode(() => validatePlanMetadata(cycle), 'DEPENDENCY_CYCLE');

  const conflict = makePlanMetadata();
  conflict.tracks[1].touch_surfaces = ['src/alpha/nested'];
  conflict.tracks[1].work[0].scope.include = ['src/alpha/nested/one.mjs'];
  throwsCode(() => validatePlanMetadata(conflict), 'PARALLEL_TOUCH_CONFLICT');

  const recordOverlap = makePlanMetadata();
  recordOverlap.tracks[0].touch_surfaces = ['.baton'];
  throwsCode(() => validatePlanMetadata(recordOverlap), 'RECORD_ROOT_IN_PRODUCT_SCOPE');
});

test('record root is fixed to canonical non-symlinked .baton/releases', () => {
  const fixture = temporaryRepository();
  try {
    const valid = { metadata: makePlanMetadata() };
    assert.equal(validateRecordRootInRepository(fixture.repo, valid), '.baton/releases');

    const escaping = { metadata: { ...makePlanMetadata(), record_root: '../records' } };
    throwsCode(() => validateRecordRootInRepository(fixture.repo, escaping), 'INVALID_RECORD_ROOT');

    symlinkSync('/tmp', path.join(fixture.repo, '.baton'));
    throwsCode(() => validateRecordRootInRepository(fixture.repo, valid), 'SYMLINKED_RECORD_ROOT');
  } finally {
    fixture.cleanup();
  }
});

test('work and assembly records pass both shape and semantic validation', () => {
  assert.equal(validateStatusSemantics(initialWorkStatus()).kind, 'work');
  assert.equal(validateStatusSemantics(initialAssemblyStatus()).kind, 'assembly');
  assert.equal(parseStatusBytes(Buffer.from(JSON.stringify(initialWorkStatus()))).work_id, 'W1');
});

test('unknown fields, invalid enums, malformed digests, and malformed refs fail closed', () => {
  const cases = [
    ['UNKNOWN_FIELD', (status) => { status.worker = 'agent-1'; }],
    ['INVALID_FIELD', (status) => { status.plan.digest = 'sha256:ABC'; }],
    ['INVALID_REF', (status) => { status.owner_ref = 'refs/heads/topic/../T1'; }],
    ['INVALID_FIELD', (status) => { status.status = 'active'; }],
    ['INVALID_FIELD', (status) => { status.outcome = 'no_verdict'; }],
  ];
  for (const [code, mutate] of cases) {
    const status = clone(initialWorkStatus());
    mutate(status);
    throwsCode(() => validateStatusSemantics(status), code);
  }
});

test('status expected bindings reject stale plan and approval evidence', () => {
  const status = initialWorkStatus();
  throwsCode(
    () => validateStatusSemantics(status, { planDigest: `sha256:${'f'.repeat(64)}` }),
    'STALE_BINDING',
  );
  throwsCode(
    () => validateStatusSemantics(status, { approvalRef: 'approval://other' }),
    'STALE_BINDING',
  );
  throwsCode(
    () => validateStatusSemantics(status, { approvalDigest: `sha256:${'f'.repeat(64)}` }),
    'STALE_BINDING',
  );
});

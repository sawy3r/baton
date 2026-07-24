import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  DRIVER_REQUEST_VERSION,
  TRANSPORT_STATUSES,
  driverInfo,
  parseDriverRequest,
  runFake,
  validateDriverRequest,
  validateDriverResult,
} from '../../reference/driver/fake-driver.mjs';

const REQUEST_FILE = new URL(
  '../../conformance/fixtures/driver/valid-request.json',
  import.meta.url,
);
const RESULT_FILE = new URL(
  '../../conformance/fixtures/driver/valid-completed-result.json',
  import.meta.url,
);
const DRIVER_FILE = fileURLToPath(
  new URL('../../reference/driver/fake-driver.mjs', import.meta.url),
);

function requestFixture() {
  return JSON.parse(readFileSync(REQUEST_FILE, 'utf8'));
}

function throwsCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code);
}

function invoke(command, input = '', environment = {}) {
  return spawnSync(process.execPath, [DRIVER_FILE, ...command], {
    encoding: 'utf8',
    input,
    env: {
      PATH: process.env.PATH,
      BATON_FAKE_PROFILE: environment.BATON_FAKE_PROFILE,
    },
  });
}

test('info reports only the common contract and fake identity', () => {
  assert.deepEqual(driverInfo(), {
    contract_version: 'baton.driver/v1',
    driver_id: 'baton.fake',
    driver_version: '1.0.0',
  });
  const child = invoke(['info']);
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.deepEqual(JSON.parse(child.stdout), driverInfo());
  assert.deepEqual(Object.keys(JSON.parse(child.stdout)).sort(), [
    'contract_version',
    'driver_id',
    'driver_version',
  ]);
});

test('all five roles use the same fake executable and explicit model', () => {
  const operations = {
    planner: 'baton-plan',
    implementer: 'baton-implement',
    captain: 'baton-design-review',
    verifier: 'baton-verify',
    merge: 'baton-merge',
  };
  for (const role of ['planner', 'implementer', 'captain', 'verifier', 'merge']) {
    const request = requestFixture();
    request.role = role;
    request.operation.id = operations[role];
    request.invocation_id = `invoke-${role}`;
    request.workspace.access = role === 'verifier' ? 'read_only' : 'read_write';
    const child = invoke(['run'], `${JSON.stringify(request)}\n`, {
      BATON_FAKE_PROFILE: 'completed',
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, '');
    const result = validateDriverResult(JSON.parse(child.stdout), {
      invocation_id: request.invocation_id,
      driver_id: 'baton.fake',
      driver_version: '1.0.0',
    });
    assert.equal(result.transport_status, 'completed');
    assert.equal(result.observed_model, 'fake-model-v1');
    assert.match(result.text, new RegExp(role));
  }
});

test('every built-in transport profile emits one valid result with exit zero', () => {
  const request = requestFixture();
  for (const profile of TRANSPORT_STATUSES) {
    const child = invoke(['run'], `${JSON.stringify(request)}\n`, {
      BATON_FAKE_PROFILE: profile,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim().split('\n').length, 1);
    const result = validateDriverResult(JSON.parse(child.stdout), {
      invocation_id: request.invocation_id,
    });
    assert.equal(result.transport_status, profile);
    assert.equal(Object.hasOwn(result, 'usage'), profile === 'completed');
  }
});

test('canonical request and completed result fixtures remain executable', () => {
  const request = parseDriverRequest(readFileSync(REQUEST_FILE));
  assert.equal(request.schema_version, DRIVER_REQUEST_VERSION);
  assert.deepEqual(runFake(request), validateDriverResult(
    JSON.parse(readFileSync(RESULT_FILE, 'utf8')),
    {
      invocation_id: request.invocation_id,
      driver_id: 'baton.fake',
      driver_version: '1.0.0',
    },
  ));
});

test('request parsing is strict, bounded, and binds operation bytes', () => {
  const request = requestFixture();
  const compact = JSON.stringify(request);
  throwsCode(
    () => parseDriverRequest(
      compact.replace(
        '"schema_version":"baton.driver-request/v1"',
        '"schema_version":"baton.driver-request/v1","schema_version":"baton.driver-request/v1"',
      ),
    ),
    'DUPLICATE_NAME',
  );
  throwsCode(() => parseDriverRequest(`${compact} trailing`), 'TRAILING_JSON');

  const unknown = requestFixture();
  unknown.default_model = 'forbidden';
  throwsCode(() => validateDriverRequest(unknown), 'UNKNOWN_FIELD');

  const stale = requestFixture();
  stale.operation.instructions = 'Changed operation instructions.\n';
  throwsCode(() => validateDriverRequest(stale), 'STALE_OPERATION');

  const wrongRole = requestFixture();
  wrongRole.role = 'captain';
  throwsCode(() => validateDriverRequest(wrongRole), 'OPERATION_ROLE_MISMATCH');

  const relative = requestFixture();
  relative.workspace.path = 'relative/workspace';
  throwsCode(() => validateDriverRequest(relative), 'INVALID_WORKSPACE');

  const duplicateInput = requestFixture();
  duplicateInput.inputs[1].name = duplicateInput.inputs[0].name;
  throwsCode(() => validateDriverRequest(duplicateInput), 'DUPLICATE_INPUT');

  throwsCode(
    () => parseDriverRequest(Buffer.alloc(1_048_577, 0x20)),
    'RESOURCE_LIMIT',
  );
});

test('completed remains transport-only and cannot become a Baton verdict', () => {
  const result = runFake(requestFixture(), 'completed');
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      'driver_id',
      'driver_version',
      'duration_ms',
      'invocation_id',
      'observed_model',
      'schema_version',
      'text',
      'transport_status',
      'usage',
    ],
  );
  for (const forbidden of ['outcome', 'verdict', 'proof', 'merge', 'fresh_context']) {
    assert.equal(Object.hasOwn(result, forbidden), false);
  }
  assert.equal(result.transport_status, 'completed');
});

test('model selection is explicit, including deliberate null, with no fallback field', () => {
  const request = requestFixture();
  request.model = null;
  request.limits.output_bytes = 4;
  const result = runFake(request, 'completed');
  assert.equal(result.observed_model, null);
  assert.equal(result.text, 'Fake');

  const missing = requestFixture();
  delete missing.model;
  throwsCode(() => validateDriverRequest(missing), 'MISSING_FIELD');

  const fallback = requestFixture();
  fallback.fallback_model = 'forbidden';
  throwsCode(() => validateDriverRequest(fallback), 'UNKNOWN_FIELD');
});

test('result validation rejects wrong invocation, missing output, and extra fields', () => {
  const valid = JSON.parse(readFileSync(RESULT_FILE, 'utf8'));
  throwsCode(
    () => validateDriverResult(valid, { invocation_id: 'another-invocation' }),
    'RESULT_BINDING_MISMATCH',
  );
  const extra = { ...valid, verdict: 'pass' };
  throwsCode(() => validateDriverResult(extra), 'UNKNOWN_FIELD');
  assert.throws(() => JSON.parse(''), SyntaxError);
});

test('invalid invocation or request emits no result and bounded diagnostics', () => {
  for (const child of [
    invoke(['complete']),
    invoke(['run'], '{"broken":'),
    invoke(['run', 'extra'], JSON.stringify(requestFixture())),
    invoke(['run'], JSON.stringify(requestFixture()), {
      BATON_FAKE_PROFILE: 'arbitrary-command',
    }),
  ]) {
    assert.notEqual(child.status, 0);
    assert.equal(child.stdout, '');
    assert.ok(Buffer.byteLength(child.stderr) <= 1024);
  }
});

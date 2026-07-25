#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  RecordError,
  repositoryPath,
  strictParseJSON,
} from '../records/records.mjs';

export const DRIVER_CONTRACT_VERSION = 'baton.driver/v1';
export const DRIVER_REQUEST_VERSION = 'baton.driver-request/v1';
export const DRIVER_RESULT_VERSION = 'baton.driver-result/v1';
export const FAKE_DRIVER_ID = 'baton.fake';
export const FAKE_DRIVER_VERSION = '1.0.0';

export const TRANSPORT_STATUSES = Object.freeze([
  'completed',
  'transport_error',
  'timeout',
  'cancelled',
  'runner_error',
]);

const ROLES = Object.freeze([
  'planner',
  'implementer',
  'captain',
  'verifier',
  'merge',
]);
const OPERATION_FOR_ROLE = Object.freeze({
  planner: 'baton-plan',
  implementer: 'baton-implement',
  captain: 'baton-design-review',
  verifier: 'baton-verify',
  merge: 'baton-merge',
});
const OPERATION_VERSION = 'baton.operation/v1';
const OPERATION_SOURCES = Object.freeze({
  'baton-plan': '../../operations/baton-plan.md',
  'baton-implement': '../../operations/baton-implement.md',
  'baton-design-review': '../../operations/baton-design-review.md',
  'baton-verify': '../../operations/baton-verify.md',
  'baton-merge': '../../operations/baton-merge.md',
});
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_INSTRUCTIONS_BYTES = 262_144;
const MAX_RESULT_TEXT_BYTES = 1_048_576;
const MAX_INPUTS = 256;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const DRIVER_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DRIVER_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export class DriverContractError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DriverContractError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new DriverContractError(code, message, cause);
}

function exactKeys(value, required, optional, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_FIELD', `${label} must be an object`);
  }
  const expected = [...required, ...optional].sort();
  const observed = Object.keys(value).sort();
  if (observed.some((key) => !expected.includes(key))) {
    fail('UNKNOWN_FIELD', `${label} contains an unknown field`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('MISSING_FIELD', `${label}.${key} is required`);
  }
}

function string(value, label, { max = 1000, pattern = null } = {}) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value) > max
    || /[\u0000-\u001f\u007f-\u009f]/.test(value)
    || (pattern && !pattern.test(value))
  ) {
    fail('INVALID_FIELD', `${label} is invalid`);
  }
  return value;
}

function integer(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('INVALID_FIELD', `${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function digest(value, label) {
  return string(value, label, { max: 71, pattern: DIGEST });
}

function model(value, label) {
  if (value === null) return null;
  return string(value, label, { max: 500 });
}

function absoluteWorkspace(value) {
  const workspace = string(value, 'request.workspace.path', { max: 4096 });
  if (!path.isAbsolute(workspace) || path.normalize(workspace) !== workspace) {
    fail('INVALID_WORKSPACE', 'request.workspace.path must be one canonical absolute path');
  }
  return workspace;
}

function instructionsDigest(instructions) {
  return `sha256:${createHash('sha256').update(Buffer.from(instructions)).digest('hex')}`;
}

function canonicalOperations() {
  return Object.freeze(Object.fromEntries(
    Object.entries(OPERATION_SOURCES).map(([id, source]) => {
      const bytes = readFileSync(new URL(source, import.meta.url));
      let instructions;
      try {
        instructions = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (error) {
        fail('INVALID_PACKAGE', `canonical operation ${id} is not valid UTF-8`, error);
      }
      if (!instructions.endsWith('\n') || instructions.includes('\r')) {
        fail('INVALID_PACKAGE', `canonical operation ${id} is not exact UTF-8/LF text`);
      }
      return [id, Object.freeze({
        id,
        version: OPERATION_VERSION,
        digest: instructionsDigest(instructions),
        instructions,
      })];
    }),
  ));
}

const CANONICAL_OPERATIONS = canonicalOperations();

function operationInstructions(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value) > MAX_INSTRUCTIONS_BYTES
    || !value.endsWith('\n')
    || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(value)
  ) {
    fail(
      'INVALID_OPERATION',
      'request.operation.instructions must be bounded UTF-8/LF text with a final newline',
    );
  }
  return value;
}

function validateOperation(value) {
  exactKeys(value, ['id', 'version', 'digest', 'instructions'], [], 'request.operation');
  const id = string(value.id, 'request.operation.id', { max: 200, pattern: IDENTITY });
  if (!Object.values(OPERATION_FOR_ROLE).includes(id)) {
    fail('INVALID_OPERATION', 'request.operation.id is not a canonical Baton operation');
  }
  if (value.version !== OPERATION_VERSION) {
    fail('INVALID_VERSION', `request.operation.version must be ${OPERATION_VERSION}`);
  }
  const instructions = operationInstructions(value.instructions);
  const suppliedDigest = digest(value.digest, 'request.operation.digest');
  const canonical = CANONICAL_OPERATIONS[id];
  if (
    suppliedDigest !== canonical.digest
    || instructionsDigest(instructions) !== canonical.digest
    || instructions !== canonical.instructions
  ) {
    fail('STALE_OPERATION', 'request.operation does not match the installed canonical operation');
  }
  return canonical;
}

function validateInputs(value) {
  if (!Array.isArray(value) || value.length > MAX_INPUTS) {
    fail('INVALID_FIELD', `request.inputs must contain at most ${MAX_INPUTS} records`);
  }
  const names = new Set();
  const paths = new Set();
  return Object.freeze(value.map((input, index) => {
    const label = `request.inputs[${index}]`;
    exactKeys(input, ['name', 'path', 'digest'], [], label);
    const name = string(input.name, `${label}.name`, {
      max: 128,
      pattern: DRIVER_IDENTITY,
    });
    let relativePath;
    try {
      relativePath = repositoryPath(input.path, `${label}.path`, { allowRoot: false });
    } catch (error) {
      if (error instanceof RecordError) fail(error.code, error.message, error);
      throw error;
    }
    if (names.has(name)) fail('DUPLICATE_INPUT', `request repeats input name ${name}`);
    if (paths.has(relativePath)) fail('DUPLICATE_INPUT', `request repeats input path ${relativePath}`);
    names.add(name);
    paths.add(relativePath);
    return Object.freeze({
      name,
      path: relativePath,
      digest: digest(input.digest, `${label}.digest`),
    });
  }));
}

export function validateDriverRequest(value) {
  exactKeys(
    value,
    [
      'schema_version',
      'invocation_id',
      'role',
      'operation',
      'model',
      'workspace',
      'inputs',
      'fresh_context',
      'limits',
    ],
    [],
    'request',
  );
  if (value.schema_version !== DRIVER_REQUEST_VERSION) {
    fail('INVALID_VERSION', `request.schema_version must be ${DRIVER_REQUEST_VERSION}`);
  }
  const invocationId = string(value.invocation_id, 'request.invocation_id', {
    max: 200,
    pattern: IDENTITY,
  });
  if (!ROLES.includes(value.role)) fail('INVALID_ROLE', 'request.role is invalid');
  exactKeys(value.workspace, ['path', 'access'], [], 'request.workspace');
  const workspace = absoluteWorkspace(value.workspace.path);
  if (!['read_only', 'read_write'].includes(value.workspace.access)) {
    fail('INVALID_ACCESS', 'request.workspace.access is invalid');
  }
  if (typeof value.fresh_context !== 'boolean') {
    fail('INVALID_FIELD', 'request.fresh_context must be boolean');
  }
  exactKeys(value.limits, ['timeout_ms', 'output_bytes'], [], 'request.limits');
  const timeoutMs = integer(value.limits.timeout_ms, 'request.limits.timeout_ms', {
    minimum: 1,
    maximum: 86_400_000,
  });
  const outputBytes = integer(value.limits.output_bytes, 'request.limits.output_bytes', {
    minimum: 1,
    maximum: MAX_RESULT_TEXT_BYTES,
  });
  const operation = validateOperation(value.operation);
  if (operation.id !== OPERATION_FOR_ROLE[value.role]) {
    fail(
      'OPERATION_ROLE_MISMATCH',
      `request role ${value.role} requires ${OPERATION_FOR_ROLE[value.role]}`,
    );
  }
  return Object.freeze({
    schema_version: DRIVER_REQUEST_VERSION,
    invocation_id: invocationId,
    role: value.role,
    operation,
    model: model(value.model, 'request.model'),
    workspace: Object.freeze({
      path: workspace,
      access: value.workspace.access,
    }),
    inputs: validateInputs(value.inputs),
    fresh_context: value.fresh_context,
    limits: Object.freeze({
      timeout_ms: timeoutMs,
      output_bytes: outputBytes,
    }),
  });
}

export function parseDriverRequest(bytes) {
  let parsed;
  try {
    parsed = strictParseJSON(bytes, 'driver request', { maxBytes: MAX_REQUEST_BYTES });
  } catch (error) {
    if (error instanceof RecordError) fail(error.code, error.message, error);
    throw error;
  }
  return validateDriverRequest(parsed);
}

function validateUsage(value) {
  exactKeys(value, ['input_tokens', 'output_tokens'], [], 'result.usage');
  return Object.freeze({
    input_tokens: integer(value.input_tokens, 'result.usage.input_tokens'),
    output_tokens: integer(value.output_tokens, 'result.usage.output_tokens'),
  });
}

export function validateDriverResult(value, expected = {}) {
  exactKeys(
    value,
    [
      'schema_version',
      'invocation_id',
      'driver_id',
      'driver_version',
      'observed_model',
      'duration_ms',
      'text',
      'transport_status',
    ],
    ['usage'],
    'result',
  );
  if (value.schema_version !== DRIVER_RESULT_VERSION) {
    fail('INVALID_VERSION', `result.schema_version must be ${DRIVER_RESULT_VERSION}`);
  }
  const result = {
    schema_version: DRIVER_RESULT_VERSION,
    invocation_id: string(value.invocation_id, 'result.invocation_id', {
      max: 200,
      pattern: IDENTITY,
    }),
    driver_id: string(value.driver_id, 'result.driver_id', {
      max: 128,
      pattern: DRIVER_IDENTITY,
    }),
    driver_version: string(value.driver_version, 'result.driver_version', {
      max: 100,
      pattern: DRIVER_VERSION,
    }),
    observed_model: model(value.observed_model, 'result.observed_model'),
    duration_ms: integer(value.duration_ms, 'result.duration_ms'),
    text: typeof value.text === 'string' && Buffer.byteLength(value.text) <= MAX_RESULT_TEXT_BYTES
      ? value.text
      : fail('INVALID_FIELD', 'result.text is invalid'),
    transport_status: TRANSPORT_STATUSES.includes(value.transport_status)
      ? value.transport_status
      : fail('INVALID_TRANSPORT_STATUS', 'result.transport_status is invalid'),
  };
  if (Object.hasOwn(value, 'usage')) result.usage = validateUsage(value.usage);
  const bindings = {
    invocation_id: expected.invocation_id,
    driver_id: expected.driver_id,
    driver_version: expected.driver_version,
  };
  for (const [key, expectedValue] of Object.entries(bindings)) {
    if (expectedValue !== undefined && result[key] !== expectedValue) {
      fail('RESULT_BINDING_MISMATCH', `result.${key} does not match the invocation`);
    }
  }
  return Object.freeze(result);
}

export function driverInfo() {
  return Object.freeze({
    contract_version: DRIVER_CONTRACT_VERSION,
    driver_id: FAKE_DRIVER_ID,
    driver_version: FAKE_DRIVER_VERSION,
  });
}

function boundedText(value, maxBytes) {
  return value.slice(0, maxBytes);
}

export function runFake(request, profile = 'completed') {
  const admitted = validateDriverRequest(request);
  if (!TRANSPORT_STATUSES.includes(profile)) {
    fail('INVALID_PROFILE', 'fake profile must be one built-in transport status');
  }
  const messages = {
    completed: `Fake completed response for ${admitted.role}.`,
    transport_error: 'Fake transport error.',
    timeout: 'Fake timeout.',
    cancelled: 'Fake cancellation.',
    runner_error: 'Fake runner error.',
  };
  const result = {
    schema_version: DRIVER_RESULT_VERSION,
    invocation_id: admitted.invocation_id,
    driver_id: FAKE_DRIVER_ID,
    driver_version: FAKE_DRIVER_VERSION,
    observed_model: admitted.model,
    duration_ms: 0,
    text: boundedText(messages[profile], admitted.limits.output_bytes),
    transport_status: profile,
  };
  if (profile === 'completed') {
    result.usage = {
      input_tokens: 0,
      output_tokens: 0,
    };
  }
  return validateDriverResult(result, {
    invocation_id: admitted.invocation_id,
    driver_id: FAKE_DRIVER_ID,
    driver_version: FAKE_DRIVER_VERSION,
  });
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function report(error) {
  const code = typeof error?.code === 'string' ? error.code : 'DRIVER_FAILED';
  process.stderr.write(`${code}: driver protocol rejected\n`);
}

function main(argv) {
  const [command, ...rest] = argv;
  try {
    if (command === 'info' && rest.length === 0) {
      emit(driverInfo());
      return;
    }
    if (command === 'run' && rest.length === 0) {
      const request = parseDriverRequest(readFileSync(0));
      const profile = process.env.BATON_FAKE_PROFILE ?? 'completed';
      emit(runFake(request, profile));
      return;
    }
    fail('INVALID_INVOCATION', 'expected exactly info or run');
  } catch (error) {
    report(error);
    process.exitCode = 64;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}

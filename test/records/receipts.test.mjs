import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  ReceiptError,
  canonicalJSON,
  digestBytes,
  parsePlanBytes,
  parseReceiptBytes,
  parseReceiptCommitMessage,
  parseReceiptHistoryEntry,
  renderReceiptCommit,
  strictParseJSON,
} from '../../reference/records/receipts.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);
const OID_C = 'c'.repeat(40);
const DIGEST_A = `sha256:${'a'.repeat(64)}`;

function throwsCode(operation, code) {
  assert.throws(operation, (error) => error instanceof ReceiptError && error.code === code);
}

function planMetadata(overrides = {}) {
  return {
    schema_version: 'baton.plan/v2',
    release: 'receipt-test',
    revision: 1,
    previous_plan: null,
    repository: 'example/project',
    target_ref: 'refs/heads/main',
    approval_ref: 'approval://receipt-test/1',
    tracks: [
      {
        id: 'T1',
        depends_on: [],
        slices: [
          {
            id: 'S1',
            outcome: 'Deliver the product change.',
            scope: { include: ['src/product'], exclude: [] },
            acceptance: [{ id: 'A1', text: 'The result is observable.' }],
            checks: ['node --test'],
            constraints: [],
            depends_on: [],
            consumes: [],
          },
        ],
      },
      {
        id: 'T2',
        depends_on: ['T1'],
        slices: [
          {
            id: 'S2',
            outcome: 'Verify the assembled behavior.',
            scope: { include: ['test/acceptance'], exclude: [] },
            acceptance: [{ id: 'A2', text: 'The product passes acceptance.' }],
            checks: ['node --test test/acceptance'],
            constraints: [],
            depends_on: ['S1'],
            consumes: ['S1'],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function planBytes(metadata = planMetadata(), markdown = '\n# Receipt test\n') {
  return Buffer.from(`\`\`\`baton-plan-v2\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n${markdown}`);
}

function receipt(overrides = {}) {
  return {
    version: 1,
    release: 'receipt-test',
    slice: 'S1',
    role: 'captain',
    result: 'proceed',
    attempt: 1,
    plan: OID_A,
    contract: DIGEST_A,
    binds: OID_B,
    detail: digestBytes(Buffer.alloc(0)),
    summary: 'The design is safe to implement.',
    ...overrides,
  };
}

function candidateReceipt(overrides = {}) {
  return receipt({
    role: 'implementer',
    result: 'candidate',
    candidate: OID_C,
    product_tree: DIGEST_A,
    inputs: {},
    checks: DIGEST_A,
    ...overrides,
  });
}

test('plan revisions keep stable slice contracts and private raw bytes', () => {
  const source = planBytes();
  const parsed = parsePlanBytes(source);
  assert.equal(parsed.metadata.revision, 1);
  assert.match(parsed.metadata.contracts.S1, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(parsed.metadata.contracts.S1, parsed.metadata.contracts.S2);
  assert.equal(Object.isFrozen(parsed.metadata.tracks[0].slices[0]), true);

  const revision = planMetadata({
    revision: 2,
    previous_plan: OID_A,
    approval_ref: 'approval://receipt-test/2',
  });
  const revised = parsePlanBytes(planBytes(revision));
  assert.equal(revised.metadata.contracts.S1, parsed.metadata.contracts.S1);

  revision.tracks[0].slices[0].acceptance[0].text = 'The changed result is observable.';
  const changed = parsePlanBytes(planBytes(revision));
  assert.notEqual(changed.metadata.contracts.S1, parsed.metadata.contracts.S1);

  const exposed = parsed.bytes;
  exposed.fill(0);
  assert.notDeepEqual(exposed, parsed.bytes);
  source.fill(0);
  assert.match(parsed.digest, /^sha256:[0-9a-f]{64}$/);
});

test('plan validation rejects broken revision, dependency, and parallel ownership', () => {
  throwsCode(
    () => parsePlanBytes(planBytes(planMetadata({ revision: 2, previous_plan: null }))),
    'INVALID_FIELD',
  );
  const missing = planMetadata();
  missing.tracks[1].slices[0].depends_on = ['missing'];
  throwsCode(() => parsePlanBytes(planBytes(missing)), 'INVALID_DEPENDENCY');

  const overlap = planMetadata();
  overlap.tracks[1].depends_on = [];
  overlap.tracks[1].slices[0].depends_on = [];
  overlap.tracks[1].slices[0].consumes = [];
  overlap.tracks[1].slices[0].scope.include = ['src/product/nested'];
  throwsCode(() => parsePlanBytes(planBytes(overlap)), 'PARALLEL_TOUCH_CONFLICT');

  const duplicate = planMetadata();
  duplicate.tracks[1].slices[0].id = 'S1';
  throwsCode(() => parsePlanBytes(planBytes(duplicate)), 'DUPLICATE_IDENTITY');

  const serialCycle = planMetadata();
  serialCycle.tracks = [{
    id: 'T1',
    depends_on: [],
    slices: [
      {
        ...serialCycle.tracks[0].slices[0],
        depends_on: ['S2'],
      },
      {
        ...serialCycle.tracks[1].slices[0],
        depends_on: [],
        consumes: [],
      },
    ],
  }];
  throwsCode(() => parsePlanBytes(planBytes(serialCycle)), 'DEPENDENCY_CYCLE');

  const crossLayerCycle = planMetadata();
  crossLayerCycle.tracks[0].depends_on = ['T2'];
  crossLayerCycle.tracks[1].depends_on = [];
  crossLayerCycle.tracks[1].slices[0].consumes = [];
  throwsCode(() => parsePlanBytes(planBytes(crossLayerCycle)), 'DEPENDENCY_CYCLE');
});

test('receipt JSON is strict, canonical, bounded, and role-aware', () => {
  const canonical = Buffer.from(canonicalJSON(receipt()));
  assert.deepEqual(parseReceiptBytes(canonical), receipt());
  const reordered = Buffer.from(JSON.stringify(receipt()));
  assert.notDeepEqual(reordered, canonical);
  throwsCode(() => parseReceiptBytes(reordered), 'NON_CANONICAL_RECEIPT');
  throwsCode(
    () => parseReceiptBytes(Buffer.from('{"version":1,"version":1}')),
    'DUPLICATE_NAME',
  );
  throwsCode(
    () => parseReceiptBytes(Buffer.from(canonicalJSON(receipt({ result: 'pass' })))),
    'INVALID_FIELD',
  );
  throwsCode(
    () => parseReceiptBytes(Buffer.from(canonicalJSON(receipt({ summary: 'x'.repeat(281) })))),
    'INVALID_FIELD',
  );
  throwsCode(
    () => parseReceiptBytes(Buffer.from(canonicalJSON(receipt({
      role: 'implementer',
      result: 'candidate',
    })))),
    'MISSING_FIELD',
  );
  assert.equal(
    parseReceiptBytes(Buffer.from(canonicalJSON(candidateReceipt()))).candidate,
    OID_C,
  );
  const assembly = candidateReceipt({
    slice: undefined,
    attempt: undefined,
    contract: undefined,
    target: OID_A,
    base: OID_B,
  });
  delete assembly.slice;
  delete assembly.attempt;
  delete assembly.contract;
  assert.equal(
    parseReceiptBytes(Buffer.from(canonicalJSON(assembly))).target,
    OID_A,
  );
  assert.ok(strictParseJSON(readFileSync(path.join(ROOT, 'schemas/receipt-v1.json'))));
});

test('commit rendering binds exact LF-only detail without a circular hash', () => {
  const detail = Buffer.from('Approach: make the state derived.\nChecks: focused tests.');
  const message = renderReceiptCommit({
    subject: 'baton(S1): captain proceed',
    detail,
    receipt: receipt(),
  });
  const parsed = parseReceiptCommitMessage(message);
  assert.equal(parsed.subject, 'baton(S1): captain proceed');
  assert.deepEqual(parsed.detail, detail);
  assert.equal(parsed.receipt.detail, digestBytes(detail));
  const exposed = parsed.detail;
  exposed.fill(0);
  assert.deepEqual(parsed.detail, detail);

  const damaged = Buffer.from(message);
  damaged[damaged.indexOf(Buffer.from('make'))] = 'M'.charCodeAt(0);
  throwsCode(() => parseReceiptCommitMessage(damaged), 'STALE_BINDING');
  throwsCode(
    () => renderReceiptCommit({
      subject: 'bad',
      detail: Buffer.from('contains Baton-Detail-End'),
      receipt: receipt(),
    }),
    'INVALID_DETAIL',
  );
  throwsCode(
    () => renderReceiptCommit({
      subject: 'bad',
      detail: Buffer.from('CR\r\n'),
      receipt: receipt(),
    }),
    'INVALID_DETAIL',
  );
});

test('history entries require one parent and a metadata-only tree', () => {
  const message = renderReceiptCommit({
    subject: 'baton(S1): candidate',
    detail: 'Candidate checks passed.',
    receipt: candidateReceipt(),
  });
  const parsed = parseReceiptHistoryEntry({
    oid: OID_C,
    parents: [OID_A],
    tree: OID_B,
    parent_tree: OID_B,
    message,
  });
  assert.equal(parsed.receipt.candidate, OID_C);
  throwsCode(
    () => parseReceiptHistoryEntry({
      oid: OID_C,
      parents: [OID_A],
      tree: OID_B,
      parent_tree: OID_C,
      message,
    }),
    'PRODUCT_MUTATION',
  );
  throwsCode(
    () => parseReceiptHistoryEntry({
      oid: OID_C,
      parents: [OID_A, OID_B],
      tree: OID_C,
      parent_tree: OID_C,
      message,
    }),
    'INVALID_HISTORY',
  );
});

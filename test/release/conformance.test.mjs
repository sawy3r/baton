import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  readdir,
  readFile,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parsePlanBytes,
  parseReceiptCommitMessage,
} from '../../reference/records/receipts.mjs';
import {
  PORTABLE_RUNTIME_FILES,
  SUPPORT_FILES,
} from '../../scripts/lib/catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WALKTHROUGH = path.join(ROOT, 'examples/walkthrough');
const RECEIPT_FILES = Object.freeze([
  '01-plan-approved.txt',
  '02-S1-designed.txt',
  '03-S1-proceed.txt',
  '04-S1-candidate.txt',
  '05-S1-pass.txt',
  '06-S2-designed.txt',
  '07-S2-proceed.txt',
  '08-S2-candidate.txt',
  '09-S2-pass.txt',
  '10-assembly-candidate.txt',
  '11-assembly-pass.txt',
  '12-merged.txt',
]);
const RECEIPT_SEQUENCE = Object.freeze([
  ['planner', 'approved'],
  ['implementer', 'designed'],
  ['captain', 'proceed'],
  ['implementer', 'candidate'],
  ['verifier', 'pass'],
  ['implementer', 'designed'],
  ['captain', 'proceed'],
  ['implementer', 'candidate'],
  ['verifier', 'pass'],
  ['implementer', 'candidate'],
  ['verifier', 'pass'],
  ['merge', 'merged'],
]);

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function gitBlobOID(bytes) {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex');
}

async function filesUnder(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...await filesUnder(path.join(directory, entry.name), relative));
    } else {
      result.push(relative);
    }
  }
  return result.sort();
}

test('the manifest inventories compact receipts and Git-derived state truthfully', async () => {
  const version = (await readFile(path.join(ROOT, 'VERSION'), 'utf8')).trim();
  const manifest = JSON.parse(
    await readFile(path.join(ROOT, 'conformance/manifest.json'), 'utf8'),
  );
  assert.equal(manifest.schema_version, 'baton.conformance-manifest/v2');
  assert.equal(manifest.baton_version, version);

  const portable = manifest.profiles.portable_kit;
  assert.equal(portable.status, 'EXECUTABLE');
  assert.equal(portable.record_contract.plan.format, 'baton.plan/v2');
  assert.equal(portable.record_contract.receipt.representation, 'Baton-Receipt Git trailer');
  const schema = portable.record_contract.receipt.schema;
  const schemaBytes = await readFile(path.join(ROOT, schema.path));
  assert.equal(schema.path, 'schemas/receipt-v1.json');
  assert.equal(schema.digest, sha256(schemaBytes));
  assert.equal(
    portable.cases.some(({ id }) => id.includes('selective-invalidation')),
    true,
  );
  assert.equal(
    portable.cases.some(({ id }) => id.includes('git-derived-oracle')),
    true,
  );
  assert.equal(
    portable.commands.some((command) => /(?:driver|dogfood)/.test(command)),
    false,
  );
  assert.equal(portable.measurements.command, 'node scripts/measure-overhead.mjs --check');

  const contractPaths = [
    ...portable.record_contract.plan.valid_fixtures,
    ...portable.record_contract.plan.invalid_fixtures.map(({ instance }) => instance),
    schema.path,
    ...portable.record_contract.receipt.valid_fixtures,
    ...portable.record_contract.receipt.invalid_schema_fixtures,
    ...portable.record_contract.receipt.invalid_semantic_fixtures
      .map(({ instance }) => instance),
    ...portable.record_contract.strict_json_cases.map(({ instance }) => instance),
    portable.measurements.baseline,
    manifest.profiles.autonomous_engine.adapter_contract,
    ...portable.cases.flatMap(({ suites }) => suites),
  ];
  for (const relativePath of new Set(contractPaths)) {
    assert.equal((await stat(path.join(ROOT, relativePath))).isFile(), true, relativePath);
  }

  const engine = manifest.profiles.autonomous_engine;
  assert.equal(engine.status, 'NOT RUN');
  assert.equal(engine.cases.length, 12);
  assert.equal(engine.cases.every(({ status }) => status === 'NOT RUN'), true);
  assert.equal(new Set(engine.cases.map(({ id }) => id)).size, engine.cases.length);
});

test('the plan template and walkthrough use plan v2 with explicit revision ancestry', async () => {
  const template = parsePlanBytes(await readFile(path.join(ROOT, 'templates/plan.md')));
  assert.equal(template.metadata.schema_version, 'baton.plan/v2');
  assert.equal(template.metadata.revision, 1);
  assert.equal(template.metadata.previous_plan, null);
  assert.deepEqual(Object.keys(template.metadata.contracts), ['S1']);

  const example = parsePlanBytes(await readFile(path.join(WALKTHROUGH, 'plan.md')));
  assert.equal(example.metadata.revision, 1);
  assert.equal(example.metadata.previous_plan, null);
  assert.deepEqual(Object.keys(example.metadata.contracts), ['S1', 'S2']);
  assert.equal(example.metadata.tracks[0].slices[0].id, 'S1');
  assert.equal(example.metadata.tracks[1].slices[0].id, 'S2');
});

test('the walkthrough replaces status and proof records with canonical receipt commits', async () => {
  const planBytes = await readFile(path.join(WALKTHROUGH, 'plan.md'));
  const plan = parsePlanBytes(planBytes);
  const planOID = gitBlobOID(planBytes);
  const observedFiles = await filesUnder(WALKTHROUGH);
  assert.deepEqual(observedFiles, [
    'approval.txt',
    'plan.md',
    ...RECEIPT_FILES.map((entry) => `receipts/${entry}`),
  ].sort());

  for (const [index, file] of RECEIPT_FILES.entries()) {
    const parsed = parseReceiptCommitMessage(
      await readFile(path.join(WALKTHROUGH, 'receipts', file)),
    );
    const receipt = parsed.receipt;
    assert.equal(receipt.version, 1, file);
    assert.equal(receipt.release, 'checkout-recovery', file);
    assert.equal(receipt.plan, planOID, file);
    assert.deepEqual([receipt.role, receipt.result], RECEIPT_SEQUENCE[index], file);
    if (receipt.slice) {
      assert.equal(receipt.contract, plan.metadata.contracts[receipt.slice], file);
    }
  }
});

test('the install catalog contains only the compact active reference kit', () => {
  assert.deepEqual(PORTABLE_RUNTIME_FILES, [
    'reference/board/oracle.mjs',
    'reference/board/terminal.mjs',
  ]);
  for (const required of [
    'schemas/receipt-v1.json',
    'reference/records/receipts.mjs',
    'templates/plan.md',
  ]) {
    assert.equal(SUPPORT_FILES.includes(required), true, required);
  }
  for (const retired of [
    'schemas/work-status-v1.json',
    'reference/records/records.mjs',
    'reference/records/transition.mjs',
    'reference/driver/fake-driver.mjs',
    'templates/design.md',
    'templates/proof.md',
  ]) {
    assert.equal(SUPPORT_FILES.includes(retired), false, retired);
  }
});

test('the portable Python dependency is explicit and singular', async () => {
  const requirements = (await readFile(
    path.join(ROOT, 'conformance/requirements.txt'),
    'utf8',
  )).trim().split('\n').filter(Boolean);
  assert.equal(requirements.length, 1);
  assert.match(requirements[0], /^jsonschema==[0-9]+\.[0-9]+\.[0-9]+$/);
});

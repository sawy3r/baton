import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  readFile,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

test('the RC2 manifest inventories executable portable and unrun engine profiles truthfully', async () => {
  const version = (await readFile(path.join(ROOT, 'VERSION'), 'utf8')).trim();
  const manifest = JSON.parse(
    await readFile(path.join(ROOT, 'conformance/manifest.json'), 'utf8'),
  );
  assert.equal(manifest.schema_version, 'baton.conformance-manifest/v2');
  assert.equal(manifest.baton_version, version);

  const portable = manifest.profiles.portable_kit;
  assert.equal(portable.status, 'EXECUTABLE');
  assert.equal(
    portable.commands.some((command) => command.includes('test/dogfood/*.test.mjs')),
    true,
  );
  assert.equal(
    portable.cases.some(({ id }) => id === 'real-git-manual-dogfood'),
    true,
  );
  const schemaBytes = await readFile(path.join(ROOT, portable.record_contract.schema.path));
  assert.equal(portable.record_contract.schema.digest, sha256(schemaBytes));
  assert.equal(portable.measurements.command, 'node scripts/measure-overhead.mjs --check');

  for (const relativePath of [
    portable.record_contract.schema.path,
    portable.measurements.baseline,
    manifest.profiles.autonomous_engine.adapter_contract,
    ...portable.cases.flatMap(({ suites }) => suites.filter((entry) => !entry.includes('*'))),
  ]) {
    assert.equal((await stat(path.join(ROOT, relativePath))).isFile(), true, relativePath);
  }

  const engine = manifest.profiles.autonomous_engine;
  assert.equal(engine.status, 'NOT RUN');
  assert.equal(engine.cases.length, 12);
  assert.equal(engine.cases.every(({ status }) => status === 'NOT RUN'), true);
  assert.equal(new Set(engine.cases.map(({ id }) => id)).size, engine.cases.length);
});

test('the portable Python dependency is explicit and singular', async () => {
  const requirements = (await readFile(
    path.join(ROOT, 'conformance/requirements.txt'),
    'utf8',
  )).trim().split('\n').filter(Boolean);
  assert.equal(requirements.length, 1);
  assert.match(requirements[0], /^jsonschema==[0-9]+\.[0-9]+\.[0-9]+$/);
});

import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  checkGenerated,
  extractCanonicalRegion,
  PAYLOAD_MANIFEST_NAME,
  renderGenerated,
  writeGenerated,
} from '../../scripts/generate-skills.mjs';
import { digestEntries, sha256 } from '../../scripts/lib/digest.mjs';
import {
  GENERATOR_VERSION,
  OPERATIONS,
  OPERATION_VERSION,
  PAYLOAD_MANIFEST_VERSION,
} from '../../scripts/lib/payload.mjs';

const ROOT = resolve(import.meta.dirname, '../..');

async function tree(root, prefix = '') {
  const result = new Map();
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
  for (const entry of entries) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      for (const [child, bytes] of await tree(root, path)) result.set(child, bytes);
    } else {
      result.set(path, await readFile(join(root, path)));
    }
  }
  return result;
}

test('two independent generations are byte-identical and match the checked-in payload', async (t) => {
  const first = await mkdtemp(join(tmpdir(), 'baton-skills-a-'));
  const second = await mkdtemp(join(tmpdir(), 'baton-skills-b-'));
  t.after(async () => {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  });
  await writeGenerated({ bundleRoot: ROOT, outputRoot: first });
  await writeGenerated({ bundleRoot: ROOT, outputRoot: second });
  const firstTree = await tree(first);
  const secondTree = await tree(second);
  assert.deepEqual([...firstTree.keys()], [...secondTree.keys()]);
  for (const [path, bytes] of firstTree) {
    assert.deepEqual(bytes, secondTree.get(path), path);
  }
  await checkGenerated({ bundleRoot: ROOT, outputRoot: first });
  await checkGenerated({ bundleRoot: ROOT, outputRoot: join(ROOT, 'skills') });
});

test('the payload is five standalone skills with exact canonical text and provenance', async () => {
  const { files, manifest } = await renderGenerated({ bundleRoot: ROOT });
  const version = (await readFile(join(ROOT, 'VERSION'), 'utf8')).trim();
  assert.equal(manifest.schema_version, PAYLOAD_MANIFEST_VERSION);
  assert.equal(manifest.release, `v${version}`);
  assert.equal(manifest.generator_version, GENERATOR_VERSION);
  assert.equal(manifest.operation_version, OPERATION_VERSION);
  assert.deepEqual(
    manifest.skills.map(({ name }) => name),
    OPERATIONS.map(({ name }) => name),
  );
  assert.equal(manifest.skills.length, 5);
  assert.equal(manifest.files.length, 6);
  assert.equal(manifest.payload_digest, digestEntries(manifest.files));
  assert.deepEqual(
    (await readdir(join(ROOT, 'skills'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => name)
      .sort(),
    OPERATIONS.map(({ name }) => name).sort(),
  );

  for (const operation of OPERATIONS) {
    const source = await readFile(join(ROOT, operation.source));
    const path = `${operation.name}/SKILL.md`;
    const skill = files.get(path);
    assert.deepEqual(extractCanonicalRegion(skill, operation.name), source);
    const text = skill.toString('utf8');
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, path);
    assert.deepEqual(
      frontmatter[1].split('\n').map((line) => line.split(':', 1)[0]),
      ['name', 'description'],
    );
    assert.match(text, new RegExp(`release: v${version.replaceAll('.', '\\.')}`));
    assert.match(text, new RegExp(`operation-sha256: ${sha256(source)}`));
    assert.equal(
      text.match(new RegExp(`<!-- BATON_CANONICAL_BEGIN ${operation.name} -->`, 'g')).length,
      1,
    );
    assert.doesNotMatch(
      text,
      /(?:\.claude|\.codex|\.agents|adapters\/|operations\/|reference\/|schemas\/|\.\.\/)/,
    );
    for (const reference of text.matchAll(/`((?:templates|resources)\/[^`]+)`/g)) {
      assert.ok(files.has(`${operation.name}/${reference[1]}`), reference[1]);
    }
  }

  const templatePath = 'baton-plan/templates/plan.md';
  assert.deepEqual(files.get(templatePath), await readFile(join(ROOT, 'templates/plan.md')));
  for (const record of manifest.files) {
    assert.equal('mode' in record, false, record.path);
    assert.equal(record.release, `v${version}`, record.path);
    assert.equal(record.digest, sha256(files.get(record.path)), record.path);
    assert.equal(
      record.source_digest,
      sha256(await readFile(join(ROOT, record.source))),
      record.path,
    );
  }
  assert.ok(files.has(PAYLOAD_MANIFEST_NAME));
});

test('unexpected generated entries are rejected rather than adopted', async (t) => {
  const output = await mkdtemp(join(tmpdir(), 'baton-skills-unowned-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  await writeGenerated({ bundleRoot: ROOT, outputRoot: output });
  await writeFile(join(output, 'unexpected.txt'), 'foreign\n');
  await assert.rejects(
    writeGenerated({ bundleRoot: ROOT, outputRoot: output }),
    /unexpected generated entries/,
  );
});

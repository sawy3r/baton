import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  checkGenerated,
  extractCanonicalRegion,
  renderGenerated,
  writeGenerated,
} from '../../scripts/generate-adapters.mjs';
import {
  GENERATOR_VERSION,
  OPERATIONS,
  OPERATION_VERSION,
} from '../../scripts/lib/catalog.mjs';
import { sha256 } from '../../scripts/lib/digest.mjs';

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

test('two independent generations are byte-identical and match checked-in output', async (t) => {
  const first = await mkdtemp(join(tmpdir(), 'baton-adapters-a-'));
  const second = await mkdtemp(join(tmpdir(), 'baton-adapters-b-'));
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
  await checkGenerated({
    bundleRoot: ROOT,
    outputRoot: join(ROOT, 'adapters', 'generated'),
  });
});

test('each host adapter has minimal frontmatter and one exact canonical region', async () => {
  const { files, manifest } = await renderGenerated({ bundleRoot: ROOT });
  assert.equal(manifest.generator_version, GENERATOR_VERSION);
  assert.equal(manifest.operation_version, OPERATION_VERSION);
  assert.equal(manifest.packages.claude.digest, manifest.package_digest);
  assert.equal(manifest.packages.codex.digest, manifest.package_digest);
  assert.equal(manifest.operations.length, 5);
  assert.equal(manifest.adapters.length, 10);

  for (const operation of OPERATIONS) {
    const source = await readFile(join(ROOT, operation.source));
    const record = manifest.operations.find(({ name }) => name === operation.name);
    assert.equal(record.digest, sha256(source));
    assert.equal(record.version, OPERATION_VERSION);
    for (const host of ['claude', 'codex']) {
      const path = `${host}/skills/${operation.name}/SKILL.md`;
      const adapter = files.get(path);
      assert.deepEqual(extractCanonicalRegion(adapter, operation.name), source);
      const text = adapter.toString('utf8');
      const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
      assert.ok(frontmatter, path);
      assert.deepEqual(
        frontmatter[1].split('\n').map((line) => line.split(':', 1)[0]),
        ['name', 'description'],
      );
      assert.equal(
        text.match(new RegExp(`<!-- BATON_CANONICAL_BEGIN ${operation.name} -->`, 'g')).length,
        1,
      );
      assert.match(text, new RegExp(`operation-sha256: ${record.digest}`));
    }
  }
});

test('unexpected generated ownership is rejected', async (t) => {
  const output = await mkdtemp(join(tmpdir(), 'baton-adapters-unowned-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  await writeGenerated({ bundleRoot: ROOT, outputRoot: output });
  await import('node:fs/promises').then(({ writeFile }) => (
    writeFile(join(output, 'unexpected.txt'), 'foreign\n')
  ));
  await assert.rejects(
    writeGenerated({ bundleRoot: ROOT, outputRoot: output }),
    /unexpected generated files/,
  );
});


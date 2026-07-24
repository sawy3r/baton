#!/usr/bin/env node

import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  GENERATED_BEGIN,
  GENERATED_END,
  GENERATED_MANIFEST_VERSION,
  GENERATOR_VERSION,
  HOSTS,
  OPERATIONS,
  OPERATION_VERSION,
  PACKAGE_VERSION_FILE,
  SUPPORT_FILES,
} from './lib/catalog.mjs';
import { digestEntries, sha256, stableJSON } from './lib/digest.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BUNDLE_ROOT = resolve(SCRIPT_DIR, '..');
export const DEFAULT_OUTPUT_ROOT = join(DEFAULT_BUNDLE_ROOT, 'adapters', 'generated');

async function packageVersion(bundleRoot) {
  const version = (await readFile(join(bundleRoot, PACKAGE_VERSION_FILE), 'utf8')).trim();
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid package version ${JSON.stringify(version)}`);
  }
  return version;
}

async function supportEntries(bundleRoot) {
  return Promise.all(SUPPORT_FILES.map(async (path) => {
    const bytes = await readFile(join(bundleRoot, path));
    return { path, mode: '0644', digest: sha256(bytes) };
  }));
}

function markers(operation) {
  return {
    begin: `${GENERATED_BEGIN} ${operation.name} -->\n`,
    end: `${GENERATED_END} ${operation.name} -->\n`,
  };
}

function renderAdapter({ host, operation, operationBytes, packageVersion: version }) {
  const operationDigest = sha256(operationBytes);
  const { begin, end } = markers(operation);
  const prefix = Buffer.from(
    `---\n`
      + `name: ${operation.name}\n`
      + `description: ${JSON.stringify(operation.description)}\n`
      + `---\n\n`
      + `<!-- baton-adapter\n`
      + `package-version: ${version}\n`
      + `operation-version: ${OPERATION_VERSION}\n`
      + `operation-sha256: ${operationDigest}\n`
      + `-->\n\n`
      + `${host.bridge}\n\n`
      + begin,
  );
  return Buffer.concat([prefix, operationBytes, Buffer.from(end)]);
}

export function extractCanonicalRegion(adapterBytes, operationName) {
  const { begin, end } = markers({ name: operationName });
  const beginBytes = Buffer.from(begin);
  const endBytes = Buffer.from(end);
  const start = adapterBytes.indexOf(beginBytes);
  if (start === -1) throw new Error(`missing canonical start for ${operationName}`);
  const contentStart = start + beginBytes.length;
  const finish = adapterBytes.indexOf(endBytes, contentStart);
  if (finish === -1) throw new Error(`missing canonical end for ${operationName}`);
  if (adapterBytes.indexOf(beginBytes, contentStart) !== -1) {
    throw new Error(`duplicate canonical start for ${operationName}`);
  }
  if (adapterBytes.indexOf(endBytes, finish + endBytes.length) !== -1) {
    throw new Error(`duplicate canonical end for ${operationName}`);
  }
  return adapterBytes.subarray(contentStart, finish);
}

export async function renderGenerated({
  bundleRoot = DEFAULT_BUNDLE_ROOT,
} = {}) {
  const version = await packageVersion(bundleRoot);
  const commonEntries = await supportEntries(bundleRoot);
  const packageDigest = digestEntries(commonEntries);
  const files = new Map();
  const operationRecords = [];
  const adapterRecords = [];

  for (const operation of OPERATIONS) {
    const operationBytes = await readFile(join(bundleRoot, operation.source));
    const operationDigest = sha256(operationBytes);
    operationRecords.push({
      name: operation.name,
      version: OPERATION_VERSION,
      source: operation.source,
      digest: operationDigest,
    });

    for (const host of Object.values(HOSTS)) {
      const path = `${host.name}/skills/${operation.name}/SKILL.md`;
      const bytes = renderAdapter({
        host,
        operation,
        operationBytes,
        packageVersion: version,
      });
      if (!extractCanonicalRegion(bytes, operation.name).equals(operationBytes)) {
        throw new Error(`canonical operation mismatch for ${host.name}/${operation.name}`);
      }
      files.set(path, bytes);
      adapterRecords.push({
        host: host.name,
        operation: operation.name,
        path,
        digest: sha256(bytes),
        canonical_digest: operationDigest,
      });
    }
  }

  const manifest = {
    schema_version: GENERATED_MANIFEST_VERSION,
    package_version: version,
    package_digest: packageDigest,
    generator_version: GENERATOR_VERSION,
    operation_version: OPERATION_VERSION,
    packages: {
      claude: { digest: packageDigest },
      codex: { digest: packageDigest },
    },
    operations: operationRecords,
    adapters: adapterRecords,
  };
  files.set('generated-manifest.json', stableJSON(manifest));
  return { files, manifest };
}

async function existingFiles(root) {
  const found = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) found.push(relative(root, absolute));
      else found.push(relative(root, absolute));
    }
  }
  await walk(root);
  return found.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

export async function writeGenerated({
  bundleRoot = DEFAULT_BUNDLE_ROOT,
  outputRoot = DEFAULT_OUTPUT_ROOT,
} = {}) {
  const { files, manifest } = await renderGenerated({ bundleRoot });
  const expected = [...files.keys()].sort();
  const unexpected = (await existingFiles(outputRoot)).filter((path) => !files.has(path));
  if (unexpected.length > 0) {
    throw new Error(`refusing to replace unexpected generated files: ${unexpected.join(', ')}`);
  }
  for (const path of expected) {
    const absolute = join(outputRoot, path);
    await mkdir(dirname(absolute), { recursive: true, mode: 0o755 });
    await writeFile(absolute, files.get(path), { mode: 0o644 });
    await chmod(absolute, 0o644);
  }
  return manifest;
}

export async function checkGenerated({
  bundleRoot = DEFAULT_BUNDLE_ROOT,
  outputRoot = DEFAULT_OUTPUT_ROOT,
} = {}) {
  const { files, manifest } = await renderGenerated({ bundleRoot });
  const observed = await existingFiles(outputRoot);
  const expected = [...files.keys()].sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(
      `generated path mismatch\nexpected: ${expected.join(', ')}\nobserved: ${observed.join(', ')}`,
    );
  }
  for (const path of expected) {
    const absolute = join(outputRoot, path);
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error(`generated path is not a file: ${path}`);
    const bytes = await readFile(absolute);
    if (!bytes.equals(files.get(path))) throw new Error(`generated bytes differ: ${path}`);
  }
  return manifest;
}

function parseArguments(argv) {
  if (argv.length === 0) return { check: false };
  if (argv.length === 1 && argv[0] === '--check') return { check: true };
  throw new Error('usage: node scripts/generate-adapters.mjs [--check]');
}

async function main() {
  const { check } = parseArguments(process.argv.slice(2));
  const manifest = check
    ? await checkGenerated()
    : await writeGenerated();
  process.stdout.write(
    `${check ? 'checked' : 'generated'} ${manifest.adapters.length} adapters for `
      + `${manifest.operations.length} operations; package ${manifest.package_digest}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

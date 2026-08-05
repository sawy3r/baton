#!/usr/bin/env node

import {
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { digestEntries, sha256, stableJSON } from './lib/digest.mjs';
import {
  GENERATED_BEGIN,
  GENERATED_END,
  GENERATOR_VERSION,
  OPERATIONS,
  OPERATION_VERSION,
  PACKAGE_VERSION_FILE,
  PAYLOAD_MANIFEST_VERSION,
  SUPPORT_PACKAGES,
} from './lib/payload.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BUNDLE_ROOT = resolve(SCRIPT_DIR, '..');
export const DEFAULT_OUTPUT_ROOT = join(DEFAULT_BUNDLE_ROOT, 'skills');
export const PAYLOAD_MANIFEST_NAME = '.baton-payload.json';

async function packageVersion(bundleRoot) {
  const version = (await readFile(join(bundleRoot, PACKAGE_VERSION_FILE), 'utf8')).trim();
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid package version ${JSON.stringify(version)}`);
  }
  return version;
}

function markers(operation) {
  return {
    begin: `${GENERATED_BEGIN} ${operation.name} -->\n`,
    end: `${GENERATED_END} ${operation.name} -->\n`,
  };
}

function renderSkill({ operation, operationBytes, version }) {
  const operationDigest = sha256(operationBytes);
  const { begin, end } = markers(operation);
  const prefix = Buffer.from(
    `---\n`
      + `name: ${operation.name}\n`
      + `description: ${JSON.stringify(operation.description)}\n`
      + `---\n\n`
      + `<!-- baton-skill\n`
      + `release: v${version}\n`
      + `generator-version: ${GENERATOR_VERSION}\n`
      + `operation-version: ${OPERATION_VERSION}\n`
      + `operation-sha256: ${operationDigest}\n`
      + `-->\n\n`
      + 'Use the invoking request as input. '
      + 'Resolve relative files from this directory. '
      + 'This standalone skill needs no shared Baton folder.\n\n'
      + begin,
  );
  return Buffer.concat([prefix, operationBytes, Buffer.from(end)]);
}

export function extractCanonicalRegion(skillBytes, operationName) {
  const { begin, end } = markers({ name: operationName });
  const beginBytes = Buffer.from(begin);
  const endBytes = Buffer.from(end);
  const start = skillBytes.indexOf(beginBytes);
  if (start === -1) throw new Error(`missing canonical start for ${operationName}`);
  const contentStart = start + beginBytes.length;
  const finish = skillBytes.indexOf(endBytes, contentStart);
  if (finish === -1) throw new Error(`missing canonical end for ${operationName}`);
  if (skillBytes.indexOf(beginBytes, contentStart) !== -1) {
    throw new Error(`duplicate canonical start for ${operationName}`);
  }
  if (skillBytes.indexOf(endBytes, finish + endBytes.length) !== -1) {
    throw new Error(`duplicate canonical end for ${operationName}`);
  }
  return skillBytes.subarray(contentStart, finish);
}

function sorted(values) {
  return [...values].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function parentDirectories(paths) {
  const directories = new Set();
  for (const path of paths) {
    let parent = dirname(path).replaceAll('\\', '/');
    while (parent !== '.' && parent !== '') {
      directories.add(parent);
      parent = dirname(parent).replaceAll('\\', '/');
    }
  }
  return sorted(directories);
}

export async function renderGenerated({
  bundleRoot = DEFAULT_BUNDLE_ROOT,
} = {}) {
  const version = await packageVersion(bundleRoot);
  const release = `v${version}`;
  const files = new Map();
  const records = [];
  const skills = [];
  const support = [];

  for (const operation of OPERATIONS) {
    const operationBytes = await readFile(join(bundleRoot, operation.source));
    const operationDigest = sha256(operationBytes);
    const skillPath = `${operation.name}/SKILL.md`;
    const skillBytes = renderSkill({ operation, operationBytes, version });
    if (!extractCanonicalRegion(skillBytes, operation.name).equals(operationBytes)) {
      throw new Error(`canonical operation mismatch for ${operation.name}`);
    }
    files.set(skillPath, skillBytes);
    records.push({
      path: skillPath,
      digest: sha256(skillBytes),
      release,
      source: operation.source,
      source_digest: operationDigest,
    });

    const skillFiles = [skillPath];
    for (const resource of operation.resources) {
      const bytes = await readFile(join(bundleRoot, resource.source));
      const path = `${operation.name}/${resource.path}`;
      files.set(path, bytes);
      records.push({
        path,
        digest: sha256(bytes),
        release,
        source: resource.source,
        source_digest: sha256(bytes),
      });
      skillFiles.push(path);
    }
    skills.push({
      name: operation.name,
      path: operation.name,
      operation_source: operation.source,
      operation_digest: operationDigest,
      files: sorted(skillFiles),
    });
  }

  for (const packageDefinition of SUPPORT_PACKAGES) {
    const packageFiles = [];
    for (const source of packageDefinition.files) {
      const path = `${packageDefinition.path}/${source}`;
      const bytes = await readFile(join(bundleRoot, source));
      files.set(path, bytes);
      records.push({
        path,
        digest: sha256(bytes),
        release,
        source,
        source_digest: sha256(bytes),
      });
      packageFiles.push(path);
    }
    support.push({
      name: packageDefinition.name,
      path: packageDefinition.path,
      entrypoints: packageDefinition.entrypoints,
      files: sorted(packageFiles),
    });
  }

  records.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const payloadDigest = digestEntries(records);
  const manifest = {
    schema_version: PAYLOAD_MANIFEST_VERSION,
    release,
    package_version: version,
    payload_digest: payloadDigest,
    generator_version: GENERATOR_VERSION,
    operation_version: OPERATION_VERSION,
    skills,
    support,
    files: records,
  };
  files.set(PAYLOAD_MANIFEST_NAME, stableJSON(manifest));
  return { files, manifest };
}

async function existingEntries(root) {
  const found = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).replaceAll('\\', '/');
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        found.push(`symlink:${path}`);
      } else if (info.isDirectory()) {
        found.push(`directory:${path}`);
        await walk(absolute);
      } else if (info.isFile()) {
        found.push(`file:${path}`);
      } else {
        found.push(`other:${path}`);
      }
    }
  }
  await walk(root);
  return sorted(found);
}

function expectedEntries(files) {
  const paths = [...files.keys()];
  return sorted([
    ...parentDirectories(paths).map((path) => `directory:${path}`),
    ...paths.map((path) => `file:${path}`),
  ]);
}

export async function writeGenerated({
  bundleRoot = DEFAULT_BUNDLE_ROOT,
  outputRoot = DEFAULT_OUTPUT_ROOT,
} = {}) {
  const { files, manifest } = await renderGenerated({ bundleRoot });
  const expected = expectedEntries(files);
  const observed = await existingEntries(outputRoot);
  const unexpected = observed.filter((entry) => !expected.includes(entry));
  if (unexpected.length > 0) {
    throw new Error(`refusing to replace unexpected generated entries: ${unexpected.join(', ')}`);
  }
  for (const path of sorted(files.keys())) {
    const absolute = join(outputRoot, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, files.get(path));
  }
  return manifest;
}

export async function checkGenerated({
  bundleRoot = DEFAULT_BUNDLE_ROOT,
  outputRoot = DEFAULT_OUTPUT_ROOT,
} = {}) {
  const { files, manifest } = await renderGenerated({ bundleRoot });
  const observed = await existingEntries(outputRoot);
  const expected = expectedEntries(files);
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(
      `generated entry mismatch\nexpected: ${expected.join(', ')}\n`
      + `observed: ${observed.join(', ')}`,
    );
  }
  for (const path of sorted(files.keys())) {
    const absolute = join(outputRoot, path);
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`generated path is not a regular file: ${path}`);
    }
    const bytes = await readFile(absolute);
    if (!bytes.equals(files.get(path))) throw new Error(`generated bytes differ: ${path}`);
  }
  return manifest;
}

function parseArguments(argv) {
  if (argv.length === 0) return { check: false };
  if (argv.length === 1 && argv[0] === '--check') return { check: true };
  throw new Error('usage: node scripts/generate-skills.mjs [--check]');
}

async function main() {
  const { check } = parseArguments(process.argv.slice(2));
  const manifest = check
    ? await checkGenerated()
    : await writeGenerated();
  process.stdout.write(
    `${check ? 'checked' : 'generated'} ${manifest.skills.length} standalone skills; `
      + `payload ${manifest.payload_digest}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

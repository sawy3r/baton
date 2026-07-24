import {
  lstat,
  readFile,
  readdir,
} from 'node:fs/promises';
import { join } from 'node:path';

import { sha256 } from './digest.mjs';
import { fail, safeRelativePath } from './paths.mjs';

export const LEGACY_SCHEMA_VERSION = 'baton.legacy-install/v0.16.0';

async function maybeLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function validateEntries(entries, label, expectedCount) {
  if (
    entries === null
    || typeof entries !== 'object'
    || Array.isArray(entries)
    || Object.getPrototypeOf(entries) !== Object.prototype
    || Object.keys(entries).length !== expectedCount
  ) {
    fail('INVALID_LEGACY_MANIFEST', `${label} must contain ${expectedCount} exact entries`);
  }
  for (const [path, identity] of Object.entries(entries)) {
    safeRelativePath(path, `${label} path`);
    if (
      !Array.isArray(identity)
      || identity.length !== 2
      || !/^0[0-7]{3}$/.test(identity[0])
      || !/^sha256:[0-9a-f]{64}$/.test(identity[1])
    ) {
      fail('INVALID_LEGACY_MANIFEST', `${label} identity is invalid for ${path}`);
    }
  }
}

function validateLegacyManifest(manifest) {
  if (
    manifest?.schema_version !== LEGACY_SCHEMA_VERSION
    || Object.keys(manifest).sort().join(',') !== 'commands,instruction_block,package_files,schema_version'
  ) {
    fail('INVALID_LEGACY_MANIFEST', 'legacy manifest has an invalid field set');
  }
  validateEntries(manifest.commands, 'legacy commands', 8);
  validateEntries(manifest.package_files, 'legacy package', 79);
  if (
    manifest.instruction_block?.path !== 'CLAUDE.md'
    || manifest.instruction_block.start_line !== 5
    || !/^sha256:[0-9a-f]{64}$/.test(manifest.instruction_block.digest)
  ) {
    fail('INVALID_LEGACY_MANIFEST', 'legacy instruction block identity is invalid');
  }
  return manifest;
}

export async function loadLegacyIdentity(bundleRoot) {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(join(bundleRoot, 'legacy', 'v0.16.0', 'install-manifest.json'), 'utf8'),
    );
  } catch (error) {
    fail('INVALID_LEGACY_MANIFEST', 'cannot read the legacy manifest', error);
  }
  validateLegacyManifest(manifest);
  const block = await readFile(join(bundleRoot, 'legacy', 'v0.16.0', 'claude-global-block.md'));
  if (sha256(block) !== manifest.instruction_block.digest) {
    fail('INVALID_LEGACY_MANIFEST', 'checked-in legacy instruction block digest differs');
  }
  return { manifest, block };
}

async function observedFiles(root) {
  const info = await maybeLstat(root);
  if (!info) return null;
  if (info.isSymbolicLink() || !info.isDirectory()) {
    fail('LEGACY_FINGERPRINT_MISMATCH', 'legacy package root is not a real directory');
  }
  const files = [];
  async function walk(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        fail('LEGACY_FINGERPRINT_MISMATCH', `${relativePath} is not a regular legacy file`);
      }
    }
  }
  await walk(root, '');
  return files;
}

async function verifyFile(path, identity, label) {
  const info = await maybeLstat(path);
  if (!info || info.isSymbolicLink() || !info.isFile()) {
    fail('LEGACY_FINGERPRINT_MISMATCH', `${label} is absent or not a regular file`);
  }
  const mode = `0${(info.mode & 0o777).toString(8).padStart(3, '0')}`;
  if (mode !== identity[0] || sha256(await readFile(path)) !== identity[1]) {
    fail('LEGACY_FINGERPRINT_MISMATCH', `${label} differs from the exact v0.16 identity`);
  }
}

function splitAfterLines(bytes, count) {
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    offset = bytes.indexOf(0x0a, offset);
    if (offset === -1) {
      fail('LEGACY_FINGERPRINT_MISMATCH', 'legacy CLAUDE.md has fewer than four prefix lines');
    }
    offset += 1;
  }
  return { prefix: bytes.subarray(0, offset), suffix: bytes.subarray(offset) };
}

export function legacyAffectedPaths(paths, manifest) {
  return [
    paths.supportRoot,
    ...Object.keys(manifest.commands).map((path) => join(paths.supportBase, path)),
    paths.instructionPath,
  ];
}

export async function inspectLegacyClaude({ bundleRoot, paths }) {
  if (paths.host !== 'claude' || paths.scope !== 'user') {
    return { state: 'none', commandPaths: [], prefix: null };
  }
  const identity = await loadLegacyIdentity(bundleRoot);
  const packageFiles = await observedFiles(paths.supportRoot);
  const commandPresence = [];
  for (const path of Object.keys(identity.manifest.commands)) {
    commandPresence.push(Boolean(await maybeLstat(join(paths.supportBase, path))));
  }
  const instructionInfo = await maybeLstat(paths.instructionPath);
  let instruction = null;
  if (instructionInfo) {
    if (instructionInfo.isSymbolicLink() || !instructionInfo.isFile()) {
      fail('LEGACY_FINGERPRINT_MISMATCH', 'CLAUDE.md is not a regular file');
    }
    instruction = splitAfterLines(await readFile(paths.instructionPath), 4);
  }
  const exactBlockPresent = Boolean(
    instruction && sha256(instruction.suffix) === identity.manifest.instruction_block.digest,
  );
  const markerPresent = packageFiles !== null || commandPresence.some(Boolean) || exactBlockPresent;
  if (!markerPresent) {
    return { state: 'none', commandPaths: [], prefix: null };
  }
  if (packageFiles === null || !commandPresence.every(Boolean) || !instruction) {
    fail('LEGACY_FINGERPRINT_MISMATCH', 'legacy v0.16 installation is incomplete');
  }
  const expectedPaths = Object.keys(identity.manifest.package_files).sort();
  if (JSON.stringify(packageFiles) !== JSON.stringify(expectedPaths)) {
    fail('LEGACY_FINGERPRINT_MISMATCH', 'legacy package path set differs from v0.16');
  }
  for (const path of expectedPaths) {
    await verifyFile(
      join(paths.supportRoot, path),
      identity.manifest.package_files[path],
      `legacy package ${path}`,
    );
  }
  const commandPaths = [];
  for (const [path, fileIdentity] of Object.entries(identity.manifest.commands)) {
    const absolute = join(paths.supportBase, path);
    await verifyFile(absolute, fileIdentity, `legacy ${path}`);
    commandPaths.push(absolute);
  }
  if (!instruction.suffix.equals(identity.block)) {
    fail('LEGACY_FINGERPRINT_MISMATCH', 'legacy CLAUDE.md block differs from v0.16');
  }
  return {
    state: 'exact',
    commandPaths,
    prefix: Buffer.from(instruction.prefix),
    identity,
  };
}

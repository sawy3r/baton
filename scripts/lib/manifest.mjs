import {
  chmod,
  lstat,
  readFile,
  readdir,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  GENERATOR_VERSION,
  INSTALL_MANIFEST_VERSION,
  OPERATIONS,
  OPERATION_VERSION,
  SUPPORT_FILES,
} from './catalog.mjs';
import { digestEntries, sha256, stableJSON } from './digest.mjs';
import { fail, safeRelativePath } from './paths.mjs';

export const INSTALL_MANIFEST_NAME = 'install-manifest.json';

async function maybeLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function exactKeys(value, keys, label) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail('INVALID_MANIFEST', `${label} must be an object`);
  }
  const observed = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    fail('INVALID_MANIFEST', `${label} has an invalid field set`);
  }
}

function digest(value, label) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail('INVALID_MANIFEST', `${label} must be a SHA-256 digest`);
  }
  return value;
}

function mode(value, label) {
  if (typeof value !== 'string' || !/^0[0-7]{3}$/.test(value)) {
    fail('INVALID_MANIFEST', `${label} must be a four-digit mode`);
  }
  return value;
}

function operationMap(generatedManifest) {
  return new Map(generatedManifest.operations.map((operation) => [
    operation.name,
    operation,
  ]));
}

export function validateInstallManifest(value, paths) {
  exactKeys(
    value,
    [
      'schema_version',
      'host',
      'scope',
      'package_version',
      'package_digest',
      'generator_version',
      'operation_version',
      'support_root',
      'launcher_root',
      'owned_files',
      'owned_instruction_blocks',
      'created_directories',
    ],
    'install manifest',
  );
  if (value.schema_version !== INSTALL_MANIFEST_VERSION) {
    fail('INVALID_MANIFEST', 'unsupported install manifest version');
  }
  if (value.host !== paths.host || value.scope !== paths.scope) {
    fail('INVALID_MANIFEST', 'install manifest host or scope does not match the target');
  }
  if (value.support_root !== paths.supportRoot || value.launcher_root !== paths.launcherRoot) {
    fail('INVALID_MANIFEST', 'install manifest roots do not match canonical target roots');
  }
  if (typeof value.package_version !== 'string' || value.package_version.length === 0) {
    fail('INVALID_MANIFEST', 'package_version is required');
  }
  digest(value.package_digest, 'package_digest');
  if (value.generator_version !== GENERATOR_VERSION || value.operation_version !== OPERATION_VERSION) {
    fail('INVALID_MANIFEST', 'generator or operation version is unsupported');
  }
  if (!Array.isArray(value.owned_files) || value.owned_files.length === 0) {
    fail('INVALID_MANIFEST', 'owned_files must be non-empty');
  }
  const identities = new Set();
  for (const [index, file] of value.owned_files.entries()) {
    exactKeys(
      file,
      ['root', 'path', 'mode', 'digest', 'operation', 'operation_digest'],
      `owned_files[${index}]`,
    );
    if (!['support', 'launcher'].includes(file.root)) {
      fail('INVALID_MANIFEST', `owned_files[${index}].root is invalid`);
    }
    safeRelativePath(file.path, `owned_files[${index}].path`);
    mode(file.mode, `owned_files[${index}].mode`);
    digest(file.digest, `owned_files[${index}].digest`);
    if (file.operation === null) {
      if (file.operation_digest !== null) {
        fail('INVALID_MANIFEST', `owned_files[${index}] has an orphan operation digest`);
      }
    } else {
      if (!OPERATIONS.some(({ name }) => name === file.operation)) {
        fail('INVALID_MANIFEST', `owned_files[${index}] names an unknown operation`);
      }
      digest(file.operation_digest, `owned_files[${index}].operation_digest`);
    }
    const identity = `${file.root}:${file.path}`;
    if (identities.has(identity)) fail('INVALID_MANIFEST', `duplicate owned file ${identity}`);
    identities.add(identity);
  }
  if (!Array.isArray(value.owned_instruction_blocks) || value.owned_instruction_blocks.length !== 0) {
    fail('INVALID_MANIFEST', 'Baton v1 installs no permanent instruction blocks');
  }
  if (!Array.isArray(value.created_directories)) {
    fail('INVALID_MANIFEST', 'created_directories must be an array');
  }
  const directories = new Set();
  for (const [index, directory] of value.created_directories.entries()) {
    exactKeys(directory, ['root', 'path'], `created_directories[${index}]`);
    if (!['support', 'launcher'].includes(directory.root)) {
      fail('INVALID_MANIFEST', `created_directories[${index}].root is invalid`);
    }
    if (directory.path !== '') {
      safeRelativePath(directory.path, `created_directories[${index}].path`);
    }
    const identity = `${directory.root}:${directory.path}`;
    if (directories.has(identity)) fail('INVALID_MANIFEST', `duplicate directory ${identity}`);
    directories.add(identity);
  }
  return value;
}

export async function readInstallManifest(paths) {
  const manifestPath = join(paths.supportRoot, INSTALL_MANIFEST_NAME);
  let bytes;
  try {
    bytes = await readFile(manifestPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail('INVALID_MANIFEST', 'install manifest is not valid JSON', error);
  }
  validateInstallManifest(value, paths);
  return { value, bytes, path: manifestPath };
}

export async function buildDesiredInstall({
  bundleRoot,
  paths,
  generatedManifest,
  createdDirectories,
}) {
  const packageVersion = (await readFile(join(bundleRoot, 'VERSION'), 'utf8')).trim();
  if (
    generatedManifest.package_version !== packageVersion
    || generatedManifest.generator_version !== GENERATOR_VERSION
    || generatedManifest.operation_version !== OPERATION_VERSION
  ) {
    fail('PACKAGE_MISMATCH', 'generated adapter manifest does not match the package');
  }
  const operations = operationMap(generatedManifest);
  const content = new Map();
  const ownedFiles = [];
  const supportDigestEntries = [];

  for (const path of SUPPORT_FILES) {
    const bytes = await readFile(join(bundleRoot, path));
    const operation = OPERATIONS.find(({ source }) => source === path);
    const operationDigest = operation ? operations.get(operation.name)?.digest : null;
    if (operation && operationDigest !== sha256(bytes)) {
      fail('PACKAGE_MISMATCH', `generated digest is stale for ${operation.name}`);
    }
    const entry = {
      root: 'support',
      path,
      mode: '0644',
      digest: sha256(bytes),
      operation: operation?.name ?? null,
      operation_digest: operationDigest,
    };
    content.set(`support:${path}`, bytes);
    ownedFiles.push(entry);
    supportDigestEntries.push(entry);
  }
  const observedPackageDigest = digestEntries(supportDigestEntries);
  if (
    observedPackageDigest !== generatedManifest.package_digest
    || generatedManifest.packages?.claude?.digest !== observedPackageDigest
    || generatedManifest.packages?.codex?.digest !== observedPackageDigest
  ) {
    fail('PACKAGE_MISMATCH', 'Claude and Codex support package digests do not match');
  }

  for (const operation of OPERATIONS) {
    const adapter = generatedManifest.adapters.find((candidate) => (
      candidate.host === paths.host && candidate.operation === operation.name
    ));
    if (!adapter) fail('PACKAGE_MISMATCH', `missing ${paths.host}/${operation.name} adapter`);
    const source = join(bundleRoot, 'adapters', 'generated', adapter.path);
    const bytes = await readFile(source);
    if (
      sha256(bytes) !== adapter.digest
      || adapter.canonical_digest !== operations.get(operation.name)?.digest
    ) {
      fail('PACKAGE_MISMATCH', `adapter digest mismatch for ${paths.host}/${operation.name}`);
    }
    const path = `${operation.name}/SKILL.md`;
    content.set(`launcher:${path}`, bytes);
    ownedFiles.push({
      root: 'launcher',
      path,
      mode: '0644',
      digest: adapter.digest,
      operation: operation.name,
      operation_digest: adapter.canonical_digest,
    });
  }

  ownedFiles.sort((left, right) => (
    Buffer.from(`${left.root}:${left.path}`).compare(Buffer.from(`${right.root}:${right.path}`))
  ));
  const manifest = {
    schema_version: INSTALL_MANIFEST_VERSION,
    host: paths.host,
    scope: paths.scope,
    package_version: packageVersion,
    package_digest: observedPackageDigest,
    generator_version: GENERATOR_VERSION,
    operation_version: OPERATION_VERSION,
    support_root: paths.supportRoot,
    launcher_root: paths.launcherRoot,
    owned_files: ownedFiles,
    owned_instruction_blocks: [],
    created_directories: createdDirectories,
  };
  validateInstallManifest(manifest, paths);
  return {
    manifest,
    manifestBytes: stableJSON(manifest),
    content,
  };
}

function rootFor(paths, root) {
  return root === 'support' ? paths.supportRoot : paths.launcherRoot;
}

export async function verifyOwnedFiles(manifest, paths) {
  validateInstallManifest(manifest, paths);
  for (const file of manifest.owned_files) {
    const absolute = join(rootFor(paths, file.root), file.path);
    const info = await maybeLstat(absolute);
    if (!info || !info.isFile() || info.isSymbolicLink()) {
      fail('MODIFIED_OWNED_FILE', `${file.root}:${file.path} is missing or not a regular file`);
    }
    const observedMode = `0${(info.mode & 0o777).toString(8).padStart(3, '0')}`;
    if (observedMode !== file.mode || sha256(await readFile(absolute)) !== file.digest) {
      fail('MODIFIED_OWNED_FILE', `${file.root}:${file.path} differs from its manifest`);
    }
  }
}

async function walkTree(root) {
  const info = await maybeLstat(root);
  if (!info) return { files: [], directories: [] };
  if (info.isSymbolicLink()) fail('SYMLINK_COMPONENT', `${root} is a symbolic link`);
  if (!info.isDirectory()) fail('UNOWNED_COLLISION', `${root} is not a directory`);
  const files = [];
  const directories = [];
  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(relativePath);
        await visit(absolute, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        fail('SYMLINK_COMPONENT', `${absolute} is not a regular file or directory`);
      }
    }
  }
  await visit(root, '');
  return { files: files.sort(), directories: directories.sort() };
}

function parentDirectories(paths) {
  const result = new Set();
  for (const path of paths) {
    let parent = dirname(path).replaceAll('\\', '/');
    while (parent !== '.' && parent !== '') {
      result.add(parent);
      parent = dirname(parent).replaceAll('\\', '/');
    }
  }
  return result;
}

export async function assertNoUnownedContent(manifest, paths) {
  validateInstallManifest(manifest, paths);
  const supportExpected = manifest.owned_files
    .filter(({ root }) => root === 'support')
    .map(({ path }) => path);
  const supportTree = await walkTree(paths.supportRoot);
  const expectedSupportFiles = new Set([...supportExpected, INSTALL_MANIFEST_NAME]);
  for (const file of supportTree.files) {
    if (!expectedSupportFiles.has(file)) {
      fail('UNOWNED_COLLISION', `unowned support file ${file}`);
    }
  }
  const expectedSupportDirectories = parentDirectories(supportExpected);
  for (const directory of supportTree.directories) {
    if (!expectedSupportDirectories.has(directory)) {
      fail('UNOWNED_COLLISION', `unowned support directory ${directory}`);
    }
  }

  for (const operation of OPERATIONS) {
    const skillRoot = join(paths.launcherRoot, operation.name);
    const tree = await walkTree(skillRoot);
    if (
      tree.directories.length > 0
      || tree.files.some((path) => path !== 'SKILL.md')
    ) {
      fail('UNOWNED_COLLISION', `unowned content in launcher ${operation.name}`);
    }
  }
}

export async function desiredCollisions(desired, priorManifest, paths, { allowSupportRoot = false } = {}) {
  const prior = new Set(
    priorManifest?.owned_files.map(({ root, path }) => `${root}:${path}`) ?? [],
  );
  for (const file of desired.manifest.owned_files) {
    if (prior.has(`${file.root}:${file.path}`)) continue;
    if (allowSupportRoot && file.root === 'support') continue;
    const absolute = join(rootFor(paths, file.root), file.path);
    if (await maybeLstat(absolute)) {
      fail('UNOWNED_COLLISION', `${file.root}:${file.path} already exists`);
    }
  }
  const supportInfo = await maybeLstat(paths.supportRoot);
  if (supportInfo && !priorManifest && !allowSupportRoot) {
    const tree = await walkTree(paths.supportRoot);
    if (tree.files.length > 0 || tree.directories.length > 0) {
      fail('UNOWNED_COLLISION', 'support root contains unowned content');
    }
  }
}

export async function enforceInstalledModes(manifest, paths) {
  for (const file of manifest.owned_files) {
    await chmod(
      join(rootFor(paths, file.root), file.path),
      Number.parseInt(file.mode, 8),
    );
  }
}

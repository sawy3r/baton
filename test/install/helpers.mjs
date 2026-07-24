import { execFileSync } from 'node:child_process';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  OPERATIONS,
  SUPPORT_FILES,
} from '../../scripts/lib/catalog.mjs';
import { sha256 } from '../../scripts/lib/digest.mjs';

export const ROOT = resolve(import.meta.dirname, '../..');

export async function temporaryFixture(t, prefix = 'baton-install-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const home = join(root, 'home');
  await mkdir(home, { mode: 0o755 });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, home };
}

export function initializeRepository(path) {
  execFileSync('git', ['init', '--quiet', path], { stdio: 'ignore' });
  return path;
}

export function environment(home, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    ...extra,
  };
}

export function targets(host, scope, home, repository = null) {
  const project = scope === 'project';
  const base = project ? repository : home;
  if (host === 'claude') {
    const config = join(base, '.claude');
    return {
      supportRoot: join(config, 'baton'),
      launcherRoot: join(config, 'skills'),
      stateRoot: join(config, '.baton-install'),
    };
  }
  return {
    supportRoot: join(base, '.codex', 'baton'),
    launcherRoot: join(base, '.agents', 'skills'),
    stateRoot: join(base, '.codex', '.baton-install'),
  };
}

async function maybeLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function snapshot(path) {
  const info = await maybeLstat(path);
  if (!info) return Buffer.from('absent\n');
  if (info.isSymbolicLink()) return Buffer.from(`symlink ${await readlink(path)}\n`);
  if (info.isFile()) {
    return Buffer.concat([
      Buffer.from(`file 0${(info.mode & 0o777).toString(8).padStart(3, '0')}\n`),
      await readFile(path),
    ]);
  }
  const records = [
    `directory . 0${(info.mode & 0o777).toString(8).padStart(3, '0')}\n`,
  ];
  async function walk(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absolute = join(directory, entry.name);
      const child = await lstat(absolute);
      const mode = `0${(child.mode & 0o777).toString(8).padStart(3, '0')}`;
      if (child.isDirectory()) {
        records.push(`directory ${relativePath} ${mode}\n`);
        await walk(absolute, relativePath);
      } else if (child.isFile()) {
        records.push(`file ${relativePath} ${mode} ${sha256(await readFile(absolute))}\n`);
      } else if (child.isSymbolicLink()) {
        records.push(`symlink ${relativePath} ${await readlink(absolute)}\n`);
      } else {
        records.push(`other ${relativePath} ${mode}\n`);
      }
    }
  }
  await walk(path, '');
  return Buffer.from(records.join(''));
}

async function writeMode(path, bytes, mode) {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  await writeFile(path, bytes, { mode });
  await chmod(path, mode);
}

export async function syntheticLegacyBundle(t) {
  const { root } = await temporaryFixture(t, 'baton-legacy-bundle-');
  const bundle = join(root, 'bundle');
  for (const path of SUPPORT_FILES) {
    await mkdir(dirname(join(bundle, path)), { recursive: true });
    await cp(join(ROOT, path), join(bundle, path));
  }
  await cp(
    join(ROOT, 'adapters', 'generated'),
    join(bundle, 'adapters', 'generated'),
    { recursive: true },
  );
  const checkedIn = JSON.parse(
    await readFile(join(ROOT, 'legacy', 'v0.16.0', 'install-manifest.json'), 'utf8'),
  );
  const packageBytes = new Map();
  const commandBytes = new Map();
  const packageFiles = {};
  const commands = {};
  for (const [path, [mode]] of Object.entries(checkedIn.package_files)) {
    const bytes = Buffer.from(`synthetic exact v0.16 package file: ${path}\n`);
    packageBytes.set(path, bytes);
    packageFiles[path] = [mode, sha256(bytes)];
  }
  for (const [path, [mode]] of Object.entries(checkedIn.commands)) {
    const bytes = Buffer.from(`synthetic exact v0.16 command: ${path}\n`);
    commandBytes.set(path, bytes);
    commands[path] = [mode, sha256(bytes)];
  }
  const block = Buffer.from('## Synthetic exact Baton v0.16 block\n\nFrozen for installer tests.\n');
  const manifest = {
    schema_version: 'baton.legacy-install/v0.16.0',
    commands,
    package_files: packageFiles,
    instruction_block: {
      path: 'CLAUDE.md',
      start_line: 5,
      digest: sha256(block),
    },
  };
  await mkdir(join(bundle, 'legacy', 'v0.16.0'), { recursive: true });
  await writeFile(
    join(bundle, 'legacy', 'v0.16.0', 'install-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(join(bundle, 'legacy', 'v0.16.0', 'claude-global-block.md'), block);
  return { bundle, manifest, packageBytes, commandBytes, block };
}

export async function installSyntheticLegacy(home, identity) {
  const config = join(home, '.claude');
  for (const [path, bytes] of identity.packageBytes) {
    await writeMode(
      join(config, 'baton', path),
      bytes,
      Number.parseInt(identity.manifest.package_files[path][0], 8),
    );
  }
  for (const [path, bytes] of identity.commandBytes) {
    await writeMode(
      join(config, path),
      bytes,
      Number.parseInt(identity.manifest.commands[path][0], 8),
    );
  }
  const prefix = Buffer.from(
    '# Personal instructions\n'
      + '\n'
      + 'Keep unrelated preferences.\n'
      + '\n',
  );
  await writeMode(join(config, 'CLAUDE.md'), Buffer.concat([prefix, identity.block]), 0o664);
  await writeMode(join(config, 'commands', 'pr.md'), Buffer.from('unrelated pr command\n'), 0o664);
  await writeMode(
    join(config, 'commands', 'review-tldr.md'),
    Buffer.from('unrelated review command\n'),
    0o664,
  );
  return { config, prefix };
}

export async function assertInstalled(target, host, scope) {
  const manifest = JSON.parse(
    await readFile(join(target.supportRoot, 'install-manifest.json'), 'utf8'),
  );
  if (manifest.schema_version !== 'baton.install/v1') {
    throw new Error('unexpected install manifest schema');
  }
  if (manifest.host !== host || manifest.scope !== scope) {
    throw new Error('install manifest target mismatch');
  }
  for (const { name } of OPERATIONS) {
    const bytes = await readFile(join(target.launcherRoot, name, 'SKILL.md'), 'utf8');
    if (!bytes.includes(`operation: ${name}`)) throw new Error(`bad ${name} launcher`);
  }
  return manifest;
}

export { symlink, writeMode };

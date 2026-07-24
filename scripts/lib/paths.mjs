import { execFileSync } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export class InstallError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'InstallError';
    this.code = code;
  }
}

export function fail(code, message, cause) {
  throw new InstallError(code, message, cause);
}

async function maybeLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function inside(boundary, candidate) {
  const suffix = relative(boundary, candidate);
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix));
}

async function nearestExisting(path) {
  let current = path;
  while (true) {
    const info = await maybeLstat(current);
    if (info) return { path: current, info };
    const parent = dirname(current);
    if (parent === current) return { path: current, info: null };
    current = parent;
  }
}

function assertOwned(path, info) {
  if (typeof process.getuid !== 'function') return;
  if (info.uid !== process.getuid()) {
    fail('UNSAFE_OWNERSHIP', `${path} is not owned by the current user`);
  }
}

export async function assertSafeRoot(path, { home, label }) {
  const root = resolve(path);
  if (root === '/' || root === home) {
    fail('UNSAFE_ROOT', `${label} cannot be / or the user home`);
  }
  const existing = await nearestExisting(root);
  if (!existing.info || existing.path === '/') {
    fail('UNSAFE_ROOT', `${label} has no user-owned existing ancestor`);
  }
  if (existing.info.isSymbolicLink()) {
    fail('SYMLINK_COMPONENT', `${existing.path} is a symbolic link`);
  }
  if (!existing.info.isDirectory()) {
    fail('UNSAFE_ROOT', `${existing.path} is not a directory`);
  }
  assertOwned(existing.path, existing.info);

  const missingSuffix = relative(existing.path, root);
  let current = existing.path;
  if (missingSuffix !== '') {
    for (const component of missingSuffix.split('/')) {
      current = join(current, component);
      const info = await maybeLstat(current);
      if (!info) break;
      if (info.isSymbolicLink()) fail('SYMLINK_COMPONENT', `${current} is a symbolic link`);
      if (!info.isDirectory()) fail('UNSAFE_ROOT', `${current} is not a directory`);
      assertOwned(current, info);
    }
  }
  return root;
}

export async function assertSafeTarget(path, boundary, label) {
  const target = resolve(path);
  if (!inside(boundary, target) || target === boundary) {
    fail('PATH_ESCAPE', `${label} escapes or equals its protected root`);
  }
  const suffix = relative(boundary, target);
  let current = boundary;
  for (const component of suffix.split('/')) {
    current = join(current, component);
    const info = await maybeLstat(current);
    if (!info) break;
    if (info.isSymbolicLink()) fail('SYMLINK_COMPONENT', `${current} is a symbolic link`);
    assertOwned(current, info);
  }
  return target;
}

async function userHome(env) {
  if (!env.HOME) fail('UNSAFE_ROOT', 'HOME is required for a user install');
  if (!isAbsolute(env.HOME)) fail('UNSAFE_ROOT', 'HOME must be an absolute path');
  let resolved;
  try {
    resolved = await realpath(resolve(env.HOME));
  } catch (error) {
    fail('UNSAFE_ROOT', 'HOME must resolve to an existing directory', error);
  }
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('UNSAFE_ROOT', 'HOME must be a real directory');
  }
  assertOwned(resolved, info);
  return resolved;
}

function gitRoot(path, env) {
  const gitEnvironment = { ...env };
  for (const name of Object.keys(gitEnvironment)) {
    if (name.startsWith('GIT_')) delete gitEnvironment[name];
  }
  try {
    return execFileSync(
      'git',
      ['-C', path, 'rev-parse', '--show-toplevel'],
      {
        encoding: 'utf8',
        env: gitEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
  } catch (error) {
    fail('PROJECT_NOT_GIT', `${path} is not inside a Git repository`, error);
  }
}

export async function resolveInstallPaths({
  host,
  scope,
  projectPath,
  env = process.env,
  cwd = process.cwd(),
}) {
  if (!['claude', 'codex'].includes(host)) fail('INVALID_ARGUMENT', `unknown host ${host}`);
  if (!['user', 'project'].includes(scope)) fail('INVALID_ARGUMENT', `unknown scope ${scope}`);
  const home = await userHome(env);

  if (scope === 'project') {
    const requested = resolve(cwd, projectPath ?? '.');
    let repository;
    try {
      repository = await realpath(gitRoot(requested, env));
    } catch (error) {
      if (error instanceof InstallError) throw error;
      fail('PROJECT_NOT_GIT', `${requested} does not resolve to a Git repository`, error);
    }
    const rootInfo = await lstat(repository);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      fail('UNSAFE_ROOT', 'project Git root must be a real directory');
    }
    assertOwned(repository, rootInfo);
    if (repository === '/' || repository === home) {
      fail('UNSAFE_ROOT', 'project Git root cannot be / or the user home');
    }
    const supportBase = join(repository, host === 'claude' ? '.claude' : '.codex');
    const launcherBase = join(repository, host === 'claude' ? '.claude' : '.agents');
    await assertSafeTarget(supportBase, repository, 'project support base');
    await assertSafeTarget(launcherBase, repository, 'project launcher base');
    const supportRoot = await assertSafeTarget(
      join(supportBase, 'baton'),
      repository,
      'project support root',
    );
    const launcherRoot = await assertSafeTarget(
      join(launcherBase, 'skills'),
      repository,
      'project launcher root',
    );
    return {
      host,
      scope,
      home,
      repository,
      supportBase,
      launcherBase,
      supportRoot,
      launcherRoot,
      stateRoot: await assertSafeTarget(
        join(supportBase, '.baton-install'),
        repository,
        'project transaction root',
      ),
      instructionPath: null,
    };
  }

  if (projectPath !== undefined) {
    fail('INVALID_ARGUMENT', 'a project path is valid only with --project');
  }
  for (const [name, value] of [
    ['CLAUDE_CONFIG_DIR', env.CLAUDE_CONFIG_DIR],
    ['CODEX_HOME', env.CODEX_HOME],
    ['AGENTS_HOME', env.AGENTS_HOME],
  ]) {
    if (value !== undefined && !isAbsolute(value)) {
      fail('UNSAFE_ROOT', `${name} must be an absolute path`);
    }
  }
  const supportBase = await assertSafeRoot(
    host === 'claude'
      ? resolve(env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'))
      : resolve(env.CODEX_HOME ?? join(home, '.codex')),
    { home, label: `${host} support base` },
  );
  const launcherBase = host === 'claude'
    ? supportBase
    : await assertSafeRoot(
      resolve(env.AGENTS_HOME ?? join(home, '.agents')),
      { home, label: 'codex launcher base' },
    );
  const supportRoot = await assertSafeTarget(
    join(supportBase, 'baton'),
    supportBase,
    'user support root',
  );
  const launcherRoot = await assertSafeTarget(
    join(launcherBase, 'skills'),
    launcherBase,
    'user launcher root',
  );
  return {
    host,
    scope,
    home,
    repository: null,
    supportBase,
    launcherBase,
    supportRoot,
    launcherRoot,
    stateRoot: await assertSafeTarget(
      join(supportBase, '.baton-install'),
      supportBase,
      'user transaction root',
    ),
    instructionPath: host === 'claude' ? join(supportBase, 'CLAUDE.md') : null,
  };
}

export function safeRelativePath(value, label = 'relative path') {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\0')
    || isAbsolute(value)
  ) {
    fail('INVALID_MANIFEST', `${label} must be a non-empty relative path`);
  }
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    fail('INVALID_MANIFEST', `${label} contains an unsafe component`);
  }
  return normalized;
}

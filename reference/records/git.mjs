import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export class GitRecordError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GitRecordError';
    this.code = code;
  }
}

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
const RECORD_ROOT_V1 = '.baton/releases';
const MAX_HEAD_REFS = 128;
const MAX_BATCH_PATHS = 1025;
const MAX_BATCH_FILE_BYTES = 262_144;
const MAX_BATCH_TOTAL_BYTES = MAX_BATCH_PATHS * MAX_BATCH_FILE_BYTES;
const MAX_RECORD_CHANGES = 1024;
const MAX_RECORD_VALUE_BYTES = 262_144;
const MAX_RECORD_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_RECORD_MESSAGE_BYTES = 1000;
const recordRootAdmissions = new WeakMap();
let configuredGitExecutable;

function defaultGitCandidates() {
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files\\Git\\bin\\git.exe',
      'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/usr/bin/git',
      '/opt/homebrew/bin/git',
      '/usr/local/bin/git',
    ];
  }
  return ['/usr/bin/git', '/bin/git', '/usr/local/bin/git'];
}

function validateGitExecutable(executable) {
  if (typeof executable !== 'string' || !path.isAbsolute(executable)) {
    throw new GitRecordError(
      'INVALID_GIT_EXECUTABLE',
      'the trusted Git executable must be an absolute path',
    );
  }
  try {
    accessSync(executable, constants.X_OK);
    const stat = statSync(executable);
    if (!stat.isFile()) {
      throw new Error('not a regular file');
    }
    return realpathSync(executable);
  } catch (error) {
    throw new GitRecordError(
      'INVALID_GIT_EXECUTABLE',
      `the trusted Git executable is unavailable: ${executable}`,
      error,
    );
  }
}

/**
 * Pin Git explicitly for platforms or installations outside the trusted
 * built-in locations. The caller establishes trust; PATH is never searched.
 */
export function configureGitExecutable(executable) {
  configuredGitExecutable = validateGitExecutable(executable);
  return configuredGitExecutable;
}

export function gitExecutablePath() {
  if (configuredGitExecutable) return configuredGitExecutable;
  for (const candidate of defaultGitCandidates()) {
    if (!existsSync(candidate)) continue;
    configuredGitExecutable = validateGitExecutable(candidate);
    return configuredGitExecutable;
  }
  throw new GitRecordError(
    'GIT_EXECUTABLE_NOT_FOUND',
    'no trusted Git executable was found; call configureGitExecutable with an absolute path',
  );
}

function gitEnvironment(extra = {}, internal = {}) {
  const allowedOverrides = new Set([
    'GIT_INDEX_FILE',
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'GIT_AUTHOR_DATE',
    'GIT_COMMITTER_NAME',
    'GIT_COMMITTER_EMAIL',
    'GIT_COMMITTER_DATE',
  ]);
  const environment = {
    LANG: 'C',
    LC_ALL: 'C',
    PATH: path.dirname(gitExecutablePath()),
    HOME: tmpdir(),
    XDG_CONFIG_HOME: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: NULL_DEVICE,
    GIT_CONFIG_GLOBAL: NULL_DEVICE,
    GIT_ATTR_NOSYSTEM: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    GIT_PROTOCOL_FROM_USER: '0',
  };
  if (process.platform === 'win32') {
    for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) {
      if (process.env[key]) environment[key] = process.env[key];
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    if (allowedOverrides.has(key)) environment[key] = value;
  }
  for (const [key, value] of Object.entries(internal)) {
    if (
      key === 'GIT_DIR'
      || key === 'GIT_OBJECT_DIRECTORY'
      || key === 'GIT_INDEX_FILE'
    ) {
      environment[key] = value;
    }
  }
  return environment;
}

function executeGit(repo, args, options = {}, internal = {}) {
  const hooksDirectory = mkdtempSync(path.join(tmpdir(), 'baton-git-hooks-'));
  try {
    return execFileSync(gitExecutablePath(), [
      '-c',
      `core.hooksPath=${hooksDirectory}`,
      '-c',
      'core.fsmonitor=false',
      ...args,
    ], {
      cwd: repo,
      encoding: Object.hasOwn(options, 'encoding') ? options.encoding : 'utf8',
      input: options.input,
      env: gitEnvironment(options.env, internal),
      maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim();
    throw new GitRecordError(
      options.code ?? 'GIT_COMMAND_FAILED',
      `${options.label ?? `git ${args[0]}`} failed${stderr ? `: ${stderr}` : ''}`,
      error,
    );
  } finally {
    rmSync(hooksDirectory, { recursive: true, force: true });
  }
}

export function runGit(repo, args, options = {}) {
  return executeGit(repo, args, options);
}

export function repositoryRoot(repo = process.cwd()) {
  return runGit(repo, ['rev-parse', '--show-toplevel'], {
    label: 'resolve repository root',
  }).trim();
}

export function resolveRef(repo, ref) {
  return runGit(repo, ['rev-parse', '--verify', `${ref}^{commit}`], {
    code: 'REF_NOT_FOUND',
    label: `resolve ${ref}`,
  }).trim();
}

export function refExists(repo, ref) {
  try {
    resolveRef(repo, ref);
    return true;
  } catch (error) {
    if (error instanceof GitRecordError && error.code === 'REF_NOT_FOUND') {
      return false;
    }
    throw error;
  }
}

function assertExactHeadRef(ref) {
  const components = typeof ref === 'string' ? ref.split('/') : [];
  if (
    typeof ref !== 'string'
    || !ref.startsWith('refs/heads/')
    || ref.length > 1024
    || /[\u0000-\u0020\u007f~^:?*\\]/.test(ref)
    || ref.includes('[')
    || ref.includes('..')
    || ref.includes('@{')
    || ref.includes('//')
    || ref.endsWith('/')
    || ref.endsWith('.')
    || components.some((component) => (
      component.length === 0
      || component.startsWith('.')
      || component.endsWith('.lock')
    ))
  ) {
    throw new GitRecordError(
      'INVALID_HEAD_REF',
      `invalid exact branch ref ${String(ref)}`,
    );
  }
  return ref;
}

/**
 * Capture up to 128 exact branch heads with one Git process. Missing refs are
 * represented by null; the input order is preserved.
 */
export function captureHeadRefs(repo, refs) {
  if (!Array.isArray(refs) || refs.length > MAX_HEAD_REFS) {
    throw new GitRecordError(
      'INVALID_REF_BATCH',
      `head capture requires an array of at most ${MAX_HEAD_REFS} refs`,
    );
  }
  if (refs.length === 0) return Object.freeze([]);
  const exactRefs = refs.map(assertExactHeadRef);
  if (new Set(exactRefs).size !== exactRefs.length) {
    throw new GitRecordError('DUPLICATE_REF', 'head capture refs must be unique');
  }
  const raw = runGit(
    repo,
    [
      'for-each-ref',
      '--format=%(refname)%09%(objectname)%09%(objecttype)',
      ...exactRefs,
    ],
    { encoding: null, label: 'capture exact branch heads' },
  );
  let rendered;
  try {
    rendered = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch (error) {
    throw new GitRecordError(
      'MALFORMED_GIT_OUTPUT',
      'branch head capture was not valid UTF-8',
      error,
    );
  }
  const requested = new Set(exactRefs);
  const captured = new Map();
  for (const line of rendered.split('\n').filter(Boolean)) {
    const fields = line.split('\t');
    if (fields.length !== 3) {
      throw new GitRecordError('MALFORMED_GIT_OUTPUT', 'branch head capture was malformed');
    }
    const [ref, head, type] = fields;
    if (!requested.has(ref)) continue;
    if (type !== 'commit' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) {
      throw new GitRecordError(
        'INVALID_HEAD_OBJECT',
        `branch ${ref} does not point directly to a commit`,
      );
    }
    captured.set(ref, head);
  }
  return Object.freeze(exactRefs.map((ref) => Object.freeze({
    ref,
    head: captured.get(ref) ?? null,
  })));
}

export function isAncestor(repo, ancestor, descendant) {
  try {
    runGit(repo, ['merge-base', '--is-ancestor', ancestor, descendant], {
      code: 'NOT_ANCESTOR',
      label: `check ancestry ${ancestor} -> ${descendant}`,
    });
    return true;
  } catch (error) {
    if (error instanceof GitRecordError && error.code === 'NOT_ANCESTOR') {
      return false;
    }
    throw error;
  }
}

export function readFileAtRef(repo, ref, relativePath) {
  assertRepositoryPath(relativePath);
  try {
    return runGit(repo, ['show', `${ref}:${relativePath}`], {
      encoding: null,
      code: 'RECORD_NOT_FOUND',
      label: `read ${relativePath} at ${ref}`,
    });
  } catch (error) {
    if (error instanceof GitRecordError) throw error;
    throw new GitRecordError('RECORD_NOT_FOUND', `cannot read ${relativePath} at ${ref}`, error);
  }
}

/**
 * Read up to 1025 files from one captured commit OID with one cat-file process.
 * Each frozen entry contains exact bytes, or null fields when the path is
 * absent. Individual files and aggregate output are bounded.
 */
export function readFilesAtRef(repo, refOID, paths) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(refOID)) {
    throw new GitRecordError(
      'INVALID_REF_OID',
      'batched file reads require a full captured commit OID',
    );
  }
  if (!Array.isArray(paths) || paths.length > MAX_BATCH_PATHS) {
    throw new GitRecordError(
      'INVALID_PATH_BATCH',
      `batched file reads require an array of at most ${MAX_BATCH_PATHS} paths`,
    );
  }
  if (paths.length === 0) return Object.freeze([]);
  const exactPaths = paths.map(assertRepositoryPath);
  const expressions = exactPaths.map((relativePath) => `${refOID}:${relativePath}`);
  const input = `${expressions.join('\n')}\n`;
  if (Buffer.byteLength(input) > 4 * 1024 * 1024) {
    throw new GitRecordError('PATH_BATCH_TOO_LARGE', 'batched file read input exceeds 4 MiB');
  }
  const raw = runGit(repo, ['cat-file', '--batch'], {
    encoding: null,
    input,
    maxBuffer: MAX_BATCH_TOTAL_BYTES + (8 * 1024 * 1024),
    code: 'BATCH_READ_FAILED',
    label: `read ${exactPaths.length} files at ${refOID}`,
  });
  const entries = [];
  let offset = 0;
  let totalBytes = 0;
  for (let index = 0; index < exactPaths.length; index += 1) {
    const newline = raw.indexOf(0x0a, offset);
    if (newline < 0) {
      throw new GitRecordError('MALFORMED_GIT_OUTPUT', 'cat-file batch header is incomplete');
    }
    const header = raw.subarray(offset, newline).toString('utf8');
    offset = newline + 1;
    if (header === `${expressions[index]} missing`) {
      entries.push(Object.freeze({
        path: exactPaths[index],
        object: null,
        size: null,
        bytes: null,
      }));
      continue;
    }
    const match = header.match(/^([0-9a-f]{40}|[0-9a-f]{64}) ([a-z]+) ([0-9]+)$/);
    if (!match || match[2] !== 'blob') {
      throw new GitRecordError(
        'MALFORMED_GIT_OUTPUT',
        `cat-file returned an invalid blob header for ${exactPaths[index]}`,
      );
    }
    const size = Number.parseInt(match[3], 10);
    if (
      !Number.isSafeInteger(size)
      || size < 0
      || size > MAX_BATCH_FILE_BYTES
      || totalBytes + size > MAX_BATCH_TOTAL_BYTES
    ) {
      throw new GitRecordError(
        'BATCH_READ_LIMIT_EXCEEDED',
        `batched file content exceeds its bounded size at ${exactPaths[index]}`,
      );
    }
    const end = offset + size;
    if (end >= raw.length || raw[end] !== 0x0a) {
      throw new GitRecordError(
        'MALFORMED_GIT_OUTPUT',
        `cat-file returned incomplete content for ${exactPaths[index]}`,
      );
    }
    const bytes = Buffer.from(raw.subarray(offset, end));
    offset = end + 1;
    totalBytes += size;
    entries.push(Object.freeze({
      path: exactPaths[index],
      object: match[1],
      size,
      bytes,
    }));
  }
  if (offset !== raw.length) {
    throw new GitRecordError('MALFORMED_GIT_OUTPUT', 'cat-file returned unexpected trailing data');
  }
  return Object.freeze(entries);
}

function assertRepositoryPath(relativePath) {
  const segments = typeof relativePath === 'string' ? relativePath.split('/') : [];
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || path.isAbsolute(relativePath)
    || relativePath.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(relativePath)
    || segments[0] === '.git'
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new GitRecordError('INVALID_REPOSITORY_PATH', `invalid repository path ${String(relativePath)}`);
  }
  return relativePath;
}

function assertRelativeRoot(root) {
  if (
    typeof root !== 'string'
    || root.length === 0
    || path.isAbsolute(root)
    || root.includes('\\')
  ) {
    throw new GitRecordError('INVALID_RECORD_ROOT', 'record root must be a non-empty repository-relative path');
  }
  const segments = root.split('/');
  if (
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    || segments[0] === '.git'
  ) {
    throw new GitRecordError('INVALID_RECORD_ROOT', `record root is not canonical: ${root}`);
  }
  return segments;
}

export function assertCanonicalRecordRoot(repo, root) {
  const repository = repositoryRoot(repo);
  const segments = assertRelativeRoot(root);
  let cursor = repository;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    try {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink()) {
        throw new GitRecordError('SYMLINKED_RECORD_ROOT', `record root traverses symlink ${cursor}`);
      }
    } catch (error) {
      if (error instanceof GitRecordError) throw error;
      if (error?.code === 'ENOENT') break;
      throw new GitRecordError('INVALID_RECORD_ROOT', `cannot inspect record root ${cursor}`, error);
    }
  }
  return segments.join('/');
}

/**
 * Admit the sole v1 record root for product-tree exclusion. The returned
 * object is an opaque capability bound to the resolved repository; callers
 * cannot forge one with a boolean or object literal.
 */
export function resolveRecordRootAdmission(repo, root = RECORD_ROOT_V1) {
  if (root !== RECORD_ROOT_V1) {
    throw new GitRecordError(
      'RECORD_ROOT_NOT_ADMITTED',
      `Baton v1 admits only ${RECORD_ROOT_V1} as its record root`,
    );
  }
  const repository = realpathSync(repositoryRoot(repo));
  assertCanonicalRecordRoot(repository, root);
  const admission = Object.freeze(Object.create(null));
  recordRootAdmissions.set(admission, { repository, root });
  return admission;
}

function requireRecordRootAdmission(repo, admission) {
  const admitted = (
    admission !== null
    && typeof admission === 'object'
    && recordRootAdmissions.get(admission)
  );
  if (!admitted) {
    throw new GitRecordError(
      'RECORD_ROOT_ADMISSION_REQUIRED',
      'product-tree exclusion requires a record-root admission capability',
    );
  }
  const repository = realpathSync(repositoryRoot(repo));
  if (repository !== admitted.repository) {
    throw new GitRecordError(
      'RECORD_ROOT_ADMISSION_MISMATCH',
      'the record-root admission belongs to a different repository',
    );
  }
  return admitted.root;
}

function parseTreeEntry(buffer) {
  const tab = buffer.indexOf(0x09);
  if (tab < 0) {
    throw new GitRecordError('MALFORMED_GIT_TREE', 'git ls-tree entry has no path separator');
  }
  const metadata = buffer.subarray(0, tab).toString('ascii').split(' ');
  if (metadata.length !== 3) {
    throw new GitRecordError('MALFORMED_GIT_TREE', 'git ls-tree entry has malformed metadata');
  }
  const filePath = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(tab + 1));
  return {
    mode: metadata[0],
    type: metadata[1],
    object: metadata[2],
    path: filePath,
  };
}

export function assertRecordRootAtRef(repo, ref, recordRoot, options = {}) {
  const root = assertRelativeRoot(recordRoot).join('/');
  const commit = resolveRef(repo, ref);
  const segments = root.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    const prefix = segments.slice(0, index + 1).join('/');
    const raw = runGit(repo, ['ls-tree', '-z', commit, '--', prefix], {
      encoding: null,
      label: `inspect record root ${prefix} at ${commit}`,
    });
    if (raw.length === 0) {
      if (options.allowMissing === true) return root;
      throw new GitRecordError(
        'RECORD_ROOT_NOT_FOUND',
        `record root ${root} does not exist at ${commit}`,
      );
    }
    const nul = raw.indexOf(0);
    if (nul < 0 || nul !== raw.length - 1) {
      throw new GitRecordError('MALFORMED_GIT_TREE', `ambiguous tree entry for ${prefix}`);
    }
    const entry = parseTreeEntry(raw.subarray(0, nul));
    if (entry.path !== prefix) {
      throw new GitRecordError('MALFORMED_GIT_TREE', `unexpected tree entry ${entry.path} for ${prefix}`);
    }
    if (entry.mode === '120000') {
      throw new GitRecordError(
        'SYMLINKED_RECORD_ROOT',
        `record root ${root} traverses a symlink at ${prefix} in ${commit}`,
      );
    }
    if (entry.type !== 'tree') {
      throw new GitRecordError(
        'INVALID_RECORD_ROOT',
        `record root component ${prefix} is not a directory in ${commit}`,
      );
    }
  }
  return root;
}

export function productTreeIdentity(repo, commit, admission) {
  const root = requireRecordRootAdmission(repo, admission);
  const candidate = resolveRef(repo, commit);
  assertRecordRootAtRef(repo, candidate, root, { allowMissing: true });
  const candidateTree = runGit(repo, ['rev-parse', `${candidate}^{tree}`], {
    label: `resolve candidate tree ${candidate}`,
  }).trim();
  const raw = runGit(repo, ['ls-tree', '-r', '-z', candidate], {
    encoding: null,
    label: `read candidate tree ${candidate}`,
  });
  const entries = [];
  let offset = 0;
  while (offset < raw.length) {
    const nul = raw.indexOf(0, offset);
    if (nul < 0) {
      throw new GitRecordError('MALFORMED_GIT_TREE', 'git ls-tree output is not NUL terminated');
    }
    if (nul > offset) entries.push(parseTreeEntry(raw.subarray(offset, nul)));
    offset = nul + 1;
  }
  const productEntries = entries
    .filter((entry) => entry.path !== root && !entry.path.startsWith(`${root}/`))
    .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const hash = createHash('sha256');
  for (const entry of productEntries) {
    hash.update(entry.path);
    hash.update('\0');
    hash.update(entry.mode);
    hash.update('\0');
    hash.update(entry.type);
    hash.update('\0');
    hash.update(entry.object);
    hash.update('\n');
  }
  return {
    candidate,
    candidateTree,
    productTree: `sha256:${hash.digest('hex')}`,
    entries: productEntries,
  };
}

export function assertCandidate(repo, base, candidate) {
  const exactBase = resolveRef(repo, base);
  const exactCandidate = resolveRef(repo, candidate);
  if (!isAncestor(repo, exactBase, exactCandidate)) {
    throw new GitRecordError(
      'INVALID_CANDIDATE_ANCESTRY',
      `candidate ${exactCandidate} does not descend from base ${exactBase}`,
    );
  }
  return { base: exactBase, candidate: exactCandidate };
}

export function commitParents(repo, commit) {
  const line = runGit(repo, ['rev-list', '--parents', '-n', '1', commit], {
    label: `read parents of ${commit}`,
  }).trim();
  return line.split(/\s+/).slice(1);
}

function splitNul(raw) {
  const values = [];
  let offset = 0;
  while (offset < raw.length) {
    const nul = raw.indexOf(0, offset);
    if (nul < 0) {
      throw new GitRecordError('MALFORMED_GIT_OUTPUT', 'Git output is not NUL terminated');
    }
    values.push(raw.subarray(offset, nul));
    offset = nul + 1;
  }
  return values;
}

export function changedPathsBetween(repo, base, candidate) {
  const exactBase = resolveRef(repo, base);
  const exactCandidate = resolveRef(repo, candidate);
  const raw = runGit(
    repo,
    [
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-z',
      '--no-renames',
      '--no-ext-diff',
      '--no-textconv',
      '--ignore-submodules=none',
      exactBase,
      exactCandidate,
    ],
    { encoding: null, label: `read changed paths ${exactBase}..${exactCandidate}` },
  );
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let paths;
  try {
    paths = splitNul(raw)
      .filter((value) => value.length > 0)
      .map((value) => assertRepositoryPath(decoder.decode(value)));
  } catch (error) {
    if (error instanceof GitRecordError) throw error;
    throw new GitRecordError(
      'INVALID_REPOSITORY_PATH',
      'changed paths are not canonical UTF-8 repository paths',
      error,
    );
  }
  return [...new Set(paths)].sort((left, right) => (
    Buffer.from(left).compare(Buffer.from(right))
  ));
}

function repositoryObjectDirectory(repo) {
  const common = runGit(
    repo,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { label: 'resolve Git common directory' },
  ).trim();
  const objectDirectory = path.join(common, 'objects');
  try {
    if (!statSync(objectDirectory).isDirectory()) throw new Error('not a directory');
    return realpathSync(objectDirectory);
  } catch (error) {
    throw new GitRecordError(
      'INVALID_GIT_OBJECT_DIRECTORY',
      `cannot use Git object directory ${objectDirectory}`,
      error,
    );
  }
}

function withEngineGitContext(repo, operation) {
  const temporary = mkdtempSync(path.join(tmpdir(), 'baton-git-context-'));
  const gitDirectory = path.join(temporary, 'repository.git');
  try {
    const objectFormat = runGit(
      repo,
      ['rev-parse', '--show-object-format=storage'],
      { label: 'resolve repository object format' },
    ).trim();
    runGit(
      temporary,
      ['init', '--quiet', '--bare', `--object-format=${objectFormat}`, gitDirectory],
      { label: 'create engine-owned Git context' },
    );
    const context = {
      cwd: repo,
      attributesFile: path.join(temporary, 'attributes'),
      environment: {
        GIT_DIR: gitDirectory,
        GIT_OBJECT_DIRECTORY: repositoryObjectDirectory(repo),
        GIT_INDEX_FILE: path.join(temporary, 'index'),
      },
    };
    return operation(context);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function runEngineGit(context, args, options = {}) {
  return executeGit(context.cwd, args, options, context.environment);
}

function treePaths(context, commit) {
  const raw = runEngineGit(
    context,
    ['ls-tree', '-r', '--name-only', '-z', commit],
    { encoding: null, label: `enumerate paths at ${commit}` },
  );
  return splitNul(raw).filter((value) => value.length > 0);
}

function mergeAttributesAtSource(context, source, paths) {
  if (paths.length === 0) return [];
  const input = Buffer.concat(paths.flatMap((entry) => [entry, Buffer.from([0])]));
  const raw = runEngineGit(
    context,
    ['check-attr', '-z', '--stdin', `--source=${source}`, 'merge'],
    {
      encoding: null,
      input,
      code: 'UNTRUSTED_MERGE_ATTRIBUTES',
      label: `inspect merge attributes at ${source}`,
    },
  );
  const fields = splitNul(raw);
  if (fields.length % 3 !== 0) {
    throw new GitRecordError(
      'MALFORMED_GIT_OUTPUT',
      `Git returned malformed merge attributes for ${source}`,
    );
  }
  const attributes = [];
  for (let index = 0; index < fields.length; index += 3) {
    attributes.push({
      path: fields[index],
      value: fields[index + 2].toString('utf8'),
    });
  }
  return attributes;
}

function installBuiltInMergeAttributes(context, expected, candidate) {
  const unique = new Map();
  for (const entry of [...treePaths(context, expected), ...treePaths(context, candidate)]) {
    unique.set(entry.toString('hex'), entry);
  }
  const paths = [...unique.values()];
  const builtIn = new Set(['unspecified', 'set', 'unset', 'text', 'binary', 'union']);
  let expectedAttributes = [];
  for (const source of [expected, candidate]) {
    const attributes = mergeAttributesAtSource(context, source, paths);
    if (source === expected) expectedAttributes = attributes;
    for (const { path: filePathBytes, value } of attributes) {
      if (!builtIn.has(value)) {
        const filePath = filePathBytes.toString('utf8');
        throw new GitRecordError(
          'UNTRUSTED_MERGE_DRIVER',
          `custom merge driver ${value} applies to ${filePath} at ${source}`,
        );
      }
    }
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let rendered;
  try {
    rendered = expectedAttributes
      .filter(({ value }) => value !== 'unspecified')
      .map(({ path: filePathBytes, value }) => {
        const filePath = assertRepositoryPath(decoder.decode(filePathBytes));
        const attribute = (
          value === 'set'
            ? 'merge'
            : value === 'unset'
              ? '-merge'
              : `merge=${value}`
        );
        return `${JSON.stringify(filePath)} ${attribute}`;
      })
      .join('\n');
  } catch (error) {
    if (error instanceof GitRecordError) throw error;
    throw new GitRecordError(
      'INVALID_REPOSITORY_PATH',
      'merge attributes apply to a non-canonical repository path',
      error,
    );
  }
  writeFileSync(context.attributesFile, `${rendered}${rendered ? '\n' : ''}`);
  runEngineGit(
    context,
    ['config', '--local', 'core.attributesFile', context.attributesFile],
    { label: 'install engine-owned merge attributes' },
  );
}

function deterministicMergeTreeInContext(context, expected, candidate, label) {
  runEngineGit(
    context,
    ['read-tree', expected],
    { label: `seed engine-owned merge index at ${expected}` },
  );
  installBuiltInMergeAttributes(context, expected, candidate);
  return runEngineGit(
    context,
    ['merge-tree', '--write-tree', '--no-messages', expected, candidate],
    {
      code: 'COMPOSITION_CONFLICT',
      label: `compute deterministic ${label} tree`,
    },
  ).trim();
}

function deterministicMergeTree(repo, expected, candidate, label) {
  return withEngineGitContext(
    repo,
    (context) => deterministicMergeTreeInContext(context, expected, candidate, label),
  );
}

function verifyExactComposition(repo, expectedTarget, candidate, observedResult, label) {
  const expected = resolveRef(repo, expectedTarget);
  const passed = resolveRef(repo, candidate);
  const observed = resolveRef(repo, observedResult);
  if (observed === passed && isAncestor(repo, expected, passed)) {
    return { mode: 'fast-forward', expected, candidate: passed, observed };
  }
  const parents = commitParents(repo, observed);
  if (
    parents.length === 2
    && parents[0] === expected
    && parents[1] === passed
    && isAncestor(repo, expected, observed)
    && isAncestor(repo, passed, observed)
  ) {
    const deterministicTree = deterministicMergeTree(repo, expected, passed, label);
    const observedTree = runGit(repo, ['rev-parse', `${observed}^{tree}`], {
      label: `resolve ${label} result tree`,
    }).trim();
    if (observedTree !== deterministicTree) {
      throw new GitRecordError(
        'FORGED_COMPOSITION_TREE',
        `${label} result ${observed} has the expected parents but not the deterministic merge tree`,
      );
    }
    return { mode: 'two-parent', expected, candidate: passed, observed };
  }
  throw new GitRecordError(
    'UNEXPECTED_COMPOSITION_TOPOLOGY',
    `${label} result ${observed} is neither the exact fast-forward nor a two-parent composition of ${expected} and ${passed}`,
  );
}

export function verifyTrackComposition(repo, expectedReleaseHead, frozenTrackHead, observedResult) {
  return verifyExactComposition(
    repo,
    expectedReleaseHead,
    frozenTrackHead,
    observedResult,
    'track composition',
  );
}

export function verifyReleaseIntegration(repo, expectedTarget, assemblyCandidate, observedResult) {
  return verifyExactComposition(
    repo,
    expectedTarget,
    assemblyCandidate,
    observedResult,
    'release integration',
  );
}

function commitTimestamp(repo, commit) {
  const rendered = runGit(repo, ['show', '-s', '--format=%ct', commit], {
    label: `read timestamp for ${commit}`,
  }).trim();
  const parsed = Number.parseInt(rendered, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new GitRecordError('INVALID_COMMIT_TIMESTAMP', `invalid Git timestamp ${rendered}`);
  }
  return parsed;
}

function deterministicCompositionCommit(context, repo, targetRef, expected, candidate, tree) {
  const timestamp = Math.max(
    commitTimestamp(repo, expected),
    commitTimestamp(repo, candidate),
  ) + 1;
  const date = `@${timestamp} +0000`;
  return runEngineGit(
    context,
    ['commit-tree', tree, '-p', expected, '-p', candidate],
    {
      input: `Baton exact composition of ${candidate} into ${targetRef}\n`,
      env: {
        GIT_AUTHOR_NAME: 'Baton Merge',
        GIT_AUTHOR_EMAIL: 'merge@baton.invalid',
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: 'Baton Merge',
        GIT_COMMITTER_EMAIL: 'merge@baton.invalid',
        GIT_COMMITTER_DATE: date,
      },
      label: 'create deterministic composition commit',
    },
  ).trim();
}

export function applyExactComposition(repo, {
  targetRef,
  expectedHead,
  candidate,
}) {
  runGit(repo, ['check-ref-format', targetRef], {
    code: 'INVALID_TARGET_REF',
    label: `validate target ref ${targetRef}`,
  });
  if (!targetRef.startsWith('refs/heads/')) {
    throw new GitRecordError('INVALID_TARGET_REF', 'composition target must be a full refs/heads ref');
  }
  const expected = resolveRef(repo, expectedHead);
  const passed = resolveRef(repo, candidate);
  let mode;
  let result;
  if (isAncestor(repo, expected, passed)) {
    mode = 'fast-forward';
    result = passed;
  } else if (isAncestor(repo, passed, expected)) {
    throw new GitRecordError(
      'CANDIDATE_ALREADY_CONTAINED',
      `candidate ${passed} is already contained by expected target ${expected}`,
    );
  } else {
    mode = 'two-parent';
    result = withEngineGitContext(repo, (context) => {
      const tree = deterministicMergeTreeInContext(
        context,
        expected,
        passed,
        'composition',
      );
      return deterministicCompositionCommit(
        context,
        repo,
        targetRef,
        expected,
        passed,
        tree,
      );
    });
  }

  const current = resolveRef(repo, targetRef);
  if (current === result) {
    verifyExactComposition(repo, expected, passed, result, 'composition');
    return { mode, expected, candidate: passed, result, changed: false };
  }
  if (current !== expected) {
    throw new GitRecordError(
      'STALE_TARGET',
      `expected ${targetRef} at ${expected}, observed ${current}`,
    );
  }
  try {
    runGit(repo, ['update-ref', targetRef, result, expected], {
      code: 'STALE_TARGET',
      label: `compare-and-set ${targetRef}`,
    });
  } catch (error) {
    if (
      error instanceof GitRecordError
      && resolveRef(repo, targetRef) === result
    ) {
      return { mode, expected, candidate: passed, result, changed: false };
    }
    throw error;
  }
  verifyExactComposition(repo, expected, passed, result, 'composition');
  return { mode, expected, candidate: passed, result, changed: true };
}

export function assertRecordOnlyTransition(repo, before, after, admission, expectedPaths = []) {
  const root = requireRecordRootAdmission(repo, admission);
  const exactBefore = resolveRef(repo, before);
  const exactAfter = resolveRef(repo, after);
  const parents = commitParents(repo, exactAfter);
  if (parents.length !== 1 || parents[0] !== exactBefore) {
    throw new GitRecordError(
      'UNEXPECTED_RECORD_TRANSITION',
      `record transition ${exactAfter} is not a direct child of ${exactBefore}`,
    );
  }
  try {
    assertRecordRootAtRef(repo, exactAfter, root);
  } catch (error) {
    if (
      error instanceof GitRecordError
      && [
        'RECORD_ROOT_NOT_FOUND',
        'INVALID_RECORD_ROOT',
        'SYMLINKED_RECORD_ROOT',
      ].includes(error.code)
    ) {
      throw new GitRecordError(
        'RECORD_ROOT_REPLACED',
        `record transition deleted or replaced ${root}`,
        error,
      );
    }
    throw error;
  }
  const beforeIdentity = productTreeIdentity(repo, exactBefore, admission);
  const afterIdentity = productTreeIdentity(repo, exactAfter, admission);
  if (beforeIdentity.productTree !== afterIdentity.productTree) {
    throw new GitRecordError(
      'PRODUCT_CHANGED_DURING_RECORD_TRANSITION',
      'record transition changed product identity',
    );
  }
  const paths = changedPathsBetween(repo, exactBefore, exactAfter);
  if (paths.some((changedPath) => !recordPathAllowed(changedPath, root))) {
    throw new GitRecordError('NON_RECORD_CHANGE', 'record transition contains a product path');
  }
  const expected = [...expectedPaths]
    .map(assertRepositoryPath)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (expected.length > 0 && !isDeepStringArray(paths, expected)) {
    throw new GitRecordError(
      'INCOMPLETE_RECORD_TRANSITION',
      `record transition paths ${JSON.stringify(paths)} do not equal ${JSON.stringify(expected)}`,
    );
  }
  return { before: exactBefore, after: exactAfter, paths };
}

function isDeepStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function recordPathAllowed(relativePath, recordRoot) {
  return relativePath === recordRoot || relativePath.startsWith(`${recordRoot}/`);
}

function assertRecordRootPreservedInTree(repo, tree, root) {
  const raw = runGit(repo, ['ls-tree', '-z', tree, '--', root], {
    encoding: null,
    label: `inspect preserved record root ${root}`,
  });
  if (raw.length === 0) {
    throw new GitRecordError(
      'RECORD_ROOT_REPLACED',
      `record transition deleted ${root}`,
    );
  }
  const nul = raw.indexOf(0);
  if (nul < 0 || nul !== raw.length - 1) {
    throw new GitRecordError(
      'MALFORMED_GIT_TREE',
      `ambiguous tree entry for ${root}`,
    );
  }
  const entry = parseTreeEntry(raw.subarray(0, nul));
  if (entry.path !== root || entry.type !== 'tree' || entry.mode === '120000') {
    throw new GitRecordError(
      'RECORD_ROOT_REPLACED',
      `record transition replaced ${root}`,
    );
  }
}

export function commitRecordTransition(repo, {
  ref,
  expectedHead,
  message,
  admission,
  changes,
  createRef,
}) {
  const root = requireRecordRootAdmission(repo, admission);
  assertExactHeadRef(ref);
  let ownerRef;
  if (createRef !== undefined) {
    if (
      createRef === null
      || typeof createRef !== 'object'
      || Array.isArray(createRef)
      || Object.keys(createRef).length !== 1
      || typeof createRef.ref !== 'string'
    ) {
      throw new GitRecordError(
        'INVALID_CREATE_REF',
        'createRef must be exactly { ref: \"refs/heads/...\" }',
      );
    }
    ownerRef = assertExactHeadRef(createRef.ref);
    if (ownerRef === ref) {
      throw new GitRecordError(
        'INVALID_CREATE_REF',
        'createRef must differ from the updated record ref',
      );
    }
  }
  const expected = resolveRef(repo, expectedHead);
  assertRecordRootAtRef(repo, expected, root, { allowMissing: true });
  const current = resolveRef(repo, ref);
  if (current !== expected) {
    throw new GitRecordError(
      'STALE_WRITER',
      `expected ${ref} at ${expected}, observed ${current}`,
    );
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new GitRecordError('EMPTY_RECORD_TRANSITION', 'a record transition requires at least one path change');
  }
  const changePaths = Object.keys(changes);
  if (changePaths.length === 0) {
    throw new GitRecordError('EMPTY_RECORD_TRANSITION', 'a record transition requires at least one path change');
  }
  if (changePaths.length > MAX_RECORD_CHANGES) {
    throw new GitRecordError(
      'RECORD_CHANGE_LIMIT',
      `a record transition may change at most ${MAX_RECORD_CHANGES} paths`,
    );
  }
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new GitRecordError('INVALID_COMMIT_MESSAGE', 'a record transition requires a non-empty commit message');
  }
  const commitMessage = message.trim();
  if (Buffer.byteLength(commitMessage, 'utf8') > MAX_RECORD_MESSAGE_BYTES) {
    throw new GitRecordError(
      'COMMIT_MESSAGE_LIMIT',
      `record transition messages may be at most ${MAX_RECORD_MESSAGE_BYTES} UTF-8 bytes`,
    );
  }
  const preparedChanges = [];
  let aggregateBytes = 0;
  for (const relativePath of changePaths) {
    if (
      path.isAbsolute(relativePath)
      || relativePath.includes('\\')
      || relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
      || relativePath === root
      || !recordPathAllowed(relativePath, root)
    ) {
      throw new GitRecordError(
        'NON_RECORD_CHANGE',
        `record transition attempted to change non-record path ${relativePath}`,
      );
    }
    const value = changes[relativePath];
    let byteLength = 0;
    if (value !== null) {
      if (Buffer.isBuffer(value)) {
        byteLength = value.byteLength;
      } else if (typeof value === 'string') {
        byteLength = Buffer.byteLength(value, 'utf8');
      } else {
        throw new GitRecordError(
          'INVALID_RECORD_VALUE',
          `record value for ${relativePath} must be a string, Buffer, or null`,
        );
      }
      if (byteLength > MAX_RECORD_VALUE_BYTES) {
        throw new GitRecordError(
          'RECORD_VALUE_LIMIT',
          `record value for ${relativePath} exceeds ${MAX_RECORD_VALUE_BYTES} bytes`,
        );
      }
      aggregateBytes += byteLength;
      if (aggregateBytes > MAX_RECORD_TOTAL_BYTES) {
        throw new GitRecordError(
          'RECORD_TOTAL_LIMIT',
          `record transition values exceed ${MAX_RECORD_TOTAL_BYTES} aggregate bytes`,
        );
      }
    }
    preparedChanges.push([relativePath, value]);
  }

  const temporary = mkdtempSync(path.join(tmpdir(), 'baton-record-index-'));
  const indexFile = path.join(temporary, 'index');
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    runGit(repo, ['read-tree', expected], { env, label: 'seed record transition index' });
    for (const [relativePath, value] of preparedChanges) {
      if (value === null) {
        runGit(repo, ['update-index', '--force-remove', '--', relativePath], {
          env,
          label: `remove record ${relativePath}`,
        });
        continue;
      }
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
      const object = runGit(repo, ['hash-object', '-w', '--stdin'], {
        input: bytes,
        label: `write record blob ${relativePath}`,
      }).trim();
      runGit(repo, ['update-index', '--add', '--cacheinfo', `100644,${object},${relativePath}`], {
        env,
        label: `stage record ${relativePath}`,
      });
    }
    const tree = runGit(repo, ['write-tree'], { env, label: 'write record transition tree' }).trim();
    assertRecordRootPreservedInTree(repo, tree, root);
    const commit = runGit(repo, ['commit-tree', tree, '-p', expected], {
      input: `${commitMessage}\n`,
      env: {
        GIT_AUTHOR_NAME: 'Baton Records',
        GIT_AUTHOR_EMAIL: 'records@baton.invalid',
        GIT_COMMITTER_NAME: 'Baton Records',
        GIT_COMMITTER_EMAIL: 'records@baton.invalid',
      },
      label: 'create record transition commit',
    }).trim();
    try {
      if (ownerRef) {
        const transaction = [
          'start',
          `update ${ref} ${commit} ${expected}`,
          `create ${ownerRef} ${commit}`,
          'prepare',
          'commit',
          '',
        ].join('\n');
        runGit(repo, ['update-ref', '--stdin'], {
          input: transaction,
          code: 'ATOMIC_REF_UPDATE_FAILED',
          label: `atomically update ${ref} and create ${ownerRef}`,
        });
      } else {
        runGit(repo, ['update-ref', ref, commit, expected], {
          code: 'STALE_WRITER',
          label: `compare-and-set ${ref}`,
        });
      }
    } catch (error) {
      if (error instanceof GitRecordError) {
        const code = ownerRef ? 'ATOMIC_REF_UPDATE_FAILED' : 'STALE_WRITER';
        throw new GitRecordError(code, `record ref transaction lost for ${ref}`, error);
      }
      throw error;
    }
    return commit;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

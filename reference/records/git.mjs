import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

function gitEnvironment(extra = {}) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('GIT_')) delete environment[key];
  }
  const allowedOverrides = new Set([
    'GIT_INDEX_FILE',
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'GIT_AUTHOR_DATE',
    'GIT_COMMITTER_NAME',
    'GIT_COMMITTER_EMAIL',
    'GIT_COMMITTER_DATE',
  ]);
  for (const [key, value] of Object.entries(extra)) {
    if (!key.startsWith('GIT_') || allowedOverrides.has(key)) environment[key] = value;
  }
  return {
    ...environment,
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
}

export function runGit(repo, args, options = {}) {
  try {
    return execFileSync('git', args, {
      cwd: repo,
      encoding: Object.hasOwn(options, 'encoding') ? options.encoding : 'utf8',
      input: options.input,
      env: gitEnvironment(options.env),
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim();
    throw new GitRecordError(
      options.code ?? 'GIT_COMMAND_FAILED',
      `${options.label ?? `git ${args[0]}`} failed${stderr ? `: ${stderr}` : ''}`,
      error,
    );
  }
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

export function productTreeIdentity(repo, commit, recordRoot, options = {}) {
  const root = assertRelativeRoot(recordRoot).join('/');
  if (options.recordRootConsumed) {
    throw new GitRecordError(
      'RECORD_ROOT_CONSUMED',
      `record root ${root} is behaviorally consumed and cannot be excluded`,
    );
  }
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

function deterministicMergeTree(repo, expected, candidate, label) {
  return runGit(
    repo,
    ['merge-tree', '--write-tree', '--no-messages', expected, candidate],
    {
      code: 'COMPOSITION_CONFLICT',
      label: `compute deterministic ${label} tree`,
    },
  ).trim();
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

function deterministicCompositionCommit(repo, targetRef, expected, candidate, tree) {
  const timestamp = Math.max(
    commitTimestamp(repo, expected),
    commitTimestamp(repo, candidate),
  ) + 1;
  const date = `@${timestamp} +0000`;
  return runGit(
    repo,
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
    const tree = deterministicMergeTree(repo, expected, passed, 'composition');
    result = deterministicCompositionCommit(repo, targetRef, expected, passed, tree);
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

export function assertRecordOnlyTransition(repo, before, after, recordRoot, expectedPaths = []) {
  const root = assertRelativeRoot(recordRoot).join('/');
  const exactBefore = resolveRef(repo, before);
  const exactAfter = resolveRef(repo, after);
  const parents = commitParents(repo, exactAfter);
  if (parents.length !== 1 || parents[0] !== exactBefore) {
    throw new GitRecordError(
      'UNEXPECTED_RECORD_TRANSITION',
      `record transition ${exactAfter} is not a direct child of ${exactBefore}`,
    );
  }
  const beforeIdentity = productTreeIdentity(repo, exactBefore, root);
  const afterIdentity = productTreeIdentity(repo, exactAfter, root);
  if (beforeIdentity.productTree !== afterIdentity.productTree) {
    throw new GitRecordError(
      'PRODUCT_CHANGED_DURING_RECORD_TRANSITION',
      'record transition changed product identity',
    );
  }
  const raw = runGit(
    repo,
    ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', exactBefore, exactAfter],
    { encoding: null, label: 'read record transition paths' },
  );
  const paths = raw
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort();
  if (paths.some((changedPath) => !recordPathAllowed(changedPath, root))) {
    throw new GitRecordError('NON_RECORD_CHANGE', 'record transition contains a product path');
  }
  const expected = [...expectedPaths].sort();
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

export function commitRecordTransition(repo, {
  ref,
  expectedHead,
  message,
  recordRoot,
  changes,
}) {
  const root = assertRelativeRoot(recordRoot).join('/');
  const expected = resolveRef(repo, expectedHead);
  assertRecordRootAtRef(repo, expected, root, { allowMissing: true });
  const current = resolveRef(repo, ref);
  if (current !== expected) {
    throw new GitRecordError(
      'STALE_WRITER',
      `expected ${ref} at ${expected}, observed ${current}`,
    );
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).length === 0) {
    throw new GitRecordError('EMPTY_RECORD_TRANSITION', 'a record transition requires at least one path change');
  }
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new GitRecordError('INVALID_COMMIT_MESSAGE', 'a record transition requires a non-empty commit message');
  }
  for (const relativePath of Object.keys(changes)) {
    if (
      path.isAbsolute(relativePath)
      || relativePath.includes('\\')
      || relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
      || !recordPathAllowed(relativePath, root)
    ) {
      throw new GitRecordError(
        'NON_RECORD_CHANGE',
        `record transition attempted to change non-record path ${relativePath}`,
      );
    }
  }

  const temporary = mkdtempSync(path.join(tmpdir(), 'baton-record-index-'));
  const indexFile = path.join(temporary, 'index');
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    runGit(repo, ['read-tree', expected], { env, label: 'seed record transition index' });
    for (const [relativePath, value] of Object.entries(changes)) {
      if (value === null) {
        runGit(repo, ['update-index', '--remove', '--', relativePath], {
          env,
          label: `remove record ${relativePath}`,
        });
        continue;
      }
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
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
    const commit = runGit(repo, ['commit-tree', tree, '-p', expected], {
      input: `${message.trim()}\n`,
      env: {
        GIT_AUTHOR_NAME: 'Baton Records',
        GIT_AUTHOR_EMAIL: 'records@baton.invalid',
        GIT_COMMITTER_NAME: 'Baton Records',
        GIT_COMMITTER_EMAIL: 'records@baton.invalid',
      },
      label: 'create record transition commit',
    }).trim();
    try {
      runGit(repo, ['update-ref', ref, commit, expected], {
        code: 'STALE_WRITER',
        label: `compare-and-set ${ref}`,
      });
    } catch (error) {
      if (error instanceof GitRecordError) {
        throw new GitRecordError('STALE_WRITER', `compare-and-set lost for ${ref}`, error);
      }
      throw error;
    }
    return commit;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function readWorkingFile(repo, relativePath) {
  const root = repositoryRoot(repo);
  assertRepositoryPath(relativePath);
  return readFileSync(path.join(root, relativePath));
}

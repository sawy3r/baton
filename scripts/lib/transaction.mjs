import { randomBytes } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { TRANSACTION_VERSION } from './catalog.mjs';
import { sha256, stableJSON } from './digest.mjs';
import { fail } from './paths.mjs';

async function maybeLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function copyExact(source, destination) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    fail('SYMLINK_COMPONENT', `${source} is a symbolic link`);
  }
  if (info.isFile()) {
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(source, destination);
    await chmod(destination, info.mode & 0o777);
    return;
  }
  if (!info.isDirectory()) {
    fail('UNSAFE_TARGET', `${source} is not a regular file or directory`);
  }
  await mkdir(destination, { recursive: true, mode: info.mode & 0o777 });
  await chmod(destination, info.mode & 0o777);
  const entries = await readdir(source, { withFileTypes: true });
  entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
  for (const entry of entries) {
    await copyExact(join(source, entry.name), join(destination, entry.name));
  }
}

async function describePath(path) {
  const info = await maybeLstat(path);
  if (!info) return { path, kind: 'absent' };
  if (info.isSymbolicLink()) fail('SYMLINK_COMPONENT', `${path} is a symbolic link`);
  if (info.isFile()) {
    return {
      path,
      kind: 'file',
      mode: `0${(info.mode & 0o777).toString(8).padStart(3, '0')}`,
      digest: sha256(await readFile(path)),
    };
  }
  if (!info.isDirectory()) fail('UNSAFE_TARGET', `${path} is not a regular file or directory`);
  const entries = [];
  async function walk(directory, prefix) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const child of children) {
      const relativePath = prefix === '' ? child.name : `${prefix}/${child.name}`;
      const absolute = join(directory, child.name);
      const childInfo = await lstat(absolute);
      const mode = `0${(childInfo.mode & 0o777).toString(8).padStart(3, '0')}`;
      if (childInfo.isSymbolicLink()) fail('SYMLINK_COMPONENT', `${absolute} is a symbolic link`);
      if (childInfo.isDirectory()) {
        entries.push({ path: relativePath, kind: 'directory', mode });
        await walk(absolute, relativePath);
      } else if (childInfo.isFile()) {
        entries.push({
          path: relativePath,
          kind: 'file',
          mode,
          digest: sha256(await readFile(absolute)),
        });
      } else {
        fail('UNSAFE_TARGET', `${absolute} is not a regular file or directory`);
      }
    }
  }
  await walk(path, '');
  return {
    path,
    kind: 'directory',
    mode: `0${(info.mode & 0o777).toString(8).padStart(3, '0')}`,
    entries,
  };
}

async function contentFingerprint(path) {
  const description = await describePath(path);
  const { path: ignored, ...content } = description;
  return sha256(stableJSON(content));
}

export async function fingerprintPaths(paths) {
  const unique = [...new Set(paths.map((path) => resolve(path)))].sort((left, right) => (
    Buffer.from(left).compare(Buffer.from(right))
  ));
  const description = [];
  for (const path of unique) description.push(await describePath(path));
  return sha256(stableJSON(description));
}

async function writeJournal(transaction, journal) {
  const temporary = `${transaction.journalPath}.tmp-${process.pid}`;
  await writeFile(temporary, stableJSON(journal), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, transaction.journalPath);
  transaction.journal = journal;
}

function transactionId() {
  const stamp = new Date().toISOString().replaceAll(/[^0-9A-Za-z]/g, '');
  return `${stamp}-${process.pid}-${randomBytes(6).toString('hex')}`;
}

export async function beginTransaction({
  stateRoot,
  operation,
  affectedPaths,
  actions,
}) {
  const normalized = [...new Set(affectedPaths.map((path) => resolve(path)))].sort((left, right) => (
    Buffer.from(left).compare(Buffer.from(right))
  ));
  if (normalized.length === 0) fail('INVALID_TRANSACTION', 'a transaction needs affected paths');
  const id = transactionId();
  const root = join(stateRoot, 'transactions', id);
  const backupRoot = join(root, 'preimages');
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const snapshots = [];
  try {
    for (const [index, path] of normalized.entries()) {
      const info = await maybeLstat(path);
      const backup = `preimages/${String(index).padStart(4, '0')}-${basename(path)}`;
      if (info) await copyExact(path, join(root, backup));
      snapshots.push({
        path,
        existed: Boolean(info),
        backup: info ? backup : null,
        backup_fingerprint: info ? await contentFingerprint(join(root, backup)) : null,
      });
    }
    const transaction = {
      id,
      root,
      journalPath: join(root, 'journal.json'),
      journal: null,
    };
    await writeJournal(transaction, {
      schema_version: TRANSACTION_VERSION,
      id,
      operation,
      status: 'prepared',
      actions,
      affected_paths: normalized,
      snapshots,
      before_fingerprint: await fingerprintPaths(normalized),
      after_fingerprint: null,
      created_at: new Date().toISOString(),
      committed_at: null,
    });
    return transaction;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function validateJournal(journal, allowedPaths, id) {
  if (
    journal?.schema_version !== TRANSACTION_VERSION
    || journal.id !== id
    || !['prepared', 'committed', 'restored'].includes(journal.status)
    || !Array.isArray(journal.affected_paths)
    || !Array.isArray(journal.snapshots)
  ) {
    fail('INVALID_TRANSACTION', `invalid transaction journal ${id}`);
  }
  const allowed = new Set(allowedPaths.map((path) => resolve(path)));
  for (const path of journal.affected_paths) {
    if (typeof path !== 'string' || !allowed.has(resolve(path))) {
      fail('INVALID_TRANSACTION', `transaction ${id} contains an unexpected target`);
    }
  }
  if (journal.snapshots.length !== journal.affected_paths.length) {
    fail('INVALID_TRANSACTION', `transaction ${id} snapshot count differs`);
  }
  const snapshotPaths = new Set();
  for (const snapshot of journal.snapshots) {
    if (
      !journal.affected_paths.includes(snapshot.path)
      || snapshotPaths.has(snapshot.path)
      || typeof snapshot.existed !== 'boolean'
      || (snapshot.existed && typeof snapshot.backup !== 'string')
      || (!snapshot.existed && snapshot.backup !== null)
      || (snapshot.backup !== null && !/^preimages\/[0-9]{4}-[^/]+$/.test(snapshot.backup))
      || (
        snapshot.existed
        && (
          typeof snapshot.backup_fingerprint !== 'string'
          || !/^sha256:[0-9a-f]{64}$/.test(snapshot.backup_fingerprint)
        )
      )
      || (!snapshot.existed && snapshot.backup_fingerprint !== null)
    ) {
      fail('INVALID_TRANSACTION', `transaction ${id} has an invalid snapshot`);
    }
    snapshotPaths.add(snapshot.path);
  }
  return journal;
}

async function loadJournal(root, id, allowedPaths) {
  let journal;
  try {
    const path = join(root, 'journal.json');
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      fail('INVALID_TRANSACTION', `transaction journal ${id} is not a regular file`);
    }
    journal = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    fail('INVALID_TRANSACTION', `cannot read transaction journal ${id}`, error);
  }
  return validateJournal(journal, allowedPaths, id);
}

export async function restorePreimages(transaction, { status = 'restored' } = {}) {
  for (const snapshot of transaction.journal.snapshots) {
    if (
      snapshot.existed
      && await contentFingerprint(join(transaction.root, snapshot.backup))
        !== snapshot.backup_fingerprint
    ) {
      fail('INVALID_TRANSACTION', `transaction ${transaction.id} has a modified preimage`);
    }
    await rm(snapshot.path, { recursive: true, force: true });
    if (snapshot.existed) {
      await copyExact(join(transaction.root, snapshot.backup), snapshot.path);
    }
  }
  await writeJournal(transaction, {
    ...transaction.journal,
    status,
    committed_at: status === 'committed' ? new Date().toISOString() : null,
  });
}

export async function commitTransaction(transaction) {
  const afterFingerprint = await fingerprintPaths(transaction.journal.affected_paths);
  await writeJournal(transaction, {
    ...transaction.journal,
    status: 'committed',
    after_fingerprint: afterFingerprint,
    committed_at: new Date().toISOString(),
  });
  return transaction.journal;
}

export async function replaceFromStage(stagePath, targetPath, transaction, label) {
  const info = await maybeLstat(targetPath);
  if (info) {
    const displaced = join(transaction.root, 'displaced', label);
    await mkdir(dirname(displaced), { recursive: true, mode: 0o700 });
    await rename(targetPath, displaced);
  }
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o755 });
  await rename(stagePath, targetPath);
}

export async function atomicWrite(path, bytes, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  const temporary = join(dirname(path), `.${basename(path)}.baton-${process.pid}-${randomBytes(4).toString('hex')}`);
  await writeFile(temporary, bytes, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

async function transactionRoots(stateRoot) {
  const root = join(stateRoot, 'transactions');
  const rootInfo = await maybeLstat(root);
  if (rootInfo && (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())) {
    fail('INVALID_TRANSACTION', 'transaction storage is not a real directory');
  }
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (entries.some((entry) => !entry.isDirectory())) {
    fail('INVALID_TRANSACTION', 'transaction storage contains an unexpected entry');
  }
  return entries
    .map((entry) => ({ id: entry.name, root: join(root, entry.name) }))
    .sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id)));
}

export async function inspectTransactions({ stateRoot, allowedPaths }) {
  const transactions = [];
  for (const candidate of await transactionRoots(stateRoot)) {
    const journal = await loadJournal(candidate.root, candidate.id, allowedPaths);
    transactions.push({
      ...candidate,
      journalPath: join(candidate.root, 'journal.json'),
      journal,
    });
  }
  return transactions;
}

export async function recoverPrepared({ stateRoot, allowedPaths }) {
  const recovered = [];
  for (const transaction of await inspectTransactions({ stateRoot, allowedPaths })) {
    if (transaction.journal.status !== 'prepared') continue;
    await restorePreimages(transaction);
    recovered.push(transaction.id);
  }
  return recovered;
}

export async function rollbackTransaction({
  stateRoot,
  allowedPaths,
  selector,
  actions,
  postRestore,
}) {
  const transactions = await inspectTransactions({ stateRoot, allowedPaths });
  const candidates = transactions.filter(({ journal }) => journal.status === 'committed');
  const selected = selector === 'latest'
    ? candidates.at(-1)
    : candidates.find(({ id }) => id === selector);
  if (!selected) fail('ROLLBACK_NOT_FOUND', `no committed transaction matches ${selector}`);
  const current = await fingerprintPaths(selected.journal.affected_paths);
  if (current !== selected.journal.after_fingerprint) {
    fail('MODIFIED_OWNED_FILE', `transaction ${selected.id} no longer matches installed state`);
  }
  const rollback = await beginTransaction({
    stateRoot,
    operation: `rollback:${selected.id}`,
    affectedPaths: selected.journal.affected_paths,
    actions,
  });
  try {
    for (const snapshot of selected.journal.snapshots) {
      if (
        snapshot.existed
        && await contentFingerprint(join(selected.root, snapshot.backup))
          !== snapshot.backup_fingerprint
      ) {
        fail('INVALID_TRANSACTION', `transaction ${selected.id} has a modified preimage`);
      }
      await rm(snapshot.path, { recursive: true, force: true });
      if (snapshot.existed) {
        await copyExact(join(selected.root, snapshot.backup), snapshot.path);
      }
    }
    if (postRestore) await postRestore();
    await commitTransaction(rollback);
    return { selected: selected.id, transaction: rollback };
  } catch (error) {
    await restorePreimages(rollback);
    throw error;
  }
}

import assert from 'node:assert/strict';
import { rmSync, symlinkSync } from 'node:fs';
import test from 'node:test';

import {
  assertCandidate,
  assertCanonicalRecordRoot,
  assertRecordOnlyTransition,
  assertRecordRootAtRef,
  commitRecordTransition,
  productTreeIdentity,
  readFileAtRef,
  resolveRef,
} from '../../reference/records/git.mjs';
import { validateProofGitIdentity } from '../../reference/records/records.mjs';
import {
  captainResult,
  commitAll,
  designReady,
  git,
  proofReady,
  temporaryRepository,
  write,
} from './helpers.mjs';

function throwsCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code);
}

test('record-only commits preserve product identity while product edits invalidate it', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/app.txt', 'product-v1\n');
    write(fixture.repo, '.baton/releases/v1.0.0/plan.md', 'record-v1\n');
    const base = commitAll(fixture.repo, 'base product and record');
    const baseline = productTreeIdentity(fixture.repo, base, '.baton/releases');

    write(fixture.repo, '.baton/releases/v1.0.0/plan.md', 'record-v2\n');
    const recordOnly = commitAll(fixture.repo, 'record only');
    const afterRecord = productTreeIdentity(fixture.repo, recordOnly, '.baton/releases');
    assert.notEqual(afterRecord.candidateTree, baseline.candidateTree);
    assert.equal(afterRecord.productTree, baseline.productTree);
    assert.deepEqual(
      afterRecord.entries.map((entry) => entry.path),
      ['src/app.txt'],
    );

    write(fixture.repo, 'src/app.txt', 'product-v2\n');
    const productChange = commitAll(fixture.repo, 'product change');
    const afterProduct = productTreeIdentity(fixture.repo, productChange, '.baton/releases');
    assert.notEqual(afterProduct.productTree, baseline.productTree);

    assert.deepEqual(assertCandidate(fixture.repo, base, productChange), {
      base,
      candidate: productChange,
    });
  } finally {
    fixture.cleanup();
  }
});

test('a behaviorally consumed record root cannot claim product-tree exclusion', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/app.txt', 'product\n');
    const commit = commitAll(fixture.repo, 'base');
    throwsCode(
      () => productTreeIdentity(
        fixture.repo,
        commit,
        '.baton/releases',
        { recordRootConsumed: true },
      ),
      'RECORD_ROOT_CONSUMED',
    );
  } finally {
    fixture.cleanup();
  }
});

test('candidate ancestry is independent of product-tree equality', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/app.txt', 'base\n');
    const base = commitAll(fixture.repo, 'base');
    git(fixture.repo, 'switch', '-q', '-c', 'other');
    write(fixture.repo, '.baton/releases/v1/status.json', '{}\n');
    const descendant = commitAll(fixture.repo, 'record descendant');
    assert.equal(
      productTreeIdentity(fixture.repo, base, '.baton/releases').productTree,
      productTreeIdentity(fixture.repo, descendant, '.baton/releases').productTree,
    );

    git(fixture.repo, 'switch', '-q', '--detach', `${base}^0`);
    write(fixture.repo, 'src/app.txt', 'divergent\n');
    const divergent = commitAll(fixture.repo, 'divergent');
    throwsCode(() => assertCandidate(fixture.repo, descendant, divergent), 'INVALID_CANDIDATE_ANCESTRY');
  } finally {
    fixture.cleanup();
  }
});

test('Git blob reads preserve exact bytes', () => {
  const fixture = temporaryRepository();
  try {
    const bytes = Buffer.from([0x00, 0x0a, 0xff, 0x41]);
    write(fixture.repo, 'binary.dat', bytes);
    const commit = commitAll(fixture.repo, 'binary');
    const observed = readFileAtRef(fixture.repo, commit, 'binary.dat');
    assert.ok(Buffer.isBuffer(observed));
    assert.deepEqual(observed, bytes);
  } finally {
    fixture.cleanup();
  }
});

test('a captured ref cannot hide a symlinked record root behind a safe launch worktree', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'README.md', 'safe worktree\n');
    const safe = commitAll(fixture.repo, 'safe');
    symlinkSync('elsewhere', `${fixture.repo}/.baton`);
    const captured = commitAll(fixture.repo, 'captured symlink');
    git(fixture.repo, 'switch', '-q', '--detach', safe);

    throwsCode(
      () => assertRecordRootAtRef(fixture.repo, captured, '.baton/releases'),
      'SYMLINKED_RECORD_ROOT',
    );
    throwsCode(
      () => productTreeIdentity(fixture.repo, captured, '.baton/releases'),
      'SYMLINKED_RECORD_ROOT',
    );
  } finally {
    fixture.cleanup();
  }
});

test('a passed candidate must be reachable from its authoritative track head', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/app.txt', 'base\n');
    write(fixture.repo, '.baton/releases/keep', 'record root\n');
    const base = commitAll(fixture.repo, 'base');

    git(fixture.repo, 'switch', '-q', '-c', 'track-head', base);
    write(fixture.repo, 'src/app.txt', 'on track\n');
    const trackHead = commitAll(fixture.repo, 'track candidate');

    git(fixture.repo, 'switch', '-q', '-c', 'off-branch', base);
    write(fixture.repo, 'src/app.txt', 'off branch\n');
    const offBranch = commitAll(fixture.repo, 'off-branch candidate');
    const identity = productTreeIdentity(fixture.repo, offBranch, '.baton/releases');
    const status = proofReady(captainResult(designReady(), 'proceed'));
    status.proof.base_commit = base;
    status.proof.candidate_commit = offBranch;
    status.proof.candidate_tree = identity.candidateTree;
    status.proof.product_tree = identity.productTree;

    assert.equal(
      validateProofGitIdentity(fixture.repo, status, '.baton/releases').candidate,
      offBranch,
    );
    throwsCode(
      () => validateProofGitIdentity(
        fixture.repo,
        status,
        '.baton/releases',
        { authorityHead: trackHead },
      ),
      'CANDIDATE_NOT_ON_AUTHORITY',
    );
  } finally {
    fixture.cleanup();
  }
});

test('captured-object validation ignores an unsafe launch worktree', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'src/app.txt', 'safe product\n');
    const base = commitAll(fixture.repo, 'base product');
    write(fixture.repo, '.baton/releases/keep', 'safe captured records\n');
    const captured = commitAll(fixture.repo, 'safe captured root');
    const identity = productTreeIdentity(fixture.repo, captured, '.baton/releases');

    rmSync(`${fixture.repo}/.baton`, { recursive: true });
    symlinkSync('elsewhere', `${fixture.repo}/.baton`);
    commitAll(fixture.repo, 'unsafe launch checkout');
    throwsCode(
      () => assertCanonicalRecordRoot(fixture.repo, '.baton/releases'),
      'SYMLINKED_RECORD_ROOT',
    );
    assert.equal(
      productTreeIdentity(fixture.repo, captured, '.baton/releases').productTree,
      identity.productTree,
    );
    assert.deepEqual(
      assertRecordOnlyTransition(
        fixture.repo,
        base,
        captured,
        '.baton/releases',
        ['.baton/releases/keep'],
      ).paths,
      ['.baton/releases/keep'],
    );
    git(fixture.repo, 'branch', 'safe-record-transition', captured);
    const transitioned = commitRecordTransition(fixture.repo, {
      ref: 'refs/heads/safe-record-transition',
      expectedHead: captured,
      message: 'safe captured record transition',
      recordRoot: '.baton/releases',
      changes: {
        '.baton/releases/keep': 'updated captured record\n',
      },
    });
    assert.equal(resolveRef(fixture.repo, 'refs/heads/safe-record-transition'), transitioned);

    const status = proofReady(captainResult(designReady(), 'proceed'));
    status.proof.base_commit = base;
    status.proof.candidate_commit = captured;
    status.proof.candidate_tree = identity.candidateTree;
    status.proof.product_tree = identity.productTree;
    assert.equal(
      validateProofGitIdentity(
        fixture.repo,
        status,
        '.baton/releases',
        {
          authorityHead: captured,
          requireCurrentProduct: true,
        },
      ).candidate,
      captured,
    );
  } finally {
    fixture.cleanup();
  }
});

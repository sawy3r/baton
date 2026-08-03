import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commitParents,
  readFirstParentHistory,
  resolveRef,
  unsafeAtomicUpdateRefs,
  unsafePrepareMetadataCommit as prepareMetadataCommit,
} from '../../reference/records/git.mjs';
import {
  digestBytes,
  renderReceiptCommit,
} from '../../reference/records/receipts.mjs';
import {
  commitAll,
  git,
  temporaryRepository,
  write,
} from './helpers.mjs';

const OID_A = 'a'.repeat(40);
const TEST_GIT_IDENTITY = Object.freeze({
  name: 'Baton Test Engine',
  email: 'baton-test@localhost',
});

function unsafePrepareMetadataCommit(repo, options) {
  return prepareMetadataCommit(repo, { ...options, identity: TEST_GIT_IDENTITY });
}

function approvalMessage(summary = 'Plan approved.') {
  return renderReceiptCommit({
    subject: 'baton: approve plan',
    detail: 'Approval recorded once. \u2713',
    receipt: {
      version: 1,
      release: 'receipt-git',
      role: 'planner',
      result: 'approved',
      plan: OID_A,
      binds: OID_A,
      detail: digestBytes(Buffer.alloc(0)),
      summary,
      target: OID_A,
    },
  });
}

test('metadata receipt commits are deterministic, tree-preserving, and scan in one pass', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'product.txt', 'unchanged\n');
    const base = commitAll(fixture.repo, 'base');
    const message = approvalMessage();
    const first = unsafePrepareMetadataCommit(fixture.repo, {
      expectedHead: base,
      message,
    });
    const duplicate = unsafePrepareMetadataCommit(fixture.repo, {
      expectedHead: base,
      message,
    });
    assert.deepEqual(duplicate, first);
    const otherIdentity = prepareMetadataCommit(fixture.repo, {
      expectedHead: base,
      message,
      identity: { name: 'Another Engine', email: 'another@localhost' },
    });
    assert.notEqual(otherIdentity.commit, first.commit);
    assert.deepEqual(commitParents(fixture.repo, otherIdentity.commit), [base]);
    assert.equal(
      git(fixture.repo, 'rev-parse', `${otherIdentity.commit}^{tree}`),
      git(fixture.repo, 'rev-parse', `${first.commit}^{tree}`),
    );
    assert.deepEqual(
      readFirstParentHistory(fixture.repo, otherIdentity.commit)[0].message,
      message,
    );
    assert.deepEqual(commitParents(fixture.repo, first.commit), [base]);
    assert.equal(
      git(fixture.repo, 'rev-parse', `${first.commit}^{tree}`),
      git(fixture.repo, 'rev-parse', `${base}^{tree}`),
    );

    unsafeAtomicUpdateRefs(fixture.repo, [{
      kind: 'update',
      ref: 'refs/heads/main',
      newHead: first.commit,
      expectedHead: base,
    }]);
    assert.equal(resolveRef(fixture.repo, 'refs/heads/main'), first.commit);

    const history = readFirstParentHistory(fixture.repo, 'refs/heads/main');
    assert.equal(history[0].oid, first.commit);
    assert.deepEqual(history[0].parents, [base]);
    assert.deepEqual(history[0].message, message);
    assert.equal(history[1].oid, base);
  } finally {
    fixture.cleanup();
  }
});

test('commit writers reject missing and malformed identities before object creation', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'product.txt', 'unchanged\n');
    const base = commitAll(fixture.repo, 'base');
    const before = git(fixture.repo, 'count-objects', '-v');
    const malformed = [
      undefined,
      { name: '', email: 'engine@localhost' },
      { name: 'Engine\nInjected', email: 'engine@localhost' },
      { name: 'Engine <admin>', email: 'engine@localhost' },
      { name: 'Engine', email: 'missing-at-sign' },
      { name: 'Engine', email: 'engine@localhost\r' },
      { name: '\ud800', email: 'engine@localhost' },
      { name: 'x'.repeat(129), email: 'engine@localhost' },
      { name: 'Engine', email: `${'x'.repeat(245)}@localhost` },
      { name: 'Engine', email: 'engine@localhost', extra: true },
    ];
    for (const identity of malformed) {
      assert.throws(
        () => prepareMetadataCommit(fixture.repo, {
          expectedHead: base,
          message: approvalMessage(),
          identity,
        }),
        (error) => error?.code === 'INVALID_GIT_IDENTITY',
      );
    }
    assert.equal(git(fixture.repo, 'count-objects', '-v'), before);
    const boundary = prepareMetadataCommit(fixture.repo, {
      expectedHead: base,
      message: approvalMessage(),
      identity: {
        name: 'x'.repeat(128),
        email: `${'x'.repeat(244)}@localhost`,
      },
    });
    assert.deepEqual(commitParents(fixture.repo, boundary.commit), [base]);
  } finally {
    fixture.cleanup();
  }
});

test('metadata messages and history scans retain strict bounds', () => {
  const fixture = temporaryRepository();
  try {
    write(fixture.repo, 'product.txt', 'unchanged\n');
    const base = commitAll(fixture.repo, 'base');
    assert.throws(
      () => unsafePrepareMetadataCommit(fixture.repo, {
        expectedHead: base,
        message: Buffer.from('bad\r\n'),
      }),
      (error) => error?.code === 'INVALID_COMMIT_MESSAGE',
    );
    assert.throws(
      () => readFirstParentHistory(fixture.repo, base, { maxCount: 0 }),
      (error) => error?.code === 'INVALID_HISTORY_LIMIT',
    );
  } finally {
    fixture.cleanup();
  }
});

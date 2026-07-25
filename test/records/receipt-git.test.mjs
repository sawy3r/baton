import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commitParents,
  readFirstParentHistory,
  resolveRef,
  unsafeAtomicUpdateRefs,
  unsafePrepareMetadataCommit,
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

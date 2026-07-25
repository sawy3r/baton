import assert from 'node:assert/strict';
import test from 'node:test';

import {
  productTreeIdentity,
} from '../../reference/records/git.mjs';
import {
  digestBytes,
  parsePlanBytes,
  parseReceiptCommitMessage,
  renderReceiptCommit,
} from '../../reference/records/receipts.mjs';
import {
  BatonStateError,
  readBatonState,
} from '../../reference/records/state.mjs';
import {
  commitAll,
  git,
  temporaryRepository,
  testProductExclusionAdmission,
  write,
} from '../records/helpers.mjs';

function metadata(overrides = {}) {
  return {
    schema_version: 'baton.plan/v2',
    release: 'state-test',
    revision: 1,
    previous_plan: null,
    repository: 'example/state-test',
    target_ref: 'refs/heads/main',
    approval_ref: 'approval://state-test/1',
    tracks: [{
      id: 'T1',
      depends_on: [],
      slices: [{
        id: 'S1',
        outcome: 'Deliver the state seam.',
        scope: { include: ['src/state.txt'], exclude: [] },
        acceptance: [{ id: 'A1', text: 'The state is observable.' }],
        checks: ['test state'],
        constraints: [],
        depends_on: [],
        consumes: [],
      }],
    }],
    ...overrides,
  };
}

function planBytes(value) {
  return Buffer.from(
    `\`\`\`baton-plan-v2\n${JSON.stringify(value)}\n\`\`\`\n\n# State test\n`,
  );
}

function appendReceipt(repo, receipt, subject = `${receipt.role} ${receipt.result}`) {
  const message = renderReceiptCommit({
    subject,
    detail: receipt.summary,
    receipt: {
      ...receipt,
      detail: digestBytes(Buffer.alloc(0)),
    },
  });
  write(repo, '.git/BATON_TEST_MESSAGE', message);
  git(repo, 'commit', '--allow-empty', '-q', '-F', '.git/BATON_TEST_MESSAGE');
  return {
    oid: git(repo, 'rev-parse', 'HEAD'),
    receipt: parseReceiptCommitMessage(message).receipt,
  };
}

function fixture() {
  const temporary = temporaryRepository();
  const { repo } = temporary;
  write(repo, 'README.md', 'product\n');
  const target = commitAll(repo, 'base product');
  const value = metadata();
  const parsed = parsePlanBytes(planBytes(value));
  git(repo, 'switch', '-q', '-c', 'release-wt/state-test', target);
  write(repo, '.baton/releases/state-test/plan.md', parsed.bytes);
  const planCommit = commitAll(repo, 'plan revision 1');
  const plan = git(repo, 'rev-parse', 'HEAD:.baton/releases/state-test/plan.md');
  const approval = appendReceipt(repo, {
    version: 1,
    release: 'state-test',
    role: 'planner',
    result: 'approved',
    plan,
    binds: planCommit,
    summary: 'Plan revision 1 is approved.',
    target,
  });
  const admission = testProductExclusionAdmission(repo);
  return {
    repo,
    value,
    parsed,
    plan,
    approval,
    target,
    admission,
    cleanup: temporary.cleanup,
  };
}

function passSlice(fixture) {
  const {
    repo,
    plan,
    parsed,
    approval,
    target,
    admission,
  } = fixture;
  git(repo, 'switch', '-q', '-c', 'track/state-test/T1', approval.oid);
  const common = {
    version: 1,
    release: 'state-test',
    slice: 'S1',
    attempt: 1,
    plan,
    contract: parsed.metadata.contracts.S1,
  };
  const design = appendReceipt(repo, {
    ...common,
    role: 'implementer',
    result: 'designed',
    binds: approval.oid,
    summary: 'Use one pure reducer.',
  });
  const captain = appendReceipt(repo, {
    ...common,
    role: 'captain',
    result: 'proceed',
    binds: design.oid,
    summary: 'The reducer design may proceed.',
  });
  write(repo, 'src/state.txt', 'derived\n');
  const candidate = commitAll(repo, 'implement state seam');
  const identity = productTreeIdentity(repo, candidate, admission);
  const implemented = appendReceipt(repo, {
    ...common,
    role: 'implementer',
    result: 'candidate',
    binds: captain.oid,
    base: target,
    candidate,
    product_tree: identity.productTree,
    inputs: {},
    checks: digestBytes(Buffer.from('implementer checks')),
    summary: 'The candidate is ready.',
  });
  const verified = appendReceipt(repo, {
    ...common,
    role: 'verifier',
    result: 'pass',
    binds: implemented.oid,
    candidate,
    product_tree: identity.productTree,
    inputs: {},
    checks: digestBytes(Buffer.from('independent verifier checks')),
    summary: 'The exact candidate passes.',
  });
  return { design, captain, candidate, implemented, verified };
}

test('approved plan derives missing procedural track state without BLOCKED', () => {
  const value = fixture();
  try {
    const state = readBatonState(value.repo, 'state-test');
    assert.equal(state.plan.metadata.revision, 1);
    assert.equal(state.plan.approval_oid, value.approval.oid);
    assert.equal(state.plan.target_stale, false);
    assert.equal(state.tracks[0].head, null);
    assert.equal(state.slices[0].next_role, 'implementer');
    assert.equal(state.slices[0].attempt, 1);
    assert.equal(state.slices[0].status, 'ready');
    assert.equal(state.diagnostics[0].code, 'TRACK_REF_ABSENT');
  } finally {
    value.cleanup();
  }
});

test('canonical role chain selects PASS and the one-track exact merge fast path', () => {
  const value = fixture();
  try {
    const passed = passSlice(value);
    const state = readBatonState(value.repo, 'state-test', {
      productExclusionAdmission: value.admission,
    });
    assert.equal(state.slices[0].pass.oid, passed.verified.oid);
    assert.equal(state.slices[0].candidate.oid, passed.implemented.oid);
    assert.equal(state.slices[0].next_role, 'merge');
    assert.equal(state.assembly.next_role, 'merge');
    assert.equal(state.assembly.pass.oid, passed.verified.oid);
    assert.equal(state.assembly.outcome, 'pass');
  } finally {
    value.cleanup();
  }
});

test('unchanged contracts retain PASS across an approved plan revision', () => {
  const value = fixture();
  try {
    const passed = passSlice(value);
    git(value.repo, 'switch', '-q', 'main');
    write(value.repo, 'target.txt', 'advanced\n');
    const target = commitAll(value.repo, 'advance target');
    git(value.repo, 'switch', '-q', 'release-wt/state-test');
    const revision = metadata({
      revision: 2,
      previous_plan: value.plan,
      approval_ref: 'approval://state-test/2',
    });
    const parsed = parsePlanBytes(planBytes(revision));
    write(value.repo, '.baton/releases/state-test/plan.md', parsed.bytes);
    const planCommit = commitAll(value.repo, 'plan revision 2');
    const plan = git(value.repo, 'rev-parse', 'HEAD:.baton/releases/state-test/plan.md');
    appendReceipt(value.repo, {
      version: 1,
      release: 'state-test',
      role: 'planner',
      result: 'approved',
      plan,
      binds: planCommit,
      target,
      summary: 'Plan revision 2 is approved.',
    });

    const state = readBatonState(value.repo, 'state-test', {
      productExclusionAdmission: value.admission,
    });
    assert.equal(state.plan.metadata.revision, 2);
    assert.equal(state.slices[0].pass.oid, passed.verified.oid);
    assert.equal(state.slices[0].retained, true);
    assert.equal(state.assembly.outcome, 'none');
  } finally {
    value.cleanup();
  }
});

test('a forged Captain binding is invalid, not a procedural blocker', () => {
  const value = fixture();
  try {
    git(value.repo, 'switch', '-q', '-c', 'track/state-test/T1', value.approval.oid);
    const common = {
      version: 1,
      release: 'state-test',
      slice: 'S1',
      attempt: 1,
      plan: value.plan,
      contract: value.parsed.metadata.contracts.S1,
    };
    appendReceipt(value.repo, {
      ...common,
      role: 'implementer',
      result: 'designed',
      binds: value.approval.oid,
      summary: 'A legitimate design.',
    });
    appendReceipt(value.repo, {
      ...common,
      role: 'captain',
      result: 'proceed',
      binds: value.approval.oid,
      summary: 'A forged decision binding.',
    });
    assert.throws(
      () => readBatonState(value.repo, 'state-test'),
      (error) => error instanceof BatonStateError && error.code === 'STALE_BINDING',
    );
  } finally {
    value.cleanup();
  }
});

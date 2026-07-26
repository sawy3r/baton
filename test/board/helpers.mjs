import {
  digestBytes,
  parsePlanBytes,
  parseReceiptCommitMessage,
  renderReceiptCommit,
} from '../../reference/records/receipts.mjs';
import {
  productTreeIdentity,
} from '../../reference/records/git.mjs';
import {
  commitAll,
  git,
  temporaryRepository,
  testProductExclusionAdmission,
  write,
} from '../records/helpers.mjs';

export function slice(id, include, overrides = {}) {
  return {
    id,
    outcome: `Deliver ${id}.`,
    scope: { include: [include], exclude: [] },
    acceptance: [{ id: `${id}-A1`, text: `${id} is observable.` }],
    checks: ['node --test'],
    constraints: [],
    depends_on: [],
    consumes: [],
    ...overrides,
  };
}

export function oneSliceMetadata(overrides = {}) {
  return {
    schema_version: 'baton.plan/v2',
    release: 'v1.0.0',
    revision: 1,
    previous_plan: null,
    repository: 'example/baton',
    target_ref: 'refs/heads/main',
    approval_ref: 'approval://v1.0.0/1',
    tracks: [{
      id: 'T1',
      depends_on: [],
      slices: [slice('S1', 'src/one.txt')],
    }],
    ...overrides,
  };
}

export function planBytes(metadata) {
  return Buffer.from(
    `\`\`\`baton-plan-v2\n${JSON.stringify(metadata)}\n\`\`\`\n\n# ${metadata.release}\n`,
  );
}

export function appendReceipt(repo, receipt, subject = `${receipt.role} ${receipt.result}`) {
  const message = renderReceiptCommit({
    subject,
    detail: receipt.summary,
    receipt: { ...receipt, detail: digestBytes(Buffer.alloc(0)) },
  });
  write(repo, '.git/BATON_BOARD_MESSAGE', message);
  git(repo, 'commit', '--allow-empty', '-q', '-F', '.git/BATON_BOARD_MESSAGE');
  return {
    oid: git(repo, 'rev-parse', 'HEAD'),
    receipt: parseReceiptCommitMessage(message).receipt,
  };
}

export function baselineFixture(metadata = oneSliceMetadata()) {
  const temporary = temporaryRepository();
  const { repo } = temporary;
  write(repo, 'README.md', 'product\n');
  const target = commitAll(repo, 'base product');
  const parsed = parsePlanBytes(planBytes(metadata));
  git(repo, 'switch', '-q', '-c', `release-wt/${metadata.release}`, target);
  write(repo, `.baton/releases/${metadata.release}/plan.md`, parsed.bytes);
  const planCommit = commitAll(repo, `plan revision ${metadata.revision}`);
  const plan = git(
    repo,
    'rev-parse',
    `HEAD:.baton/releases/${metadata.release}/plan.md`,
  );
  const approval = appendReceipt(repo, {
    version: 1,
    release: metadata.release,
    role: 'planner',
    result: 'approved',
    plan,
    binds: planCommit,
    target,
    summary: `Plan revision ${metadata.revision} is approved.`,
  });
  return {
    ...temporary,
    metadata,
    parsed,
    plan,
    planCommit,
    approval,
    target,
    admission: testProductExclusionAdmission(repo),
  };
}

function plannedSlice(fixture, sliceID) {
  for (const track of fixture.parsed.metadata.tracks) {
    const item = track.slices.find(({ id }) => id === sliceID);
    if (item) return { track, item };
  }
  throw new Error(`unknown slice ${sliceID}`);
}

function switchTrack(fixture, trackID) {
  const branch = `track/${fixture.metadata.release}/${trackID}`;
  try {
    git(fixture.repo, 'switch', '-q', branch);
  } catch {
    git(fixture.repo, 'switch', '-q', '-c', branch, fixture.approval.oid);
  }
}

export function passSlice(fixture, sliceID, {
  attempt = 1,
  inputs = {},
  implementerChecks = 'implementer checks',
  verifierChecks = 'verifier checks',
  verifierResult = 'pass',
} = {}) {
  const { track, item } = plannedSlice(fixture, sliceID);
  switchTrack(fixture, track.id);
  const common = {
    version: 1,
    release: fixture.metadata.release,
    slice: sliceID,
    attempt,
    plan: fixture.plan,
    contract: fixture.parsed.metadata.contracts[sliceID],
  };
  const design = appendReceipt(fixture.repo, {
    ...common,
    role: 'implementer',
    result: 'designed',
    binds: fixture.approval.oid,
    summary: `Design ${sliceID}.`,
  });
  const captain = appendReceipt(fixture.repo, {
    ...common,
    role: 'captain',
    result: 'proceed',
    binds: design.oid,
    summary: `Proceed with ${sliceID}.`,
  });
  write(fixture.repo, item.scope.include[0], `${sliceID} product\n`);
  const candidate = commitAll(fixture.repo, `implement ${sliceID}`);
  const identity = productTreeIdentity(fixture.repo, candidate, fixture.admission);
  const implemented = appendReceipt(fixture.repo, {
    ...common,
    role: 'implementer',
    result: 'candidate',
    binds: captain.oid,
    base: fixture.target,
    candidate,
    product_tree: identity.productTree,
    inputs,
    checks: digestBytes(Buffer.from(implementerChecks)),
    summary: `${sliceID} candidate.`,
  });
  const verified = appendReceipt(fixture.repo, {
    ...common,
    role: 'verifier',
    result: verifierResult,
    binds: implemented.oid,
    candidate,
    product_tree: identity.productTree,
    inputs,
    checks: digestBytes(Buffer.from(verifierChecks)),
    summary: `${sliceID} verification is ${verifierResult}.`,
  });
  return { design, captain, candidate, identity, implemented, verified };
}

export function designSlice(fixture, sliceID, { attempt = 1, binds = fixture.approval.oid } = {}) {
  const { track } = plannedSlice(fixture, sliceID);
  switchTrack(fixture, track.id);
  return appendReceipt(fixture.repo, {
    version: 1,
    release: fixture.metadata.release,
    slice: sliceID,
    role: 'implementer',
    result: 'designed',
    attempt,
    plan: fixture.plan,
    contract: fixture.parsed.metadata.contracts[sliceID],
    binds,
    summary: `Design ${sliceID}.`,
  });
}

export function revisePlan(fixture, mutate, { moveTarget = false } = {}) {
  let target = fixture.target;
  if (moveTarget) {
    git(fixture.repo, 'switch', '-q', 'main');
    write(fixture.repo, `target-${fixture.metadata.revision + 1}.txt`, 'advance\n');
    target = commitAll(fixture.repo, 'advance target');
  }
  git(fixture.repo, 'switch', '-q', `release-wt/${fixture.metadata.release}`);
  const metadata = structuredClone(fixture.metadata);
  metadata.revision += 1;
  metadata.previous_plan = fixture.plan;
  metadata.approval_ref = `approval://${metadata.release}/${metadata.revision}`;
  mutate?.(metadata);
  const parsed = parsePlanBytes(planBytes(metadata));
  write(fixture.repo, `.baton/releases/${metadata.release}/plan.md`, parsed.bytes);
  const planCommit = commitAll(fixture.repo, `plan revision ${metadata.revision}`);
  const plan = git(
    fixture.repo,
    'rev-parse',
    `HEAD:.baton/releases/${metadata.release}/plan.md`,
  );
  const approval = appendReceipt(fixture.repo, {
    version: 1,
    release: metadata.release,
    role: 'planner',
    result: 'approved',
    plan,
    binds: planCommit,
    target,
    summary: `Plan revision ${metadata.revision} is approved.`,
  });
  Object.assign(fixture, {
    metadata,
    parsed,
    plan,
    planCommit,
    approval,
    target,
  });
  return fixture;
}

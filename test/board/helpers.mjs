import {
  captainResult,
  designReady,
  initialWorkStatus,
  initialAssemblyStatus,
  makePlanBytes,
  makePlanMetadata,
  mergedWork,
  mergedAssembly,
  proofReady,
  temporaryRepository,
  testProductExclusionAdmission,
  verified,
  clone,
  commitAll,
  git,
  write,
} from '../records/helpers.mjs';
import {
  assemblyProofPath,
  assemblyStatusPath,
  digestBytes,
  parsePlanBytes,
  workDesignPath,
  workProofPath,
  workStatusPath,
} from '../../reference/records/records.mjs';
import {
  productTreeIdentity,
  resolveRef,
  unsafeApplyExactComposition,
  unsafeCommitRecordTransition,
} from '../../reference/records/git.mjs';

export function bindStatus(status, plan) {
  const bound = clone(status);
  bound.plan.digest = plan.digest;
  bound.plan.approval.ref = plan.metadata.approval_ref;
  return bound;
}

export function writeStatus(repo, plan, status) {
  write(repo, workStatusPath(plan, status.work_id), `${JSON.stringify(status)}\n`);
}

export function baselineFixture(metadata = makePlanMetadata()) {
  const fixture = temporaryRepository();
  write(fixture.repo, 'README.md', 'product\n');
  const target = commitAll(fixture.repo, 'base product');
  const plan = parsePlanBytes(makePlanBytes(metadata));
  git(fixture.repo, 'switch', '-q', '-c', `release-wt/${metadata.release}`, target);
  write(
    fixture.repo,
    `.baton/releases/${metadata.release}/plan.md`,
    plan.bytes,
  );
  for (const track of plan.metadata.tracks) {
    for (const work of track.work) {
      writeStatus(
        fixture.repo,
        plan,
        bindStatus(initialWorkStatus({
          workId: work.id,
          trackId: track.id,
          authority: plan.metadata.release_ref,
        }), plan),
      );
    }
  }
  const release = commitAll(fixture.repo, 'approved release baseline');
  return {
    ...fixture,
    plan,
    target,
    release,
  };
}

export function addBaselineRelease(fixture, release, { malformedWork = null } = {}) {
  const metadata = makePlanMetadata();
  metadata.release = release;
  metadata.release_ref = `refs/heads/release-wt/${release}`;
  metadata.approval_ref = `approval://${release}/1`;
  for (const track of metadata.tracks) {
    track.ref = `refs/heads/track/${release}/${track.id}`;
  }
  const plan = parsePlanBytes(makePlanBytes(metadata));
  git(fixture.repo, 'switch', '-q', 'main');
  git(fixture.repo, 'switch', '-q', '-c', `release-wt/${release}`);
  write(fixture.repo, `.baton/releases/${release}/plan.md`, plan.bytes);
  for (const track of plan.metadata.tracks) {
    for (const work of track.work) {
      if (work.id === malformedWork) {
        write(fixture.repo, workStatusPath(plan, work.id), '{"malformed":true}\n');
        continue;
      }
      const status = initialWorkStatus({
        workId: work.id,
        trackId: track.id,
        authority: plan.metadata.release_ref,
      });
      status.release = release;
      status.owner_ref = track.ref;
      status.authority_ref = plan.metadata.release_ref;
      status.plan.digest = plan.digest;
      status.plan.approval.ref = plan.metadata.approval_ref;
      writeStatus(fixture.repo, plan, status);
    }
  }
  return {
    plan,
    head: commitAll(fixture.repo, `approved ${release} baseline`),
  };
}

export function prepareReleaseMove(fixture, label) {
  git(fixture.repo, 'switch', '-q', 'release-wt/v1.0.0');
  write(fixture.repo, `notes/${label}.txt`, `${label}\n`);
  return commitAll(fixture.repo, label);
}

export function materializeTrack(fixture, trackId) {
  const track = fixture.plan.metadata.tracks.find((item) => item.id === trackId);
  const admission = testProductExclusionAdmission(fixture.repo);
  const materialization = {
    base_commit: fixture.release,
    dependencies: track.depends_on.map((dependencyId) => {
      const dependency = fixture.plan.metadata.tracks.find((item) => item.id === dependencyId);
      return {
        track_id: dependencyId,
        frozen_head: resolveRef(fixture.repo, dependency.ref),
      };
    }),
  };
  const statuses = {};
  const changes = {};
  for (const work of track.work) {
    const status = bindStatus(initialWorkStatus({
      workId: work.id,
      trackId,
      materialization,
    }), fixture.plan);
    statuses[work.id] = status;
    changes[workStatusPath(fixture.plan, work.id)] = `${JSON.stringify(status)}\n`;
  }
  git(fixture.repo, 'switch', '-q', 'main');
  unsafeCommitRecordTransition(fixture.repo, {
    ref: fixture.plan.metadata.release_ref,
    expectedHead: fixture.release,
    message: `materialize ${trackId}`,
    recordPathAdmission: admission,
    productExclusionAdmission: admission,
    changes,
    createRef: { ref: track.ref },
  });
  fixture.release = resolveRef(fixture.repo, fixture.plan.metadata.release_ref);
  return {
    track,
    admission,
    materialization,
    statuses,
    marker: resolveRef(fixture.repo, track.ref),
  };
}

export function advanceToCaptain(fixture, materialized, workId) {
  git(
    fixture.repo,
    'switch',
    '-q',
    materialized.track.ref.replace('refs/heads/', ''),
  );
  const bytes = Buffer.from(`# ${workId} design\n`);
  write(fixture.repo, workDesignPath(fixture.plan, workId), bytes);
  const status = designReady(materialized.statuses[workId], {
    digest: digestBytes(bytes),
    producer: `${workId}-implementer-design`,
  });
  writeStatus(fixture.repo, fixture.plan, status);
  const head = commitAll(fixture.repo, `design ${workId}`);
  return { status, head };
}

export function composeSingleWorkTrack(fixture, trackId) {
  const materialized = materializeTrack(fixture, trackId);
  const [work] = materialized.track.work;
  const designed = advanceToCaptain(fixture, materialized, work.id).status;
  const proceeded = captainResult(designed, 'proceed');
  proceeded.captain.invocation = `${work.id}-captain`;
  writeStatus(fixture.repo, fixture.plan, proceeded);
  commitAll(fixture.repo, `captain proceeds ${work.id}`);

  write(fixture.repo, work.scope.include[0], `${work.id} product\n`);
  const candidate = commitAll(fixture.repo, `implement ${work.id}`);
  const identity = productTreeIdentity(fixture.repo, candidate, materialized.admission);
  const proofBytes = Buffer.from(`# ${work.id} proof\n`);
  write(fixture.repo, workProofPath(fixture.plan, work.id), proofBytes);
  const implemented = proofReady(proceeded, {
    digest: digestBytes(proofBytes),
    producer: `${work.id}-implementer-code`,
    candidate,
    candidateTree: identity.candidateTree,
    productTree: identity.productTree,
  });
  implemented.proof.base_commit = materialized.materialization.base_commit;
  writeStatus(fixture.repo, fixture.plan, implemented);
  commitAll(fixture.repo, `proof ${work.id}`);
  const passed = verified(implemented, 'pass');
  passed.verification.invocation = `${work.id}-verifier`;
  writeStatus(fixture.repo, fixture.plan, passed);
  const frozenHead = commitAll(fixture.repo, `verify ${work.id}`);

  git(fixture.repo, 'switch', '-q', `release-wt/${fixture.plan.metadata.release}`);
  const expectedRelease = resolveRef(fixture.repo, fixture.plan.metadata.release_ref);
  git(
    fixture.repo,
    'merge',
    '-q',
    '--no-ff',
    '-m',
    `compose ${trackId}`,
    materialized.track.ref.replace('refs/heads/', ''),
  );
  const composition = resolveRef(fixture.repo, fixture.plan.metadata.release_ref);
  const complete = mergedWork(passed);
  complete.merge.frozen_track_head = frozenHead;
  complete.merge.expected_target = expectedRelease;
  complete.merge.observed_target = expectedRelease;
  complete.merge.result_commit = composition;
  writeStatus(fixture.repo, fixture.plan, complete);
  const transfer = commitAll(fixture.repo, `transfer ${trackId} authority`);
  fixture.release = transfer;
  return {
    ...materialized,
    candidate,
    frozenHead,
    composition,
    transfer,
    passed,
    complete,
  };
}

export function oneTrackMetadata() {
  const metadata = makePlanMetadata();
  metadata.tracks = [{
    ...metadata.tracks[0],
    work: [metadata.tracks[0].work[0]],
  }];
  return metadata;
}

export function prepareAssembly(fixture, composed) {
  git(fixture.repo, 'switch', '-q', `release-wt/${fixture.plan.metadata.release}`);
  const candidate = resolveRef(fixture.repo, fixture.plan.metadata.release_ref);
  const identity = productTreeIdentity(fixture.repo, candidate, composed.admission);
  const proofBytes = Buffer.from('# Assembly proof\n\nThe composed outcome passes as a whole.\n');
  const assembly = initialAssemblyStatus();
  assembly.release = fixture.plan.metadata.release;
  assembly.owner_ref = fixture.plan.metadata.release_ref;
  assembly.authority_ref = fixture.plan.metadata.release_ref;
  assembly.target_ref = fixture.plan.metadata.target_ref;
  assembly.plan.digest = fixture.plan.digest;
  assembly.plan.approval.ref = fixture.plan.metadata.approval_ref;
  assembly.proof.digest = digestBytes(proofBytes);
  assembly.proof.repository = fixture.plan.metadata.repository;
  assembly.proof.base_commit = candidate;
  assembly.proof.candidate_commit = candidate;
  assembly.proof.candidate_tree = identity.candidateTree;
  assembly.proof.product_tree = identity.productTree;
  assembly.proof.plan_digest = fixture.plan.digest;
  assembly.proof.approval_digest = assembly.plan.approval.digest;
  assembly.proof.components = [{
    track_id: composed.track.id,
    head: composed.frozenHead,
  }];
  write(fixture.repo, assemblyProofPath(fixture.plan), proofBytes);
  write(
    fixture.repo,
    assemblyStatusPath(fixture.plan),
    `${JSON.stringify(assembly)}\n`,
  );
  fixture.release = commitAll(fixture.repo, 'prepare assembly');
  return { assembly, candidate, proofBytes };
}

export function passAssembly(fixture, prepared) {
  const passed = verified(prepared.assembly, 'pass');
  passed.verification.invocation = 'assembly-verifier';
  write(
    fixture.repo,
    assemblyStatusPath(fixture.plan),
    `${JSON.stringify(passed)}\n`,
  );
  fixture.release = commitAll(fixture.repo, 'verify assembly');
  return { ...prepared, passed };
}

export function mergeAssembly(fixture, composed, passed) {
  const integration = unsafeApplyExactComposition(fixture.repo, {
    targetRef: fixture.plan.metadata.target_ref,
    expectedHead: fixture.target,
    candidate: passed.candidate,
    productExclusionAdmission: composed.admission,
  });
  const complete = mergedAssembly(passed.passed);
  complete.release = fixture.plan.metadata.release;
  complete.owner_ref = fixture.plan.metadata.release_ref;
  complete.authority_ref = fixture.plan.metadata.release_ref;
  complete.target_ref = fixture.plan.metadata.target_ref;
  complete.merge.expected_target = fixture.target;
  complete.merge.observed_target = fixture.target;
  complete.merge.result_commit = integration.result;
  write(
    fixture.repo,
    assemblyStatusPath(fixture.plan),
    `${JSON.stringify(complete)}\n`,
  );
  fixture.release = commitAll(fixture.repo, 'record release merge');
  return { ...passed, complete, integration };
}

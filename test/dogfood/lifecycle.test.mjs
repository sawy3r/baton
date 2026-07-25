import assert from 'node:assert/strict';
import test from 'node:test';

import { runDogfood } from './harness.mjs';

test('the composed kit dogfoods the complete three-track real-Git lifecycle', {
  timeout: 120_000,
}, async (t) => {
  const result = await runDogfood();

  assert.equal(result.schema_version, 'baton.dogfood-result/v1');
  assert.equal(result.package_version, '1.0.0-rc.3');
  assert.match(result.plan_digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(result.package_digest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(result.responsibility_invocations, {
    planner: 1,
    implementer: 13,
    captain: 5,
    verifier: 7,
    merge: 5,
  });
  assert.equal(result.observations.captain_revise, true);
  assert.equal(result.observations.verifier_fail_repair_pass, true);
  assert.deepEqual(result.observations.operational_failure, {
    transport_status: 'transport_error',
    durable_status_changed: false,
    refs_or_commit_objects_changed: false,
  });
  assert.equal(result.observations.exact_track_compositions, 3);
  assert.equal(result.observations.exact_target_compare_and_set, true);
  assert.equal(result.observations.assembly_verifier.access, 'read_only');
  assert.equal(result.observations.assembly_verifier.fresh_context, true);
  assert.equal(result.checkpoints.at(-1).release_status, 'complete');
  assert.deepEqual(result.checkpoints.at(-1).next_operations, []);

  t.diagnostic(`BATON_DOGFOOD_RESULT ${JSON.stringify(result)}`);
});

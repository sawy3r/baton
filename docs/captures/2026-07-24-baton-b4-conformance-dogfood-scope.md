# Baton B4 integrated conformance and dogfood scope

Date: 2026-07-24
Status: implemented; integrated checks pass; awaiting independent release review
Stage: B4 / RC2 R8
Integration branch: `release/v1.0.0`
Track branch: `track/v1.0.0/B4-conformance-dogfood`
Authority: [execution charter](./2026-07-24-baton-rc2-sworn-coach-parity-execution-charter.md)

## Objective

Prove that the composed RC2 kit delivers the complete lean Baton loop in a real
Git repository, that its public conformance claims are executable, and that its
fixed workflow overhead is materially below the v0.16 baseline.

This track integrates B1, B2, and B3. It does not reimplement their contract,
operations, installer, oracle, renderer, or driver logic.

## Entry gate

B4 begins only when:

- B1 contract/records, B2 operations/install, and B3 board/driver are composed;
- `VERSION` is `1.0.0-rc.2`;
- generated host packages and manifests embed that exact version;
- all B1-B3 suites pass from a clean release worktree; and
- the composed tree regenerates without a diff.

The RC2 version is frozen before the B2 and B3 consumer branches are cut. This
avoids producing intentionally stale generated package bytes.

## Owned scope

```text
conformance/
  manifest.json
  README.md
  engine-adapter.md
  requirements.txt
  baselines/v0.16.0-overhead.json
scripts/
  measure-overhead.mjs
test/
  dogfood/
  release/
docs/captures/
  2026-07-24-baton-b4-conformance-dogfood-*
```

The old RC1 conformance manifest is replaced, not amended. Historical release
notes and captures remain immutable.

## Conformance profiles

### Portable Baton kit

The portable profile runs against the published repository and proves:

- strict plan/status parsing and the sole authored schema;
- the closed lifecycle and binding transitions;
- owner-aware real-Git topology and compare-and-set behavior;
- deterministic operations and generated host adapters;
- isolated clean install, migration, rollback, and uninstall;
- oracle, terminal, WebUI security, and fake-driver behavior; and
- the reproducible overhead and board-performance budgets below.

### Autonomous engine

`conformance/engine-adapter.md` defines a small versioned stdin/stdout adapter by
which an engine runs cases through its real binary. The autonomous manifest
retains only real boundaries that a library fixture cannot prove:

- protected external approval;
- role instruction, credential, workspace, and process isolation;
- clean/read-only fresh Verifier dispatch;
- one active writer per track and independent-track concurrency;
- durable invocation, attempt, and effect identity;
- crash recovery at every effect boundary;
- timeout/cancellation cleanup and bounded retry;
- dependency scheduling and one serial worker per track;
- exact track composition and ownership transfer;
- fresh assembly verification;
- moved-target compare-and-set refusal; and
- exact release integration.

A case that has not run through the real engine is `NOT RUN`, never PASS.

## Real-Git manual dogfood

The harness creates a temporary repository and delivers one approved release:

- three tracks;
- two tracks initially independent;
- one track dependency-gated on a frozen composed track;
- at least two serial work items in one track;
- one Captain `REVISE` cycle;
- one Verifier `FAIL -> repair -> PASS` cycle;
- one fake-driver operational failure with no verdict or durable status change;
- independent tracks active concurrently, with one writer in each;
- one exact composition per track;
- fresh assembly proof and read-only Verifier PASS; and
- exact target compare-and-set Merge.

The board JSON, terminal view, and local WebUI are checked at every meaningful
gate. The test must demonstrate that the oracle selects the most advanced
authoritative state for each work item without treating a foreign or merely
newer copy as authoritative.

Raw logs remain test artefacts. The durable outcome capture records only:

- plan and package digests;
- approved, materialised, frozen, assembled, and target commit identities;
- board projection digest;
- responsibility invocation counts and wall time;
- expected failure-path observations;
- exact commands and aggregate results; and
- any deviation from this scope.

## Measurement

`scripts/measure-overhead.mjs` computes deterministic current and baseline
measurements. The checked-in v0.16 baseline records source tag/object, audited
paths and digests, fixed words, required artefacts, and minimum invocations.

RC2 gates are:

- exactly one authored JSON Schema;
- four logical handoffs per normal work item: plan, design, proof, status;
- each canonical operation at most 400 words;
- all five canonical operations at most 2,000 words;
- effective fixed Baton material loaded by one normal invocation at most 500
  words;
- happy-path fixed protocol and record load at most 20% of the measured v0.16
  baseline;
- canonical operations contain no provider or model default;
- Claude and Codex canonical regions and operation/package digests match;
- 100 work items across 20 refs project below one second median warm;
- the WebUI exposes no mutation path; and
- fresh assembly verification and exact Merge are observed facts.

Measurements report both absolute values and baseline ratios. A budget failure
is a release failure, not an invitation to hide material from the measurement.

## Release-surface checks

Tests fail on:

- stale RC1 normative terms or links outside explicitly named archives;
- current manifests that point at absent paths;
- a generated version different from `VERSION`;
- a generated tree different from checked-in bytes;
- undocumented production or development dependencies;
- broken internal documentation links;
- schema inventory or digest drift;
- installer help that differs from implemented arguments; or
- a dirty tree after any check or generator.

## Exit gate

B4/R8 exits with:

- all composed B1-B3 and B4 portable suites green;
- the complete real-Git dogfood green;
- current overhead and performance budgets green;
- a truthful autonomous manifest ready for Sworn;
- a concise committed outcome capture; and
- an exact release head from which publication and website work may branch.

No global user installation, public website deployment, tag, or GitHub release
occurs in this track.

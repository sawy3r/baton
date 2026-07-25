# Lightweight revisions and receipts

Date: 2026-07-25
Status: ratified
Authority: Brad, in the delivery conversation on 2026-07-25
Target: Baton v1.0.0-rc.4

## Decision

Baton is a lightweight protocol. It defines the responsibilities and facts
that make an autonomous delivery trustworthy. Sworn is the engine that handles
scheduling, retries, recovery, worktrees, drivers, projections, and telemetry.

The normal Baton path is:

```text
approved plan and slices
  -> Implementer design TL;DR
  -> Captain decision
  -> implementation candidate
  -> fresh-context Verifier decision
  -> merge the exact candidate that passed
```

Git already preserves immutable history. Baton must not simulate additional
immutability by abandoning a release or replacing every slice after ordinary
iteration.

## Evidence for the correction

The live Fired `systematic-flair-ui` delivery began with two slices and became
three release identities:

```text
W1/W2 -> R1/R2 -> H1/H2
```

It accumulated six work identities, eighteen durable transitions, and seven
Captain cycles before completion.

The first replacement was caused by missing internal release-index metadata.
The second followed a real hydration defect, but the original acceptance
contract already prohibited hydration errors. Both cases could have advanced
the original release through forward-only plan revisions and slice attempts.

This is the regression case for the correction.

## Minimal durable model

One authored plan contains the goal, approved scope, acceptance checks, tracks,
and stable slice identities. A revised plan advances at the same repository
path and release identity. Git retains every earlier revision.

Each responsibility boundary produces a small machine-written receipt. The
common receipt fields are:

```json
{
  "version": 1,
  "release": "release-id",
  "slice": "S1",
  "role": "captain",
  "result": "proceed",
  "binds": "exact-git-object",
  "summary": "Concise decision or outcome"
}
```

Role-specific fields may bind approval, checks, evidence, the expected target,
or the resulting merge. A receipt must stay small enough to inspect casually.
Sworn writes receipts; models return decisions and evidence rather than
constructing protocol records.

Receipts may be durable Git trailers or compact repository records. Baton
standardises their meaning, not an unnecessary file layout. The reference kit
uses one canonical representation so its board and conformance suite remain
deterministic.

The candidate diff, tests, code comments, and commit messages carry the
implementation evidence. Baton does not universally require separate
`design.md`, `proof.md`, or manually maintained `status.json` files. A project
may add a longer design or evidence document when the work genuinely needs it.

## Revision and attempt semantics

Release and slice identities remain stable.

- A procedural or runtime failure is retried by Sworn. It produces no Baton
  verdict and does not revise the plan.
- A design revision remains the same slice and appends another design attempt.
- A Verifier `FAIL` remains the same slice and appends another implementation
  attempt.
- A plan revision preserves every slice whose contract and consumed inputs are
  unchanged.
- A changed slice keeps its identity. Only that slice and the actual dependency
  closure whose inputs changed require new attempts or verification.
- A new outcome adds a slice. A removed outcome retires its slice explicitly.
- A new release identity is required only when the overall goal, target, or
  authority is replaced.

Prior plans, attempts, candidates, and decisions remain reachable in Git. The
board derives the most advanced trustworthy state; it is not another state
store.

## Trust boundary

Baton blocks only when a trust-critical fact cannot be established:

- the applicable plan is not approved;
- scope or authority is ambiguous;
- no applicable Captain decision exists;
- the candidate or its evidence is ambiguous;
- fresh verification did not pass;
- the candidate changed after verification; or
- the target changed in a way that makes exact composition unsafe.

Missing derived status, stale board output, duplicate dispatch, an interrupted
runner, a skipped procedural cursor, or a reconcilable Git effect is not a
Baton `BLOCKED` outcome. Sworn reconstructs, retries, or reports the operational
condition without manufacturing approval, `PROCEED`, `PASS`, or `MERGED`.

## Delivery slices

### S1 — Protocol and portable operations

Replace the mandatory four-artefact linear cursor with the plan, stable slice,
attempt, and compact receipt model. Keep the five responsibilities and the
fresh-context Verifier boundary. Make the public language understandable
without engine knowledge.

### S2 — Reference kit and conformance

Implement the compact receipt representation, Git-derived projection,
forward-only plan revisions, stable slice attempts, selective invalidation,
and recoverable procedural reconciliation. Regenerate platform adapters and
retain exact-candidate merge protection.

S2 consumes this decision and may proceed alongside S1 where file ownership
does not overlap. The final candidate is assembled and verified once.

## Acceptance

- A normal slice needs one plan entry, one design TL;DR, one Captain decision,
  one candidate, one fresh Verifier decision, and one exact merge outcome.
- The reference path requires no hand-authored status, proof bundle, transition
  program, or duplicated narrative attestation.
- Revising one slice in a ten-slice release retains the other nine unless their
  consumed inputs changed.
- The Fired metadata and hydration cases advance one release with stable slice
  identities.
- Runtime and bookkeeping failures recover without a new model role or human
  approval when all trust-critical facts are already present.
- Runtime events alone cannot create approval, `PROCEED`, `PASS`, or `MERGED`.
- The board is reproducible from the plan, receipts, and Git.
- Captain and Verifier decisions bind exact immutable Git objects.
- Merge lands only the exact candidate covered by the current `PASS`.
- Portable conformance, generated-adapter parity, installer isolation, board
  safety, and deterministic retry tests pass.
- The normal fixed prompt and repository artefact footprint is lower than RC3.

## Explicit exclusions

This correction does not add inference, model brokering, provider credentials,
hosted control, or another scheduler to Baton. Those remain outside the
protocol. Sworn may retain richer internal events and OTel telemetry without
turning them into mandatory Baton artefacts.

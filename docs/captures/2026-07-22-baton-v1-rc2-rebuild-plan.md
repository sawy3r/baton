# Baton v1 RC2 lean rebuild plan

Date: 2026-07-22
Status: proposed execution plan
Target release: `v1.0.0-rc.2`
Target integration branch: `release/v1.0.0`
Authority: [Baton v1 course correction](./2026-07-22-baton-v1-course-correction.md)

## Outcome

RC2 restores Baton as something a person can install and use immediately while
keeping autonomous-engine complexity in Sworn.

A user can run the complete Planner -> Implementer -> Captain -> Verifier ->
Merge workflow through portable operations, inspect it through a truthful local
board, and use any supported conversational or agentic host. Sworn can automate
the same handoffs through one common driver boundary without Baton becoming an
inference service or scheduler.

RC1 remains immutable at `v1.0.0-rc.1`. RC2 is a clean replacement, not a
compatibility layer.

## Product boundary

| Baton owns | Sworn owns |
|---|---|
| Five principles and five responsibility contracts | Scheduling and autonomous looping |
| Plan, design, proof, and status handoffs | Leases, retries, cancellation, and crash recovery |
| Five canonical operations and generated host adapters | Provider drivers and per-role runtime/model configuration |
| Record validation and workflow conformance | Process, credential, and authority isolation |
| One read-only oracle with JSON, terminal, and WebUI views | Runtime events, evals, cost, alerts, and hosted operations |
| A small, role-independent one-dispatch driver contract | Concrete Claude, Codex, OpenAI-compatible, and proprietary drivers |

The driver contract is an interoperability seam, not a second Baton execution
engine. Manual Baton users do not need a driver or Sworn.

## Standard flow

```text
baton-plan
  -> external approval
  -> baton-implement       (write or revise design, then stop)
  -> baton-design-review   (PROCEED | REVISE | ESCALATE)
       REVISE   -> baton-implement
       ESCALATE -> external decision
  -> baton-implement       (build exact candidate and proof)
  -> baton-verify          (fresh context; PASS | FAIL | BLOCKED)
       FAIL     -> baton-implement
       BLOCKED  -> baton-plan or external decision
       no result -> fresh retry or operational attention
  -> baton-merge           (deterministic exact-candidate gate)
```

The Implementer may resume its own context after Captain review. Captain is a
distinct responsibility invocation. Verifier freshness is unconditional. Merge
uses no model turn unless a real conflict or product decision requires one.

## Record model

The standard path has four logical records:

| Record | Form | Purpose |
|---|---|---|
| Plan | concise Markdown | Intent, scope, acceptance, dependencies, checks, and protected approval reference |
| Design | concise Markdown | Implementer's approach and revisions for Captain review |
| Proof | concise Markdown plus referenced raw evidence | Exact candidate, observed paths, checks, and acceptance-linked evidence |
| Status | one schema-valid JSON projection | Current stage plus Captain, Verifier, and Merge gate bindings |

Plan, design, and proof bytes are content-addressed. `status.json` references
those digests and independently observable Git facts; it does not make them true
by assertion.

The reference kit stores record history on a dedicated Git metadata ref, updated
with compare-and-set and never merged into the product candidate. This prevents
recording `PASS` from changing the candidate that passed. The protocol permits
another candidate-independent durable store, but the board and conformance
behavior remain identical.

The default Git reference is `refs/heads/baton/records`, maintained without a
working-tree checkout through compare-and-set. Rewriting its history is a
conformance failure; collaboration setups should enforce that with remote ref
protection where available. Its logical tree is:

```text
deliveries/<delivery-id>/
  plan.md
  work/<work-id>/
    design.md
    proof.md
    status.json
```

Only `plan.md` and each work item's `status.json` exist after planning. The
metadata branch is publishable for collaboration but is never merged into the
product target.

The single `work-status-v1` schema covers only:

- work identity and monotonic projection revision;
- write-once gate identities and store-CAS predecessor binding;
- authoritative source and target refs;
- active plan digest plus protected approval reference and digest;
- durable stage, disposition, next responsibility, and optional blocker;
- design digest and Captain outcome bound to that digest;
- proof digest plus exact repository, base, candidate commit, and tree identity,
  bound to the approval and Captain decision under which it was built;
- Verifier outcome bound to the candidate and proof, with a distinct fresh-run
  dispatch attestation; and
- Merge's passed candidate, expected target, outcome, and observed target.

Git or the engine event store provides history and timestamps. The status record
does not contain an event array, transcript, journal, raw log, copied diff,
attempt ledger, worker state, or separate policy catalogue.

Authority, role separation, verifier freshness, and Merge success require
external evidence in an autonomous engine. A status field alone never proves
them. Guided adapters stop for the human when their host cannot enforce the
required separation.

A Captain decision binds the exact plan and design digests and comes from a
different invocation than the design producer. A verifier dispatch attestation
binds engine-controlled instructions, fresh context, a read-only candidate, and
the absence of builder transcript and target credentials. Builder dispatch may
likewise use an opaque engine attestation. These are referenced evidence, not
additional user-authored handoffs.

## Small projection

The reference board exposes only:

```text
stage:   plan | design | implement | verify | merge
status:  ready | active | blocked | complete
role:    planner | implementer | captain | verifier | merge
outcome: none | proceed | revise | escalate | pass | fail | blocked | no_verdict | merged
```

Transient workers, queues, retries, leases, costs, and notifications remain
Sworn runtime facts. They do not expand Baton lifecycle vocabulary.

Durable status stores `ready`, `blocked`, or `complete` plus the next
responsibility. `active` and `no_verdict` are truthful board overlays from a live
runtime dispatch or operational result; they are never persisted as stale gate
claims. No verifier record means no verdict.

## Canonical operations

The only authored operation sources are:

```text
operations/baton-plan.md
operations/baton-implement.md
operations/baton-design-review.md
operations/baton-verify.md
operations/baton-merge.md
```

Every operation uses the same headings:

```text
Purpose
Inputs
Authority
Actions
Required output
Stop conditions
Next handoff
```

Each operation targets 250 words, may not exceed 400 words, and may not contain
a provider, model, home-directory, memory-product, or host-specific assumption.
The complete kit may not exceed 2,000 words. Rationale and incident history are
never injected by default.

Claude commands, Agent Skills, and OpenCode commands are generated adapters.
Each contains only platform frontmatter, an argument bridge, the canonical
operation body, its version, and its SHA-256. CI proves parity; generated
adapters are never independent workflow sources.

## Driver boundary

The common driver contract performs one role invocation:

```text
driver info
driver run < request.json > result.json
```

The request identifies the invocation, role, operation version, customer-chosen
model, workspace, record inputs, and whether the driver must establish fresh
context. The result distinguishes completion from transport, timeout,
cancellation, and runner failure. It never invents a Baton protocol verdict or
turns a request boolean into proof of freshness; autonomous verdict admission
still requires the engine's trusted dispatch attestation.

A driver is role-independent. Role configuration selects a driver and model;
there are no per-role drivers, bundled model defaults, provider fallbacks,
tiers, rotations, or nested result-interpreter calls.

Baton ships the contract, fake-driver fixtures, and conformance cases. Concrete
provider drivers live in Sworn, where their process and credential boundaries
can be enforced and evaluated.

## Target source tree

```text
baton/
  CORE.md
  PROTOCOL.md
  ASSURANCE.md
  CONFORMANCE.md
  RATIONALE.md
operations/
  baton-plan.md
  baton-implement.md
  baton-design-review.md
  baton-verify.md
  baton-merge.md
templates/
  plan.md
  design.md
  proof.md
schemas/
  work-status-v1.json
reference/
  records/
  board/
    oracle.mjs
    terminal.mjs
    web.mjs
  driver/
    contract.md
    fake-driver.mjs
adapters/
  generated/
conformance/
  fixtures/
  check.py
```

Platform installers render adapters from `operations/`; they do not introduce a
second role-prompt directory. `reference/records` owns metadata-ref reads,
content digests, validation, and compare-and-set transitions shared by the
operations and board.

## Read-only board

The reference oracle:

1. resolves the configured plan or metadata ref;
2. discovers work status records;
3. follows each record's authoritative source ref;
4. validates its record and bound Git objects;
5. selects ownership over recency; and
6. emits one deterministic `baton.board/v1` JSON projection.

Terminal and WebUI renderers consume that exact projection. They do not derive
state independently.

The WebUI is a single dependency-free Node.js file, bound to loopback, GET-only,
escaped, protected by a restrictive content-security policy, and refreshed by
polling. It has no POST routes, subprocess execution, actions, workers, event
stream, model data, cost data, or hidden mutable state.

Malformed or conflicting authoritative records fail visibly. The oracle does
not heal them, fall back silently to a working tree, or choose a newer foreign
branch over the owning ref.

## Active-tree disposition

| Current RC1 surface | RC2 action |
|---|---|
| `baton/CORE.md` | Rewrite in ordinary language while preserving B1-B5 |
| `baton/PROTOCOL.md` | Rewrite around five responsibilities and four records |
| `baton/ASSURANCE.md` | Reduce to optional heightened policy; no registry or pack catalogue |
| `baton/CONFORMANCE.md` | Split portable workflow and autonomous-engine profiles |
| `baton/RATIONALE.md` | Rewrite around the ratified archaeology and boundary |
| `README.md`, `baton/README.md`, `ROADMAP.md` | Rewrite for the usable protocol and Sworn seam |
| Six RC1 schemas | Remove; replace with `work-status-v1.json` |
| RC1 plan/submission/verdict/board examples | Remove; replace with one coherent four-record walkthrough |
| `conformance/check.py` and manifest | Rewrite from scratch around scenario behavior |
| Seven strict raw-JSON fixtures | Retain for fail-closed status parsing |
| RC1 release notes and historical captures | Keep as immutable archaeology |

There is no in-tree RC1 compatibility copy. The tag is the archive.

## Conformance focus

Portable workflow scenarios cover:

- protected approval bound to exact plan bytes and dependency routing;
- Captain outcome bound to the current plan and design from a distinct
  invocation;
- independently derived candidate identity and proof binding;
- attested clean-context verification and no verdict on runner failure;
- `FAIL` repair and `BLOCKED` replan routing;
- invalidation after candidate, proof, design, plan, or target change;
- Merge refusing a changed candidate or moved target;
- stale metadata writers, reused gate identities, and product-tree record writes
  failing closed;
- ownership-over-recency and malformed-record failure; and
- JSON, terminal, and WebUI projection parity and read-only behavior.

Autonomous-engine scenarios additionally cover protected authority, builder and
Verifier containment, write-once identity, persistence failure, resource bounds,
durable-effect recovery, and compare-and-set Merge. Sworn must run these through
its real binary and storage/process boundaries.

RFC 8785 rebinding, assurance-registry semantics, control-receipt catalogues,
and the 99-case RC1 cross-record mutation matrix are removed unless a surviving
real boundary demonstrates that exact mechanism is still needed.

## Delivery slices

```text
R1 contract and vocabulary
  -> R2 records, metadata channel, schema, and validator
       -> R3 canonical operations and templates
            -> R4 generated adapters and installer
       -> R5 oracle JSON and terminal renderer
            -> R6 read-only single-file WebUI
       -> R7 one-dispatch driver contract and fake driver
R3 + R4 + R5 + R6 + R7
  -> R8 integrated conformance, dogfood, and measurement
       -> R9 public docs and RC2 cut
```

### R1 — Contract and vocabulary

Rewrite Core and Protocol first. Freeze role authority, transitions, outcomes,
record meanings, guided versus autonomous conformance, and the Baton/Sworn seam.

### R2 — Records and validation

Implement the candidate-independent metadata channel, `work-status-v1`, semantic
transition validator, raw-digest helpers, and minimal fixtures. Prove stale
design, candidate, proof, verifier, and target bindings fail closed.

### R3 — Operations and templates

Write the three Markdown templates and five canonical operations. Run the flow
manually before generating any adapter.

### R4 — Adapters and installation

Generate Claude, Agent Skills, and OpenCode surfaces from canonical operations.
Support project and user installation without copying workflow logic.

### R5 — Oracle and terminal board

Implement the branch-aware oracle, stable JSON interface, and terminal renderer.
Test ownership, dependencies, malformed records, and deterministic regeneration.

### R6 — WebUI

Add the GET-only single-file WebUI over oracle JSON. Test escaping, CSP,
loopback binding, refresh behavior, and the absence of mutation routes.

### R7 — Driver contract

Publish and test the role-independent one-dispatch contract with a fake driver.
Do not add provider code to Baton.

### R8 — Conformance and dogfood

Run a complete manual Baton delivery without Sworn. Replace the RC1 checker and
manifest with the retained portable scenarios and publish the autonomous-engine
cases for the later Sworn rebuild. Exercise generated adapters and the fake
driver, and record the budgets below against the measured Baton 0.16 baseline.

### R9 — Public contract and release

Rewrite public, contributor, roadmap, release, and website documentation from
the dogfooded behavior. Cut RC2 and only then allow Sworn to pin it.

## Release gates and budgets

RC2 is not ready until:

- one authored JSON schema is sufficient;
- a normal work item uses no more than four record files;
- each operation is at most 400 words and all five total at most 2,000;
- effective fixed Baton material loaded by one invocation is at most 500 words;
- generated adapters match the canonical operation version and digest;
- canonical operations contain no provider or default-model choice;
- the reference runtime has no package dependency beyond Node.js built-ins and
  Git;
- the board loads 100 work items across 20 refs in under one second on the
  published fixture;
- every renderer consumes the same oracle JSON and the WebUI cannot mutate;
- manual dogfood completes without Sworn;
- verifier freshness and exact-candidate Merge are demonstrated, not asserted;
- the happy-path fixed protocol and record-reading token load is at most 20% of
  the measured Baton 0.16 baseline; and
- every retained autonomous-engine case is published with an executable adapter
  contract; passing them gates final `v1.0.0`, not the RC2 protocol candidate.

Source-line ceilings are not protocol goals. The implementation should remain
small enough to audit, but clarity, fail-closed behavior, and tests outrank
minified code.

## Publish sequence

1. Land the ratified decision and this execution plan.
2. Create `release/v1.0.0` from current `main`.
3. Deliver R1-R9 as independently reviewed changes into that release branch.
4. Dogfood the manual kit and record measured overhead and trust results.
5. Publish `v1.0.0-rc.2` and update Baton documentation and website.
6. Replan Sworn and pin the immutable RC2 tag.
7. Implement the autonomous loop, common provider drivers, board integration,
   evaluation, and hosted control plane in Sworn.
8. Require Sworn to pass the autonomous-engine cases before Baton final
   `v1.0.0` and the corresponding Sworn release are declared ready.

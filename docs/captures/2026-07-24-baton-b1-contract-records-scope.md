# Baton B1 contract and records scope

Date: 2026-07-24
Status: active
Stage: B1 / RC2 R1-R2
Integration branch: `release/v1.0.0`
Integration baseline: `ca532e63a9a4d3448f0deda8edb73b70c1d142fb`
Track branch: `track/v1.0.0/B1-contract-records`
Authority: [execution charter](./2026-07-24-baton-rc2-sworn-coach-parity-execution-charter.md)

## Objective

Replace RC1's builder/submission/verdict model with the complete lean Baton RC2
contract:

- five trust principles;
- five responsibility boundaries;
- release-worktree and owning-track topology;
- concise Markdown plan, design, and proof handoffs;
- one `work-status-v1` durable projection;
- strict semantic transition validation; and
- real Git identity, product-tree, ownership, and compare-and-set checks.

B1 ends with one frozen contract that B2 operations/installers and B3
oracle/board/driver consumers can implement independently.

## Why this stage is serial

The public vocabulary, transition table, schema, semantic validator, and Git
ownership rules are one shared contract. Splitting them across parallel writers
before the vocabulary freezes would create the exact prose/schema drift this
rebuild is intended to remove.

B1 therefore uses one track worktree and one active writer. The Coach
archaeology and Sworn gap analysis continue in parallel as read-only work, but
B2 and B3 consumer implementation do not begin until B1 is composed into the
release worktree.

## Included scope

### Public protocol

- rewrite `baton/CORE.md` in ordinary language while retaining B1-B5 technical
  identifiers;
- rewrite `baton/PROTOCOL.md` around Planner, Implementer, Captain, Verifier,
  and Merge;
- reduce `baton/ASSURANCE.md` to optional heightened policy without a universal
  pack catalogue;
- split `baton/CONFORMANCE.md` into guided/manual and autonomous-engine
  obligations;
- rewrite `baton/RATIONALE.md` around the ratified course correction and
  archaeological evidence; and
- keep the Baton/Sworn ownership seam explicit.

### Plan metadata

`plan.md` begins at byte zero with one fenced `baton-plan-v1` block containing
strict JSON. Human-readable Markdown follows it.

````text
```baton-plan-v1
{ ... strict JSON metadata ... }
```

# Human-readable release plan
...
````

The parser:

- accepts UTF-8 only;
- requires the exact opening and closing fence;
- rejects content before the metadata block;
- applies strict JSON rules including duplicate-name, Unicode, finite-number,
  and interoperable-integer checks;
- rejects unknown metadata fields;
- treats the raw SHA-256 of the complete `plan.md` bytes as plan identity; and
- does not implement YAML or a second plan format.

The metadata defines:

- release identity, repository, target ref, and release-worktree ref;
- protected external approval reference;
- ordered tracks, track refs, track dependencies, and declared touch surfaces;
- ordered work membership in each track;
- work outcome, scope, acceptance criteria, required checks, constraints, and
  dependencies; and
- the configured canonical record root.

The approval reference is part of the immutable proposed plan. External
approval evidence binds the raw plan digest and is then referenced by each
initial status; approval does not require editing the approved plan bytes.

### Record root and forms

The default canonical root is:

```text
.baton/releases/<release>/
  plan.md
  work/<work-id>/
    design.md
    proof.md
    status.json
  assembly/
    proof.md
    status.json
```

One repository-local configuration may override `.baton/releases`, but the
resolved root must be one canonical repository-relative path. Absolute,
escaping, ambiguous, or symlinked roots fail closed.

Only `plan.md` and initial work `status.json` records exist immediately after
external approval. Design and proof are created only by their owning
responsibilities.

Plan, design, and proof identities are raw `sha256:<lowercase-hex>` digests of
their exact bytes.

### Durable status

`schemas/work-status-v1.json` is the sole authored JSON Schema. It covers work
and assembly with a closed shape containing:

- schema version and `work | assembly` kind;
- release and optional work/track identity;
- owning and currently authoritative refs plus target ref;
- active plan digest and exact external approval reference/digest;
- durable `stage`, `status`, `next_role`, and optional blocker;
- design digest, producer invocation, and Captain gate;
- proof digest, exact repository/base/candidate/product-tree identity, and the
  authority and design decision under which it was produced;
- Verifier outcome and distinct clean dispatch attestation bound to candidate
  and proof; and
- track or release Merge binding, expected target, outcome, and observed Git
  result.

Durable projection enums are exactly:

```text
stage:      plan | design | implement | verify | merge
status:     ready | blocked | complete
next_role:  planner | implementer | captain | verifier | merge | none
outcome:    none | proceed | revise | escalate | pass | fail | blocked | merged
```

`active` and `no_verdict` are runtime/board overlays and are invalid in durable
status.

Git history supplies revision history and time. Status does not contain an event
array, transcript, activity log, retry ledger, worker state, cost, or copied
diff.

## Closed transition table

| Current durable projection | Responsibility result | Next durable projection |
| --- | --- | --- |
| `design / ready / implementer` | design written | `design / ready / captain` |
| `design / ready / captain` | `PROCEED` | `implement / ready / implementer` |
| `design / ready / captain` | `REVISE` | `design / ready / implementer` |
| `design / ready / captain` | `ESCALATE` | `design / blocked / planner` |
| `implement / ready / implementer` | candidate and proof written | `verify / ready / verifier` |
| `verify / ready / verifier` | `PASS` | `merge / ready / merge` |
| `verify / ready / verifier` | `FAIL` | `implement / ready / implementer` |
| `verify / ready / verifier` | `BLOCKED` | `verify / blocked / planner` |
| `verify / ready / verifier` | runner/transport failure | unchanged; runtime `no_verdict` |
| `merge / ready / merge` | exact track composition | `merge / complete / none` |

Assembly uses the same schema with `kind: assembly`, no track owner, and begins
at `verify / ready / verifier` after exact track composition and assembly proof
capture. Assembly `PASS` advances to release Merge; exact release integration
advances to `merge / complete / none`.

A new authorized plan revision creates explicitly rebound statuses; it cannot
rewrite terminal history or reuse stale Captain, proof, Verifier, or Merge
bindings.

## Responsibility invariants

- The Planner proposes scope but does not approve it.
- The Implementer may not produce a candidate before a current Captain
  `PROCEED`.
- Captain invocation identity differs from the design producer and binds the
  exact plan and design digests.
- Verifier invocation identity differs from the Implementer and Captain, binds
  exact candidate/proof bytes, and includes a trusted clean/read-only dispatch
  attestation.
- A runner failure produces no Baton verdict.
- `FAIL` returns to implementation; `BLOCKED` requires changed contract,
  authority, or external decision.
- Merge has no discretionary model outcome. It either proves exact eligibility
  and composes/integrates, or stops without claiming success.

## Git and ownership invariants

- `release-wt/<release>` owns the approved plan and baseline statuses.
- `track/<release>/<track-id>` owns its assigned work after materialisation.
- Only the next incomplete work in an owning track may advance.
- A dependency track is created from a release head that already contains its
  required frozen track heads.
- Ownership cannot be reassigned after materialisation; replan creates a new
  work identity when ownership changes.
- A track status may be selected from `release-wt` again only after the exact
  frozen track head is an ancestor of the release head and the release record
  contains the matching authority-transfer binding.
- A foreign or stale sibling copy never wins.
- Missing or malformed authoritative owner state is an error.

Every transition names the exact previously observed ref head. The reference
helper constructs the next record-only commit and updates the ref with
`git update-ref <ref> <new> <expected>`. A changed expected head leaves the ref
untouched and returns a typed stale-writer failure.

### Product-tree identity

Implementation records:

- exact base and candidate commits;
- the normal Git candidate tree; and
- a deterministic product-tree digest over ordered path, mode, type, and object
  identity outside the configured record root.

Later record-only commits may preserve product-tree identity. Any product-path
change invalidates the proof and verdict.

The record-root exception applies only when the root is behaviorally inert. If
build, test, package, deploy, hook, or runtime behavior consumes it, the
repository cannot claim the exception and validation fails closed. B1 tests
include an explicit consumed-record-root fixture.

Product-tree equality never replaces expected-target and ancestry checks.

## Owned touchpoints

```text
baton/CORE.md
baton/PROTOCOL.md
baton/ASSURANCE.md
baton/CONFORMANCE.md
baton/RATIONALE.md
schemas/
reference/records/
conformance/check.py
conformance/fixtures/
test/records/
docs/captures/2026-07-24-baton-b1-contract-records-*
```

Historical release notes and captures remain immutable. README, operations,
templates, installers, board renderers, driver contract, and website are later
stage touchpoints.

## Required implementation shape

```text
schemas/work-status-v1.json
reference/records/
  records.mjs
  git.mjs
  transition.mjs
test/records/
  schema.test.mjs
  transition.test.mjs
  git-topology.test.mjs
  product-tree.test.mjs
```

Node reference code uses built-in modules and Git only. The portable conformance
checker may continue using Python and `jsonschema`; the published reference
runtime gains no package dependency.

## Acceptance criteria

### Contract

- Public docs define exactly five principles and five responsibilities.
- The public flow includes track composition, fresh assembly verification, and
  exact release Merge.
- Guided/manual and autonomous-engine assurance are distinguished.
- RC1 builder-only, submission/verdict, `SPEC_BLOCK`, `INCONCLUSIVE`, assurance
  registry, and control-receipt catalogue concepts are no longer normative.

### Strict parsing and schema

- The seven retained raw strict-JSON fixtures still pass.
- Unknown fields, trailing values, malformed digests, invalid refs, escaping
  paths, and invalid/symlinked record roots fail.
- Exactly one active JSON Schema remains.
- Every schema-valid record also passes required semantic validation.

### Transitions and bindings

- Every positive transition in the closed table passes for work and assembly.
- Captain revision cycles and implementation repair cycles remain bounded by
  the plan/engine rather than new status fields.
- Stale plan, approval, design, Captain, proof, candidate, product tree,
  Verifier, assembly, and target bindings fail.
- Captain or Verifier self-review identities fail.
- False/missing fresh-dispatch evidence fails autonomous admission.
- A durable `no_verdict` fails schema/semantic validation.
- Terminal identities and outcomes are write-once.

### Real Git topology

Temporary real repositories prove:

- three authored tracks with serial slices;
- independent and dependency-gated materialisation;
- foreign stale copies never selected;
- missing/malformed owning state fails;
- exactly one of two same-head CAS writers succeeds;
- record-only commits preserve product identity;
- product changes invalidate downstream gates;
- frozen track composition is exact and idempotent;
- conflict blocks without partial authority transfer;
- assembly covers all composed track heads; and
- moved target or unexpected topology prevents release Merge.

## Verification commands

```sh
node --test test/records/*.test.mjs
python3 conformance/check.py
git diff --check
```

Tests must run from a clean track worktree and again after composition into the
release worktree.

## Explicit non-goals

- canonical operations or templates;
- generated platform adapters or installers;
- oracle, terminal, or WebUI implementation;
- concrete provider drivers;
- Sworn scheduling, leases, events, or retries;
- RC1 compatibility;
- YAML parsing;
- RFC 8785 canonicalization without a demonstrated surviving requirement;
- a second lifecycle record; or
- recovery heuristics for malformed state.

## Handoff

B1 produces:

- one exact contract commit;
- a B1 outcome capture with tests and measured schema/word counts; and
- a frozen transition/record API from which B2 and B3 track worktrees branch.

Any material contract change after that point requires B2/B3 consumers to rebase
and rerun their complete gates.

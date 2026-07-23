# Baton Protocol 1.0

This document defines the smallest complete workflow implementing
[Baton Core](CORE.md). Baton specifies responsibility boundaries and durable
handoffs. It does not select a provider, model, agent host, scheduler, or
project-management method.

## 1. Responsibilities

Roles are authority boundaries, not personas. A human, conversational agent,
subagent, CLI agent, or autonomous engine may perform one when it honours the
same contract.

### Planner

The Planner turns intent into a bounded release plan. It defines outcomes,
scope, acceptance criteria, checks, constraints, ordered work, tracks,
dependencies, touch surfaces, repository, and target. It may replan blocked
work. It does not approve its own plan, implement it, or certify delivery.

### Implementer

The Implementer first writes a concise design and stops. After a current Captain
decision permits it to proceed, the Implementer builds one candidate and writes
acceptance-linked proof. It does not review its own design or issue a delivery
verdict.

The same Implementer context may resume after Captain review. Its candidate
MUST remain inside the approved work and its owning track.

### Captain

The Captain is a distinct invocation that reviews the proposed design during
implementation. It binds the exact plan and design and returns one outcome:

- `PROCEED` — the design is suitable for implementation;
- `REVISE` — the Implementer must revise the design; or
- `ESCALATE` — an external decision or newly approved plan is required.

The Captain does not become another Planner, Implementer, or Verifier.

### Verifier

The Verifier receives the approved plan, current Captain-reviewed design, exact
candidate, and proof in a clean context. It inherits no implementation
conversation, cannot alter the candidate, and returns one outcome:

- `PASS` — the exact candidate satisfies the approved contract;
- `FAIL` — the contract is adequate but implementation or evidence is wrong;
- `BLOCKED` — safe progress requires a changed contract, authority, or external
  product decision.

A transport, runner, tool, or environment failure produces no verdict. A fresh
retry may review the unchanged candidate.

### Merge

Merge proves eligibility and composes or integrates the exact passed candidate.
It has no discretionary model verdict. It either performs the authorized,
expected-target Git operation and records the observed result, or stops.

Merge operates at two levels: one eligible frozen track head is composed into
the release worktree, and a passed assembly candidate is integrated into the
release target.

The external authorizer remains outside these five responsibilities. It owns
approval, consequential product judgement, and any standing authority granted
to autonomous execution.

## 2. Release topology

A release has one assembly lineage and one or more ordered tracks:

```text
target
  <- release-wt/<release>
       <- track/<release>/<track-id>
```

- `release-wt/<release>` owns the approved plan, baseline statuses, composed
  track heads, assembly proof, and release Merge record.
- `track/<release>/<track-id>` owns the ordered work assigned to that track
  after materialisation.
- Work advances one item at a time in a track.
- A work at `merge / ready / merge` has passed for track sequencing, so the next
  ordered work may begin. It does not claim that the track has been composed.
- Independent, dependency-ready tracks may advance concurrently.
- A dependent track starts from a release head that already contains every
  required frozen track head.
- Parallel tracks have disjoint declared touch surfaces. An unexpected
  conflict stops for repair or replan.

Only one writer may advance an owning track at a time. Every durable transition
names the exact ref head it observed. The reference helper creates a
record-only commit and updates the ref with compare-and-set; a stale writer
leaves the ref untouched.

Ownership does not move because another branch has a newer timestamp. Before a
track materialises, its release baseline is authoritative. While it is active,
its owning ref is authoritative and a missing or malformed owner record is an
error. Authority returns to `release-wt` only after Git proves that the exact
frozen track head was composed and the matching Merge binding was recorded.

Reassigning materialised work creates a new work identity under a newly
approved plan. It does not rewrite the old lineage.

## 3. Durable handoffs

The standard release root is:

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

One repository-local configuration may replace `.baton/releases`. The resolved
root MUST be one canonical repository-relative path. Absolute, escaping,
ambiguous, or symlinked roots fail closed.

Plan, design, and proof identities are
`sha256:<64 lowercase hexadecimal characters>` over their exact raw bytes.

### Plan

`plan.md` starts at byte zero with one strict JSON metadata block:

````text
```baton-plan-v1
{"schema_version":"baton.plan/v1", "...":"..."}
```

# Human-readable release plan
````

No content may precede the opening fence. The metadata has a closed shape and
defines:

- release, repository, target and release-worktree refs;
- canonical record root and protected external approval reference;
- ordered tracks, exact track refs, dependencies, and touch surfaces; and
- each ordered work item's outcome, path scope, acceptance criteria, checks,
  constraints, and dependencies.

The complete file's raw digest is the plan identity. Approval evidence binds
that digest; approval never edits the plan it approves.

### Design

`design.md` is the Implementer's concise proposed approach. Its raw digest and
producer invocation are recorded before Captain review. A revision has new
bytes and therefore a new digest. A Captain decision over an earlier digest
cannot authorize the revision.

### Proof

`proof.md` names the delivered outcome and links each acceptance criterion to
observable evidence. Its status binding records the exact repository, base,
candidate commit, normal Git tree, product-tree digest, required checks, and
Implementer invocation.

Assembly proof additionally names every composed track and frozen head. Per-work
verification is not authority to ship an unverified composition.

### Status

`status.json`, validated by `work-status-v1`, is the sole machine-authoritative
current projection. It binds the plan and approval, current responsibility,
design and Captain decision, candidate and proof, Verifier result, and Merge
result.

Its durable vocabulary is exactly:

```text
stage:      plan | design | implement | verify | merge
status:     ready | blocked | complete
next_role:  planner | implementer | captain | verifier | merge | none
outcome:    none | proceed | revise | escalate | pass | fail | blocked | merged
```

`active` and `no_verdict` are optional runtime board overlays. Persisting either
as status is invalid.

Git provides history and timestamps. Status contains no transcript, event
array, activity log, retry ledger, worker, lease, token, or cost state.

## 4. Standard transitions

After external approval, each initial work status is
`design / ready / implementer`.

| Current | Responsibility result | Next |
| --- | --- | --- |
| `design / ready / implementer` | design written | `design / ready / captain` |
| `design / ready / captain` | `PROCEED` | `implement / ready / implementer` |
| `design / ready / captain` | `REVISE` | `design / ready / implementer` |
| `design / ready / captain` | `ESCALATE` | `design / blocked / planner` |
| `implement / ready / implementer` | candidate and proof written | `verify / ready / verifier` |
| `verify / ready / verifier` | `PASS` | `merge / ready / merge` |
| `verify / ready / verifier` | `FAIL` | `implement / ready / implementer` |
| `verify / ready / verifier` | `BLOCKED` | `verify / blocked / planner` |
| `verify / ready / verifier` | runner failure | unchanged; no verdict |
| `merge / ready / merge` | exact composition or integration | `merge / complete / none` |

A work `PASS` leaves its status at `merge / ready / merge` on the owning track.
When every ordered work item is there, the exact final track head is frozen and
composed once. One following record-only commit transfers every work status to
`merge / complete / none` together. Partial transfer is invalid.

A materialised track may perform one projection-preserving authority transfer
from its release baseline to its exact owner ref. An authorized replan may
rebind a non-terminal work identity to a new plan and approval, clearing every
downstream gate. Neither operation invents lifecycle progress.

Assembly uses the same status shape with `kind: assembly`, no work or track
identity, and the release-worktree as owner. Exact composition and assembly
proof create `verify / ready / verifier`; `PASS` permits release Merge.

## 5. Binding rules

- Captain invocation differs from the design producer and binds the current
  plan and design digests.
- Implementation requires a current `PROCEED`.
- Proof binds the current plan, approval, design, Captain invocation, repository,
  base, candidate, candidate tree, and product tree.
- Verifier invocation differs from the design producer, proof producer, and
  Captain. Its trusted dispatch evidence attests clean context and read-only
  candidate access.
- Verification binds the current proof, candidate, and product tree.
- Each Work Merge binds its own passed candidate plus the shared frozen track
  head, expected and observed release-worktree head, composition result, and
  authority-transfer commit. Every work candidate is an ancestor of the frozen
  head; the frozen product tree equals the final work's passed product tree.
- Release Merge binds the passed assembly candidate, expected target head, and
  observed integration.

Any stale or mismatched binding fails. A runner result boolean or status field
alone never proves separation, evidence, Git history, or effect success.

## 6. Product identity and composition

Candidate proof records the ordinary Git tree and a deterministic SHA-256 over
the ordered path, mode, type, and object identity outside the configured Baton
record root. Later record-only commits may preserve that product identity.

The exclusion is valid only while the record root is behaviorally inert. If a
build, test, package, deploy, hook, or runtime consumes it, the exclusion cannot
be claimed and validation stops.

Product-tree equality is necessary for record-only advancement but never
replaces ancestry or expected-target checks. Track composition is either an
exact fast-forward to the eligible frozen track head or a two-parent commit
whose ordered parents and tree equal Git's deterministic merge of the expected
release head and that track head. Release integration applies the same rule to
the expected target and passed assembly candidate.

After all tracks are composed, a fresh Verifier checks the complete approved
plan over the assembled product. Only that assembly `PASS` permits release
Merge.

## 7. Guided and autonomous use

A guided host may rely on a human to approve the plan, start distinct Captain
and Verifier invocations, and preserve read-only verification. It MUST stop
when it cannot establish a required boundary.

An autonomous engine additionally proves protected approval, process and
credential isolation, one active writer per track, durable dispatch identity,
resource bounds, effect recovery, and compare-and-set updates. These are engine
mechanisms and executable conformance cases, not prose every model must load.

Sworn is the reference autonomous engine. Baton remains usable without Sworn
through its portable operations and reference record tools.

# RC2 walkthrough: one release, two tracks

This platform-agnostic example follows a small `checkout-recovery` release from
an approved Plan to exact release Merge. It uses the RC2 handoffs and status
shape, without assuming Claude Code, Codex, Sworn, or any other engine.

```text
approved Plan
  ├─ T1 / W1: retry-safe checkout ─┐
  └─ T2 / W2: recovery runbook ───┤
                                  └─ assembly -> fresh Verifier -> Merge
```

The two tracks have separate touch surfaces and no dependency edge, so they may
advance together. Each track has one work item here; if it had more, its work
would remain serial.

## What the files show

```text
walkthrough/
├── approval.txt
├── plan.md
├── tracks/
│   ├── T1/W1/
│   │   ├── design.md
│   │   ├── proof.md
│   │   └── status.json
│   └── T2/W2/
│       ├── design.md
│       ├── proof.md
│       └── status.json
└── assembly/
    ├── proof.md
    └── status.json
```

The Plan, designs, and proofs are exact illustrative handoff bytes. Their
SHA-256 digests in both status files match the checked-in files. Object IDs,
product-tree digests, dispatch attestations, and the protected approval
reference illustrate identities that a real repository and engine would
produce; this documentation directory does not pretend to contain those Git or
trust-root objects.

Executable schema fixtures remain in
[`../conformance/fixtures/`](../conformance/fixtures/). The real-Git
three-track lifecycle is exercised by
[`../test/dogfood/`](../test/dogfood/).

## 1. Planner proposes; an external authority approves

The Planner writes [`plan.md`](walkthrough/plan.md). Its closed metadata fixes
the repository, target, release ref, two track refs, scope, acceptance, and
checks. Planning does not grant approval.

The external decision in
[`approval.txt`](walkthrough/approval.txt) stands in for protected approval
evidence that binds the Plan’s exact bytes. `baton-plan` admits those bytes and
creates baseline work statuses.

## 2. Implementer designs; Captain decides

For each dependency-ready item, an Implementer writes `design.md`:

- [`T1/W1/design.md`](walkthrough/tracks/T1/W1/design.md)
- [`T2/W2/design.md`](walkthrough/tracks/T2/W2/design.md)

A distinct Captain checks the exact Plan and design digests. `PROCEED` returns
each item to its Implementer. `REVISE` would require new design bytes;
`ESCALATE` would stop for new planning authority.

## 3. Implementer builds and proves; a fresh Verifier checks

Each Implementer makes a product-only candidate commit, runs the approved
checks, and writes an exact proof:

- [`T1/W1/proof.md`](walkthrough/tracks/T1/W1/proof.md)
- [`T2/W2/proof.md`](walkthrough/tracks/T2/W2/proof.md)

A fresh, read-only Verifier checks the candidate and evidence. The completed
[`T1/W1/status.json`](walkthrough/tracks/T1/W1/status.json) and
[`T2/W2/status.json`](walkthrough/tracks/T2/W2/status.json) show PASS bound to
the Plan, proof, candidate, and product tree.

These are the only JSON lifecycle records in the walkthrough. Both use
`baton.work-status/v1`.

## 4. Merge composes exact tracks

Track Merge freezes each passed owner ref and composes it without discretionary
conflict resolution. The completed work statuses record the exact frozen head,
expected release-line head, and deterministic composition result.

Composition transfers authority to the release lineage. It does not yet update
`main`, and a work PASS never substitutes for whole-product verification.

## 5. Merge prepares assembly; a fresh Verifier checks again

After both tracks are composed, Merge writes
[`assembly/proof.md`](walkthrough/assembly/proof.md). It names both frozen
component heads and the exact assembled candidate.

Another fresh, read-only Verifier checks every component and the product as a
whole. [`assembly/status.json`](walkthrough/assembly/status.json) binds the
assembly PASS to those exact bytes.

## 6. Release Merge updates the expected target

Release Merge compares `refs/heads/main` with the approved expected commit. It
updates the ref only to the passed assembly candidate. If the target moved or
any Plan, proof, candidate, product-tree, component, or attestation binding
changed, it stops.

The final assembly status records that exact integration. Deployment is outside
Baton; “merged” does not silently mean “deployed.”

## Where the board fits

The JSON oracle would derive `baton.board/v1` from the real refs and records at
each stage, showing the next eligible operation. No board snapshot is stored
here because it is a view, not a fifth handoff or another source of authority.

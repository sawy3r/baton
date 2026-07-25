# Lightweight walkthrough: one release, two tracks

This platform-neutral example follows the `checkout-recovery` release from one
approved plan to an exact merge. It uses stable slice identities and compact
machine-written receipts without assuming a particular engine.

```text
approved plan
  ├─ T1 / S1: retry-safe checkout ─┐
  └─ T2 / S2: recovery runbook ───┤
                                  └─ assembly -> fresh Verifier -> exact merge
```

The checked-in files are deliberately small:

```text
walkthrough/
├── approval.txt
├── plan.md
└── receipts/
    ├── 01-plan-approved.txt
    ├── 02-S1-designed.txt
    ├── 03-S1-proceed.txt
    ├── 04-S1-candidate.txt
    ├── 05-S1-pass.txt
    ├── 06-S2-designed.txt
    ├── 07-S2-proceed.txt
    ├── 08-S2-candidate.txt
    ├── 09-S2-pass.txt
    ├── 10-assembly-candidate.txt
    ├── 11-assembly-pass.txt
    └── 12-merged.txt
```

Every receipt file is an exact illustrative Git commit message. The detail
section carries the short role output; the final `Baton-Receipt:` trailer is
canonical one-line JSON and hashes those exact detail bytes. Sworn writes this
record after checking the role output and Git bindings.

The `plan` field in every receipt is the actual Git blob object of
[`plan.md`](walkthrough/plan.md), and each slice `contract` is the digest
derived from that plan. The remaining object IDs and evidence digests are
stable illustrative values because this documentation directory is not a
standalone Git delivery history.

## The normal path

The external decision in
[`approval.txt`](walkthrough/approval.txt) authorises the exact plan object.
`01-plan-approved.txt` records that protected decision without turning planning
into approval.

For each ready slice, the Implementer returns a design TL;DR, the Captain binds
its decision to that immutable object, and the Implementer later records the
candidate plus normalized checks. A fresh-context Verifier binds PASS to the
same candidate, product tree, inputs, and checks:

```text
designed -> proceed -> candidate -> pass
```

The candidate diff, tests, code comments, and ordinary commit history carry the
implementation evidence. There is no hand-authored `design.md`, `proof.md`, or
`status.json`.

Once both independent tracks pass, Merge prepares one deterministic assembly
candidate. A fresh Verifier checks the exact track input pins, then the final
merge receipt records the target compare-and-set result. If an input, target,
or candidate changes, the assembly PASS is stale and cannot authorise merge.

## Revisions and derived state

The plan stays at one release path. Revision 1 uses `previous_plan: null`; a
later revision increments `revision` and points `previous_plan` at the prior
plan blob. Stable slice IDs remain. An unchanged slice contract and unchanged
consumed product-tree pins retain PASS, so changing one independent slice does
not restart the other.

No board snapshot is stored. The reference oracle rescans the current plan,
first-parent receipt commits, and Git objects to derive the most advanced
trustworthy state. A missing cached view or interrupted runner therefore cannot
manufacture approval, `proceed`, `pass`, or `merged`.

Executable plan and receipt fixtures live in
[`../conformance/fixtures/`](../conformance/fixtures/).

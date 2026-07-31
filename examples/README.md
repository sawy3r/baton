# Lightweight walkthrough: one release, two tracks

This example shows the whole Baton relay without tying it to a particular AI
tool or engine. A person approves two pieces of work, each piece is designed,
reviewed, built, and independently checked, and only the checked result is
merged.

```text
approved plan
  ├─ T1 / S1: retry-safe checkout ─┐
  └─ T2 / S2: recovery runbook ────┤
                                   └─ combine -> fresh check -> merge
```

Open the files in number order to follow the handoffs:

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

Each receipt is a small example Git commit message. Its readable section says
what happened. The final `Baton-Receipt:` line is the machine-readable record
that connects that result to the exact plan and work.

Sworn normally writes these receipts after checking the agent's response and
Git. Projects do not hand-author them.

## The normal path

[`approval.txt`](walkthrough/approval.txt) shows the person approving the exact
plan. `01-plan-approved.txt` records that approval; the Planner does not approve
its own work.

For each ready slice, the Implementer explains the approach, the Captain checks
it, the Implementer builds it, and a fresh Verifier checks the result:

```text
designed -> proceed -> candidate -> pass
```

The diff, tests, code comments, and normal commit history carry the detail.
There is no required `design.md`, `proof.md`, or `status.json`.

Once both tracks pass, Merge combines them in the same repeatable way. A fresh
Verifier checks the complete result. If an input, target, or candidate changes,
the earlier `PASS` no longer covers it.

## When the plan changes

The plan keeps one release path and stable slice names. A later revision points
back to the earlier plan. Work that kept the same promise and inputs keeps its
`PASS`, so changing one independent slice does not restart the other.

The board reads the plan, receipts, and Git whenever it refreshes. It does not
store a second progress record, so a missing view or interrupted runner cannot
invent approval, `PROCEED`, `PASS`, or `MERGED`.

## Technical details

The `plan` field in each receipt is the Git object for
[`plan.md`](walkthrough/plan.md). Each slice `contract` is a fingerprint derived
from that plan. Other object IDs and evidence fingerprints are fixed example
values because this documentation folder is not a standalone Git history.

Executable fixtures live in
[`../conformance/fixtures/`](../conformance/fixtures/).

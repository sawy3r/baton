# Walkthrough: revise one release without replacing it

This platform-agnostic example follows one `checkout-recovery` release with two
stable slices:

```text
approved plan revision
  ├─ T1 / S1: retry-safe checkout ─┐
  └─ T2 / S2: recovery runbook ───┤
                                  └─ assembly verification -> exact Merge
```

The durable protocol input is [`walkthrough/plan.md`](walkthrough/plan.md).
[`walkthrough/approval.txt`](walkthrough/approval.txt) stands in for protected
external approval over those exact bytes. Git holds the product and plan
history. A machine writer appends compact receipts for the responsibility
boundaries.

## One stable revision lineage

Suppose the first design attempt for S1 omitted an internal metadata detail.
Captain returns `REVISE`. The Implementer supplies another design TL;DR on S1;
the release and slice identities do not change.

After `PROCEED`, the first S1 candidate exposes a hydration defect. The fresh
Verifier returns `FAIL`. The Implementer creates another implementation attempt
on S1 and the fresh Verifier checks the replacement candidate. S2 remains
trusted because its contract and consumed inputs did not change.

If fixing hydration changed an input declared by S2, the next plan revision
would invalidate S2 as part of the real dependency closure. Filename proximity
or a newer timestamp is not enough.

## What each boundary keeps

The exact receipt serialization belongs to the reference kit, but the meanings
are fixed:

- approval binds the exact plan revision;
- design binds the plan, slice, and design attempt;
- Captain binds that design and returns `PROCEED`, `REVISE`, or `ESCALATE`;
- implementation binds the exact candidate, checks, and evidence;
- fresh verification binds that candidate and returns `PASS`, `FAIL`, or
  `BLOCKED`; and
- Merge binds current `PASS`, the expected target, observed target, and result.

Roles return decisions and evidence. They do not hand-author status, proof
bundles, or receipt files.

## Operational failure is separate

A runner interruption, duplicate dispatch, stale board, or known completed Git
effect produces no Baton verdict. The surrounding engine retries or reconciles
it from durable facts. It cannot turn a runtime event into approval, `PROCEED`,
`PASS`, or `MERGED`.

## Whole-product verification

Work `PASS` advances a slice; it does not certify the release. After the two
track candidates are composed, another fresh, read-only Verifier checks the
complete product. Merge then integrates only that exact assembled candidate
against the expected target.

The board is derived from the plan, receipts, and Git, so no board snapshot is
stored as delivery truth.

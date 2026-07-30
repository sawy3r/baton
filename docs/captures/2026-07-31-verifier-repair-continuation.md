# Verifier repair continuity

Date: 2026-07-31

Status: accepted direction for Baton RC12 and Sworn

## Decision

A Verifier thread starts clean and independent from the Implementer and
Captain. After it records `FAIL` against candidate C1, the engine may retain
that Verifier's conversation while the Implementer records the direct repair
C2. The same Verifier may then receive a new read-only view of C2 and issue the
next decision.

The resumed Verifier checks the complete current candidate, not only its old
findings. Its `FAIL` receipt must remain useful without that conversation. A
fresh Verifier is always valid, and heightened policy may require one.

The precise boundary is the
[Protocol's direct-repair continuation rule](../../baton/PROTOCOL.md#direct-repair-continuation).
No transcript or reasoning is required in Baton records.

This changes no role, verdict, receipt schema, stage, or gate. It clarifies that
independence means separation from delivery context, not forced amnesia after
every patch.

## Fired incident that exposed the recovery gap

Release `2026-07-31-ownership-outside-household`, track `T1-contract`, slice
`S01-ownership-allocation-contract` reached:

```text
candidate C1       8c816df8269bb813f5a7677157a948d98a1a8d51
candidate receipt  02e69f735bc5c8f7a277fd5d6b3a6498e27692f0
unreceipted C2      a5c2eed6beef8400ce5056b67dc22c2af8287d07
```

C2 was a clean direct descendant with a different product tree. No Verifier
decision had been recorded. Baton correctly refused to judge C1 as though it
were C2, but then marked the release invalid and refused the Implementer action
that would record C2. The honest history became a dead end.

The reference behavior should instead apply the Protocol's bounded
[exact-head refresh](../../baton/PROTOCOL.md#exact-head-refresh): mark C1 stale,
return the same slice to the Implementer, and accept an exact C2 candidate
receipt as the next attempt. The same recovery applies to a direct same-product
commit because the exact candidate identity still moved.

Because this incident has no valid `FAIL`, its old Verifier conversation cannot
cross to C2. C2 starts a fresh Verifier thread after its candidate receipt is
recorded.

## Quality challenge

Keeping the same Verifier can anchor it to its earlier theory and turn a full
review into a patch check. Starting fresh can avoid that bias but repeats
discovery and can create a slow sequence of reviewers finding one different
minor issue at a time.

Baton therefore permits both. Sworn should default to measured continuation
with universal fresh fallback, require a full-contract recheck, keep assembly
verification fresh, and expose continuation mode, tokens, elapsed time, and
outcome through local evaluation and opt-in telemetry. Evidence can then decide
whether particular work needs the heightened fresh-every-attempt policy.

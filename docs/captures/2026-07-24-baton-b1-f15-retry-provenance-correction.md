# Baton B1 F15-F17 retry-provenance correction

Date: 2026-07-24
Status: bounded correction frozen; independent verdict pending
Track: `track/v1.0.0/B1-contract-records`
F15 rejected head: `a30a06740a3434d8f5ba85d659fd4ecaaeb2a498`
F16-F17 rejected head: `de67556789fe023ea62c1580b7f21d9938503890`
F15 implementation: `b0f33e24e5e2167fe2484b06b97f363ea8975a7e`
F16-F17 implementation: `6c25a33021ab1eb28657a3ebf023dcd595da4007`

## Finding F15

`recordTransition` treated an equal status with a matching result projection as
an idempotent retry before proving serial eligibility, the exact lifecycle
predecessor, or proof history. A copied or otherwise invalid durable status
could therefore be legitimised as `changed: false`.

The same review found analogous risk in pristine rebound and materialisation:
their retry branches checked the visible end state without proving it was the
exact original action effect.

## Finding F16

Pristine rebound projected only plan and baseline statuses. It did not
inventory the complete release namespace, so stale design, proof, assembly, or
unknown record files could survive rebound without a binding in the new plan.
Installation and retry needed the same exact-namespace rule.

## Finding F17

Composition, assembly-preparation, and integration retries replayed structural
topology, trees, paths, and record bytes but did not reproduce the canonical
deterministic commit OIDs. A sibling commit with the exact admitted structure
but a different message could therefore be accepted as the engine's own
effect.

## Bounded correction

- `NO_VERDICT` is unchanged only at `verify / ready / verifier`; work still
  passes serial eligibility, evidence admission, handoff, and candidate-history
  validation.
- Every other ordinary retry reconstructs the authoritative direct predecessor,
  validates the original lifecycle and serial gate, replays proof-bearing work
  history, and deterministically reproduces the exact record commit.
- Assembly retries validate both predecessor and current assembly states before
  replaying the exact lifecycle effect.
- Rebound retries prove the supplied previous plan and pristine baselines at
  the direct parent, then reproduce the exact rebound commit.
- Materialisation retries reconstruct the absent-owner predecessor and run the
  complete collective transition validator before reproducing the exact marker.
- A bounded, plan-admitted tree inventory requires installation to begin with
  an absent release namespace and rebound predecessor/result trees to contain
  exactly `plan.md` plus every planned baseline status.
- Composition, assembly preparation, and integration retain their full
  aggregate replay and additionally reconstruct their canonical composition
  and record commits; structural sibling OIDs are rejected.

Durable negatives cover copied W2 state, design-stage `NO_VERDICT`, a
product-before-`PROCEED` proof retry, copied assembly `PASS`, a forged rebound,
a later same-status owner marker, stale design/proof/assembly/unknown namespace
files, copied action results, direct sibling status commits, and structurally
valid noncanonical two-parent composition and integration commits. Rejections
leave refs and commit inventory unchanged. Exact successful retries still prove
no ref movement and no new commit object.

## Correction evidence

```text
$ node --test test/records/*.test.mjs
tests 67
pass 67
fail 0

$ python3 conformance/check.py
PASS 7 strict JSON cases, 1 Draft 2020-12 schema, 2 positive status fixtures, and 6 negative status fixtures

$ git diff --check
(no output)
```

This is correction evidence, not a self-issued completion verdict. B1 remains
pending until a fresh independent review assesses the immutable corrected head.

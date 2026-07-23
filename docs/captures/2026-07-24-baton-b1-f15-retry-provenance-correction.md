# Baton B1 F15 retry-provenance correction

Date: 2026-07-24
Status: bounded correction frozen; independent verdict pending
Track: `track/v1.0.0/B1-contract-records`
Rejected head: `a30a06740a3434d8f5ba85d659fd4ecaaeb2a498`
Correction implementation: `b0f33e24e5e2167fe2484b06b97f363ea8975a7e`

## Finding F15

`recordTransition` treated an equal status with a matching result projection as
an idempotent retry before proving serial eligibility, the exact lifecycle
predecessor, or proof history. A copied or otherwise invalid durable status
could therefore be legitimised as `changed: false`.

The same review found analogous risk in pristine rebound and materialisation:
their retry branches checked the visible end state without proving it was the
exact original action effect.

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
- Existing composition, assembly-preparation, and integration aggregate replay
  remains authoritative; copied-result regressions now pin those fail-closed
  paths.

Durable negatives cover copied W2 state, design-stage `NO_VERDICT`, a
product-before-`PROCEED` proof retry, copied assembly `PASS`, a forged rebound,
a later same-status owner marker, and copied composition, preparation, and
integration results. Exact successful retries still prove no ref movement and
no new commit object.

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

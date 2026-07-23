# Baton B1 second adversarial review

Date: 2026-07-24
Status: failed
Reviewed head: `df89024beff3ee8d6a30bcb8263c05f359ce5694`
Reviewed contract commit: `ff13560a3e41ad8dbb186e92b74423522e75ece8`
Track: `track/v1.0.0/B1-contract-records`
Prior correction outcome:
[B1 corrected contract and records outcome](./2026-07-24-baton-b1-contract-records-corrected-outcome.md)

## Verdict

Fresh independent review rejected the first corrected B1 freeze on two
contract-quality defects.

The reviewed head passed all 57 Node tests, portable conformance, and diff
checks. Its executable trust corrections remain evidence, but the completion
freeze is withdrawn until the public role wording and portable suite inventory
match the implementation exactly.

## Findings

### F7 — Work-only handoffs were stated as universal verification inputs

`CORE.md` and `PROTOCOL.md` described every Verifier and `PASS` as receiving or
binding an Implementer design and Captain decision. That is true for work, but
not for assembly. Assembly has no Implementer or Captain binding: Merge prepares
the assembly proof and exact component heads, and a fresh Verifier assesses
that handoff.

The later assembly sections were accurate, but the earlier universal wording
made the five-role contract internally contradictory.

### F8 — Portable conformance did not inventory both new hardening suites

`hardening.test.mjs` and `git-trust-adversarial.test.mjs` carried the correction's
load-bearing regressions, but neither appeared in `conformance/check.py`
`REFERENCE_SUITES` or `conformance/manifest.json`. Direct
`node --test test/records/*.test.mjs` ran them, while portable conformance could
still pass if either suite disappeared.

## Bounded correction

B1 reopens only to:

1. qualify the Core and Protocol work path so work verification binds the
   Implementer design, Captain decision, candidate, and proof, while assembly
   verification binds the Merge-prepared proof and exact components; and
2. add both hardening suites to the executable and published conformance
   inventories, with a regression proving their absence fails portable
   conformance.

The correction does not reopen lifecycle, schema, Git topology, evidence,
provider, scheduling, board, or operations design. No new completion claim is
valid until the bounded correction and any still-running safe-API audit result
are frozen on a new immutable head and independently reviewed.


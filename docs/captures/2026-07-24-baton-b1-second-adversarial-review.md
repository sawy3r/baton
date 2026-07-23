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

### F9 — Parsed plan authority remained mutable and forgeable

`parsePlanBytes` returned a normal mutable object. After its raw digest was
computed, a caller could change work scope, track touch surfaces, dependencies,
or other metadata while retaining the original digest. Snapshot and aggregate
validators accepted caller-shaped plan objects rather than an opaque admission
minted from the exact raw bytes.

The contract therefore did not prove that later Git and lifecycle admission
used the same plan that the external authorizer approved.

### F10 — Record-root exclusion did not prove behavioral inertness

The protocol said product-tree exclusion fails automatically when build, test,
package, deploy, hook, or runtime behavior consumes `.baton/releases`.
`resolveRecordRootAdmission` proved only the root's canonical repository shape;
it did not resolve trusted evidence that the root was behaviorally inert.

A caller could therefore obtain product-tree exclusion without satisfying the
normative policy gate.

### F11 — Aggregate Merge validators lacked before/after ref binding

Track composition and assembly Merge validation consumed only a post-operation
snapshot. A self-recorded stale `expected_target` could pass post-hoc if a
caller force-installed the corresponding result and status refs before
validation. The validators did not prove that the exact observed pre-head was
the recorded expected target, that unrelated refs stayed still, or that the
post-head was the one authorized result/transfer.

### F12 — Product-tree CLI bypassed its own capability contract

The product-tree CLI passed a raw record-root string to the opaque capability
API. The normal command path therefore failed even though the underlying API
correctly rejected raw-root claims.

The same audit also flagged exported low-level mutation primitives as an
attractive unsafe path. Their boundary must be made internal or explicitly
unsafe, while ordinary callers receive evidence- and snapshot-gated high-level
actions.

### F13 — Singular blob reads could recapture a moving ref

The bounded batch reader required one full captured commit OID, but
`readFileAtRef` still accepted a branch name and resolved it at call time. A
caller using the singular helper could therefore mix state across ref movement
despite the snapshot contract.

### F14 — Trusted Git executable selection was replaceable process state

`configureGitExecutable` accepted a later absolute executable after the trusted
binary had already been selected. One component could therefore replace the
Git program used by later operations in the same engine process. The trusted
binary must be engine-scoped and set once, with only idempotent reselection of
the same real path allowed.

## Bounded correction

B1 reopens only to:

1. qualify the Core and Protocol work path so work verification binds the
   Implementer design, Captain decision, candidate, and proof, while assembly
   verification binds the Merge-prepared proof and exact components; and
2. add both hardening suites to the executable and published conformance
   inventories, with a regression proving their absence fails portable
   conformance;
3. return a deeply frozen, opaque parsed-plan admission bound to exact raw bytes
   and reject mutated or caller-forged plan objects in snapshots and aggregate
   validators;
4. require explicit trusted behavioral-inertness evidence before product-tree
   exclusion and any action that relies on it;
5. bind track composition and assembly Merge to exact before and after
   snapshots, including unchanged unrelated refs and exact pre/post heads; and
6. repair the product-tree CLI and close or clearly mark low-level mutation
   primitives so the safe high-level action path is the attractive path;
7. require full captured object IDs for singular as well as batched blob reads;
   and
8. make trusted Git executable configuration set-once within an engine process.

The correction does not reopen lifecycle, schema, provider, scheduling, board,
or role design. No new completion claim is valid until the bounded correction
and final safe-API audit result are frozen on a new immutable head and
independently reviewed.

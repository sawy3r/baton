---
name: baton-verify
description: "Independently verify an exact Baton slice candidate or assembled product from fresh read-only context."
---

<!-- baton-adapter
package-version: 1.0.0-rc.7
operation-version: baton.operation/v2
operation-sha256: sha256:2a6b14e214b6aea9c7d2c27072289735085626d3f4fc81f3a0fe76af3d2353d4
-->

Treat the free-form invocation text as the operation inputs. Resolve the Baton package root from the current Git project .claude/baton install when present and valid; otherwise use the configured Claude user directory baton install. Read package-relative files from that root.

<!-- BATON_CANONICAL_BEGIN baton-verify -->
---
operation: baton-verify
version: baton.operation/v2
---

## Purpose

Independently verify one slice candidate or the complete assembled product
against the applicable approved contract.

## Inputs

- Scope: one stable slice or the assembled release.
- The applicable approved plan revision and exact candidate.
- The applicable Captain decision for slice verification.
- Required checks, observable evidence, and protected fresh read-only dispatch
  evidence.

## Authority

Begin in fresh context with read-only candidate access. Differ from the
Implementer and Captain. Bind the decision to the exact plan revision,
candidate, product identity, evidence, and invocation.

Judge the actual candidate against the approved behavioral commitment.
Ancillary support paths and additional checks are evidence, not scope failures
by themselves. They cannot excuse a material behavior, consumed-product,
contract, or authority change.

## Actions

1. Re-establish every trust-critical binding from immutable facts.
2. Inspect the real candidate and complete diff, rerun required checks, consider
   useful additional evidence, and test each acceptance claim at its named
   boundary.
3. For assembly, check every composed component and the complete product.
4. Return exactly one verdict:
   - `PASS` when the exact candidate satisfies the contract;
   - `FAIL` when the contract is adequate but candidate or evidence needs
     correction;
   - `BLOCKED` when safe progress requires changed behavior, consumed product,
     authority, contract, or an external decision.

## Required output

Return scope, verdict, exact bindings, numbered evidence or violations,
Verifier invocation, and concise reason. Do not write the Verifier receipt.
On operational failure, return the condition and no verdict.

## Stop conditions

Never return `PASS` for contaminated context, writable candidate access,
missing approval, stale Captain decision, changed candidate, ambiguous
evidence, or unavailable required checks.

## Next handoff

Slice `PASS` hands to `baton-merge`; `FAIL` returns the same stable slice
directly to `baton-implement` for another implementation attempt; `BLOCKED`
hands to `baton-plan`. Assembly `PASS` permits final Merge.
<!-- BATON_CANONICAL_END baton-verify -->

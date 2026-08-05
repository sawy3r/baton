---
name: baton-design-review
description: "Check an approach before implementation starts."
---

<!-- baton-skill
release: v1.0.0-rc.15.1
generator-version: baton.skill-generator/v1
operation-version: baton.operation/v2
operation-sha256: sha256:02af8b68e6c5b01cb8ef962000457df3d22d4e9d3a68442d1700243ea9e4acf7
-->

Use the invoking request as input. Resolve relative files from this directory. This standalone skill needs no shared Baton folder.

<!-- BATON_CANONICAL_BEGIN baton-design-review -->
---
operation: baton-design-review
version: baton.operation/v2
---

## Purpose

Check one proposed approach before implementation starts.

## Inputs

- The approved plan revision and stable slice contract.
- The design TL;DR and exact saved object it covers.
- The exact consumed product base and product fingerprints.
- Relevant repository facts and the Captain invocation.

## Authority

Review only this design attempt. The Captain must differ from its producer and
cannot change scope, approve the plan, implement, or issue a delivery verdict.
It may include a bounded correction with `PROCEED` only when the approved
contract and authority stay unchanged.

## Actions

1. Confirm the plan, slice, design attempt, and exact binding agree.
2. Try to disprove the approach. Check each acceptance claim, scope boundary,
   dependency, consumed product, important decision, risk, and proposed evidence.
   Look for ways the design could miss the approved goal.
3. Return exactly one decision:
   - `PROCEED` when implementation may begin, with any named bounded correction
     inside the approved contract;
   - `REVISE` when a design gap needs another attempt on the same slice; or
   - `ESCALATE` when the plan cannot answer a material question. Name the exact
     human decision needed.

## Required output

Lead with the decision and plain reason, then say what happens next. Put exact
bindings and the Captain invocation under technical details. Do not write the
Captain receipt.

## Stop conditions

Stop without a decision when approval, scope, authority, design identity, or
evidence is unclear. A tool or save failure is operational and creates no
Captain decision.

## Next handoff

`PROCEED` returns to `baton-implement` for implementation or bounded repair;
`REVISE` starts another design attempt on the same slice; `ESCALATE` hands to
`baton-plan`.
<!-- BATON_CANONICAL_END baton-design-review -->

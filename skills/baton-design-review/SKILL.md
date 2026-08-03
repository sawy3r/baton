---
name: baton-design-review
description: "Check an approach before implementation starts."
---

<!-- baton-skill
release: v1.0.0-rc.14
generator-version: baton.skill-generator/v1
operation-version: baton.operation/v2
operation-sha256: sha256:ecfecf92a1858db9a27de6105ccf647f5a15ec85ed76a346072182e22e99a6d5
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
2. Check acceptance, scope, dependencies, consumed product, important
   decisions, risks, and proposed evidence.
3. Return exactly one decision:
   - `PROCEED` when implementation may begin, including with named bounded
     corrections inside the approved contract;
   - `REVISE` when a material design change needs another attempt on the same
     slice; or
   - `ESCALATE` when behavior, contract, authority, or an external decision
     requires revised approval.

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

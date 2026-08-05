---
name: baton-implement
description: "Explain an approach or build approved work."
---

<!-- baton-skill
release: v1.0.0-rc.15.1
generator-version: baton.skill-generator/v1
operation-version: baton.operation/v2
operation-sha256: sha256:104fe06e1e9040c1d4b4d5b97c1c090ed037fc5737ce47d13c0152fc653a7c28
-->

Use the invoking request as input. Resolve relative files from this directory. This standalone skill needs no shared Baton folder.

<!-- BATON_CANONICAL_BEGIN baton-implement -->
---
operation: baton-implement
version: baton.operation/v2
---

## Purpose

Explain an approach or build one slice without taking the Captain or Verifier
role.

## Inputs

- Approved plan, revision, slice, and attempt.
- Dependencies, inputs, scope, acceptance, checks, limits, and exclusions.
- Captain decision and any prior Verifier decision.

## Authority

Stay within the approved slice and attempt. Building requires `PROCEED` for its
plan, slice, and design. `REVISE` adds a design attempt; `FAIL` adds an
implementation attempt. Neither replaces the slice.

Scope commits behavior and product, not every path. Support paths and
checks are evidence unless they change behavior, consumed product, contract,
authority, or an outside decision.

Product code, build, test, package, deploy, hooks, and runtime MUST NOT read or
depend on reserved `.baton/releases`; do not modify it.

## Actions

1. Before design, use the current plan and exact base prepared from passed
   consumed work. Older track records are history. Return a design TL;DR mapping
   every acceptance ID to the approach and proposed evidence. Name risks or
   missing requirements. Stop; invent nothing.
2. After `PROCEED`, check the base again. Build the approved result, apply bounded
   corrections, preserve the record root, and repair prior `FAIL` on the same
   slice.
3. Run required and useful checks. Inspect the diff, candidate, product identity,
   and evidence.
4. Return acceptance-linked evidence over the exact candidate, support paths,
   and extra results. Stop.

## Required output

Lead with result, meaning, and next step. After design, include the Captain
handoff. After implementation, include checks, acceptance evidence, deviations,
and the Verifier handoff. Put revision, slice, attempt, exact binding, candidate,
and product identities under technical details. Never write receipts or claim
`PASS`.

## Stop conditions

Stop on missing approval, eligibility, dependency, consumed input, `PROCEED`,
requirement, required check, or candidate identity; a hard exclusion or product
boundary breach; or a material behavior, contract, authority, or outside
decision change. Name what is missing. Report operational failure without
inventing a Baton outcome.

## Next handoff

Send a design to `baton-design-review` and candidate evidence to
`baton-verify`. The engine follows Protocol repair and assurance policy.
<!-- BATON_CANONICAL_END baton-implement -->

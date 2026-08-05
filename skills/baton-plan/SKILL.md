---
name: baton-plan
description: "Plan small, checkable work for someone else to approve."
---

<!-- baton-skill
release: v1.0.0-rc.15.1
generator-version: baton.skill-generator/v1
operation-version: baton.operation/v2
operation-sha256: sha256:0623219dd8ccb0e0ee89962e5c4626444f372bf219e8bd9309f9e97b0b02112f
-->

Use the invoking request as input. Resolve relative files from this directory. This standalone skill needs no shared Baton folder.

<!-- BATON_CANONICAL_BEGIN baton-plan -->
---
operation: baton-plan
version: baton.operation/v2
---

## Purpose

Turn a goal into a clear contract for someone else to approve. Planning never
approves itself.

## Inputs

- Goal, repository, target, approver, and applicable plan.
- Current Git, code, tests, docs, history, scope, acceptance, dependencies,
  inputs, limits, and exclusions.

## Authority

Keep the release while its goal, target, and approver stay the same. Preserve
unchanged slices and identify consumers of changed inputs. Approval must cover
the exact proposed plan bytes.

The plan is a commitment. Support paths, additional checks,
evidence, scheduling, retries, worktrees, and bookkeeping need no revision when
the promise stays the same.

## Actions

1. Inspect Git, the plan, code, tests, docs, and history. Find repository facts.
2. Ask only about missing human choices that could change the result, never
   repository facts. Offer no approval-ready plan while an important choice is
   open.
3. When meaning is clear, give a short plain-language summary of the result,
   scope, acceptance, evidence, inputs, and limits. Ask the human to correct or
   confirm it, then stop without plan bytes.
4. In a later turn, after the response, write the smallest complete plan or
   forward-only revision with `templates/plan.md`. Give each slice one result
   that can be reviewed alone. Acceptance must be able to fail in a real product
   check, and evidence must observe its named boundary. Preserve slice identities.
5. Present the exact plan bytes for external approval and stop.

## Required output

Before confirmation, return only the summary, a request to correct or confirm
it, and any open choice; no plan bytes. After the response, lead with the result,
changes, and next approval step. Put the exact plan, release, revision, slice
changes, and invalidated consumers under technical details. Never approve or
write a receipt.

## Stop conditions

Stop when a material choice about the goal, target, authority, scope,
dependencies, consumed inputs, acceptance, or contract is unclear. Name the
choice needed. Do not guess approval, widen the work, or revise merely to record
operational discovery.

## Next handoff

After external approval is durably bound to the exact plan, hand each
dependency-ready slice to `baton-implement`.
<!-- BATON_CANONICAL_END baton-plan -->

---
name: baton-plan
description: "Plan small, checkable work for someone else to approve."
---

<!-- baton-skill
release: v1.0.0-rc.13
generator-version: baton.skill-generator/v1
operation-version: baton.operation/v2
operation-sha256: sha256:443f8bbce2914f2586de8ae7796b346554097421742071e8494d459673b82760
-->

Use the invoking request as input. Resolve relative files from this directory. This standalone skill needs no shared Baton folder.

<!-- BATON_CANONICAL_BEGIN baton-plan -->
---
operation: baton-plan
version: baton.operation/v2
---

## Purpose

Turn a goal into small, checkable pieces of work for someone else to approve.
Planning never approves itself.

## Inputs

- The goal, repository, target, and person or system allowed to approve it.
- Stable tracks and slices: promised behavior, product scope, acceptance,
  minimum checks, constraints, real dependencies, consumed inputs, and
  exclusions.
- The current repository and prior approved plan when revising.

## Authority

Keep the same release while its goal, target, and approval authority stay the
same. Keep unchanged slices. Change only slices whose contracts changed and
identify dependent slices whose consumed inputs changed. Approval must cover
the exact proposed plan bytes.

The plan is a commitment, not an inventory. Predicted paths, support work,
additional checks, evidence notes, scheduling, retries, worktrees, and
bookkeeping do not require revision when the promise is unchanged.

## Actions

1. Read current Git and the applicable plan.
2. Propose the smallest complete plan or forward-only revision using
   `templates/plan.md`.
3. Put only promised behavior, product surfaces, minimum proof, constraints,
   authority, and real product relationships into slice contracts.
4. Preserve stable slice identities; add or explicitly retire slices when the
   promised outcomes change.
5. Present the exact plan bytes for external approval and stop.

## Required output

Lead with what the plan will deliver, what changed, and what the approver should
do next. Put the exact plan, release, revision, retained/changed/added/retired
slices, and invalidated dependency closure under technical details. Do not
write an approval or receipt.

## Stop conditions

Stop when the goal, target, authority, scope, dependencies, consumed inputs,
acceptance, or a material contract change is unclear. Do not guess approval,
widen the work, or revise merely to record operational discovery.

## Next handoff

After external approval is durably bound to the exact plan, hand each
dependency-ready slice to `baton-implement`.
<!-- BATON_CANONICAL_END baton-plan -->

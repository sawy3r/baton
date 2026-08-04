---
name: baton-plan
description: "Plan small, checkable work for someone else to approve."
---

<!-- baton-skill
release: v1.0.0-rc.15
generator-version: baton.skill-generator/v1
operation-version: baton.operation/v2
operation-sha256: sha256:8c350203edb1d9a8a5ce20a30604c99c7e335ae5c1ef443477423c51b05e1005
-->

Use the invoking request as input. Resolve relative files from this directory. This standalone skill needs no shared Baton folder.

<!-- BATON_CANONICAL_BEGIN baton-plan -->
---
operation: baton-plan
version: baton.operation/v2
---

## Purpose

Turn a goal into a short, clear contract for someone else to approve. Planning
never approves itself.

## Inputs

- The goal, repository, target, and approver.
- Current Git, code, tests, docs, history, and the applicable plan.
- Slice results, scope, acceptance, checks, limits, dependencies, inputs, and
  exclusions.

## Authority

Keep the release while its goal, target, and approver stay the same. Keep
unchanged slices; change changed contracts and identify consumers of changed
inputs. Approval must cover the exact proposed plan bytes.

The plan is a commitment, not an inventory. Support paths, additional checks,
evidence, scheduling, retries, worktrees, and bookkeeping need no revision when
the promise stays the same.

## Actions

1. Inspect current Git, plan, code, tests, docs, and history. Find repository
   facts yourself.
2. Find choices that could change the promised result. Ask only about missing
   human choices, never facts the repository can answer. Offer no approval-ready
   plan while an important choice is open.
3. When meaning is clear, give a short plain-language summary of the result,
   scope, acceptance, evidence, inputs, and limits for correction or confirmation.
4. After confirmation or correction, write the smallest complete plan or
   forward-only revision with `templates/plan.md`. Give each slice one result
   that can be reviewed alone.
   Each acceptance claim must be able to fail in a real product check, and its
   evidence must observe the boundary it names. Preserve stable slice identities.
5. Present the exact plan bytes for external approval and stop.

## Required output

Lead with the result, changes, and next approval step. Put the exact plan,
release, revision, slice changes, and invalidated consumers under technical
details. Do not write an approval or receipt.

## Stop conditions

Stop when a material choice about the goal, target, authority, scope,
dependencies, consumed inputs, acceptance, or contract is unclear. Name the
choice needed. Do not guess approval, widen the work, or revise merely to record
operational discovery.

## Next handoff

After external approval is durably bound to the exact plan, hand each
dependency-ready slice to `baton-implement`.
<!-- BATON_CANONICAL_END baton-plan -->

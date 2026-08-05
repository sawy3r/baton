---
name: baton-plan
description: "Plan small, checkable work for someone else to approve."
---

<!-- baton-skill
release: v1.0.0-rc.15.2
generator-version: baton.skill-generator/v1
operation-version: baton.operation/v2
operation-sha256: sha256:94602fe24858c68f9456ffa72790aa6bb427c2371146afaec8635de2328e72df
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
- Current repository, scope, acceptance, dependencies, inputs, limits, and
  exclusions.

## Authority

Keep the release while its goal, target, and approver stay the same. Preserve
unchanged slices and identify consumers of changed inputs. Approval must cover
the exact release skeleton and every declared slice file.

The plan is a commitment. Support paths, additional checks,
evidence, scheduling, retries, worktrees, and bookkeeping need no revision when
the promise stays the same.

## Actions

1. Inspect Git, the plan, code, tests, docs, and history. Find repository facts.
2. Ask only about human choices that could change the result. Offer no plan
   while one is open.
3. When clear, summarize result, scope, acceptance, inputs, and limits; ask for
   correction or confirmation, then stop without plan bytes.
4. Later, write the smallest plan or forward-only revision with
   `templates/plan.md` and one `templates/slice.md` per slice. Keep paths,
   digests, outcomes, and identities exact. Give every slice an independently
   reviewable result with falsifiable acceptance.
   Optionally publish a human-readable bundle under configured
   `release_docs_root` (default `docs/baton/releases`) at
   `<release>/slices/<id>/`. Set it in the project `.baton/config.json` or the
   global `~/.config/baton/config.json`; project configuration overrides global
   configuration. Use `templates/evidence.json` as an advisory inventory.
5. Present the exact plan bytes for external approval and stop.

## Required output

Before confirmation, return only the summary, a request to correct or confirm
it, and any open choice; no plan bytes. After the response, lead with the result,
changes, and next approval step. Put the exact plan and slice changes under
technical details. Never approve or write a receipt.

## Stop conditions

Stop when a material choice about the goal, target, authority, scope,
dependencies, consumed inputs, acceptance, or contract is unclear. Name the
choice needed. Do not guess approval, widen the work, or revise merely to record
operational discovery.

## Next handoff

After external approval is durably bound to the exact plan, hand each
dependency-ready slice to `baton-implement`.
<!-- BATON_CANONICAL_END baton-plan -->

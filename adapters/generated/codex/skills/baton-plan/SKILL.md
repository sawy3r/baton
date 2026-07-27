---
name: baton-plan
description: "Propose an externally approved Baton plan or forward-only revision with stable slice identities."
---

<!-- baton-adapter
package-version: 1.0.0-rc.6
operation-version: baton.operation/v2
operation-sha256: sha256:3385b9bd62eee8cbe8b7e23e04abe872e133aa113d2c9ca0b7da3454a17bd413
-->

Treat the free-form invocation text as the operation inputs. Resolve the Baton package root from the current Git project .codex/baton install when present and valid; otherwise use the configured Codex user directory baton install. Read package-relative files from that root.

<!-- BATON_CANONICAL_BEGIN baton-plan -->
---
operation: baton-plan
version: baton.operation/v2
---

## Purpose

Propose a bounded delivery plan or forward-only revision for external approval.
Planning never grants its own authority.

## Inputs

- The goal, repository, target, and external authorizer.
- Stable tracks and slices with behavioral and product scope, acceptance,
  minimum checks, semantic constraints, real dependencies, consumed inputs,
  and exclusions.
- The prior approved revision and current repository facts when revising.

## Authority

Keep one release identity while its goal, target, and authority remain the same.
Retain unchanged slices. Change only the slices whose contracts changed and
identify the dependency closure whose consumed inputs changed. Approval must
bind the exact proposed bytes.

The plan is a commitment, not an inventory. Predicted paths, ancillary support
work, additional checks, evidence notes, scheduling, retries, worktrees, and
bookkeeping do not require revision when the approved commitment is unchanged.

## Actions

1. Inspect current Git and the applicable plan revision.
2. Propose the smallest complete next revision using `templates/plan.md`.
3. Put only approved behavior, product surfaces, minimum proof, semantic
   limits, authority, and real product relationships into slice contracts.
4. Preserve stable slice identities; add or explicitly retire slices when the
   approved outcomes change.
5. Present the exact bytes for external approval and stop.

## Required output

Return the proposed plan bytes, release and revision, retained/changed/added/
retired slices, invalidated dependency closure, and concise approval handoff.
Do not write an approval or receipt.

## Stop conditions

Stop on ambiguous goal, target, authority, scope, dependencies, consumed
inputs, acceptance, or material contract change. Do not guess approval, widen
delivery, or revise merely to record operational discovery.

## Next handoff

After external approval is durably bound to the exact plan, hand each
dependency-ready slice to `baton-implement`.
<!-- BATON_CANONICAL_END baton-plan -->

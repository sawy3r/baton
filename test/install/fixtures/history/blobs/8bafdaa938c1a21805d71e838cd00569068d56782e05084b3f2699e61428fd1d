---
name: baton-design-review
description: "Record the Captain decision over exact Baton plan and design bytes. Use when a work item is awaiting design review."
---

<!-- baton-adapter
package-version: 1.0.0-rc.2
operation-version: baton.operation/v1
operation-sha256: sha256:ead3a7d0e22a794ca5430fdbaca5c29f3ae5d5f6fad7c102d1f2bd878f28e356
-->

Treat the free-form invocation text as the operation inputs. Resolve the Baton package root from the current Git project .codex/baton install when present and valid; otherwise use the configured Codex user directory baton install. Read package-relative files from that root.

<!-- BATON_CANONICAL_BEGIN baton-design-review -->
---
operation: baton-design-review
version: baton.operation/v1
---

## Purpose

Make the distinct Captain decision over one exact plan and design before
implementation begins.

## Inputs

- The admitted plan and authoritative work status.
- The exact `design.md` bytes and their recorded digest.
- Relevant live repository facts needed to judge the proposed approach.
- The Captain invocation identity.

## Authority

Review only `design / ready / captain`. The Captain invocation must differ from
the design producer and bind the current plan and design digests. The decision
does not alter approved scope or approve a plan.

## Actions

1. Confirm the design digest matches the current bytes and the work remains
   authoritative on its owning ref.
2. Check that the approach covers acceptance, respects scope and dependencies,
   identifies consequential decisions and risks, and proposes credible
   evidence.
3. Choose exactly one result:
   - `PROCEED` when implementation may begin under this design.
   - `REVISE` when the Implementer must produce new design bytes.
   - `ESCALATE` when new planning authority or an external decision is needed.
4. Construct the exact next status and record the chosen result through
   `recordTransition`.

## Required output

Return only the decision, plan digest, design digest, Captain invocation,
resulting durable projection, and action receipt. Include concise reasons as
review evidence outside the status.

## Stop conditions

Stop without a decision on missing or changed bytes, stale authority, an
invalid invocation boundary, absent evidence needed for review, or any action
error. Do not implement, verify, or silently expand scope.

## Next handoff

`PROCEED` hands back to `baton-implement`; `REVISE` hands back for a new design;
`ESCALATE` hands to `baton-plan` for new authority.
<!-- BATON_CANONICAL_END baton-design-review -->

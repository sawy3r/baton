---
title: Release board template
description: The release board — the single source of truth for slice states across a release. Updated by the planner during decomposition and by implementer / verifier as each slice progresses.
# worktree_path and worktree_branch are added by the first /implement-slice run for this release.
# They name the canonical release worktree that every subsequent /implement-slice and /verify-slice
# session for this release must run inside. Planner does NOT set these fields — planning runs on the
# integration branch in the primary worktree so concurrent planning sessions share visibility.
# worktree_path: <set by first /implement-slice — absolute path, e.g. <HOME>/projects/<repo-basename>-worktrees/release-2026-05-16-expenses-ia>
# worktree_branch: <set by first /implement-slice — branch name, e.g. release-wt/2026-05-16-expenses-ia>
---

# Release Board: `<release-name>`

> Copy this file to `docs/release/<release-name>/index.md`. Every slice in the release appears in the table below. The table is the single source of truth for slice state — `status.json` is the machine-readable form, this table is the human-readable form. Keep them in sync.
>
> **Naming convention:** `<release-name>` follows `YYYY-MM-DD-<theme>` where the date is planning-start. The *target version* of this release (e.g. `v0.5.0`, `v0.6.0`) goes in the Release summary block below, not in the folder name.

## Release summary

- **Goal**: <one sentence; cite `intake.md` for the long form>
- **Target version / integration branch**: <e.g. `v0.5.0`, `release/v0.6.0`, or "rolling / unattached">
- **Started**: <YYYY-MM-DD> (should match the date prefix in the folder name)
- **Target ship**: <YYYY-MM-DD or "uncommitted">
- **Intake**: `intake.md`
- **Stakeholder**: <name>
- **Tracking issue**: <link>

## Slices

| ID | User outcome | State | Owner | Spec | Proof |
|---|---|---|---|---|---|
| `S01-<name>` | <one sentence> | planned | human | [spec](./S01-<name>/spec.md) | — |
| `S02-<name>` | <one sentence> | planned | human | [spec](./S02-<name>/spec.md) | — |
| ... | ... | ... | ... | ... | ... |

### State legend

| State | Meaning | Who can move out of it |
|---|---|---|
| `planned` | Spec written, awaiting implementation | Implementer |
| `in_progress` | Implementer session active | Implementer |
| `implemented` | Implementer claims done; awaiting fresh-context verification | Verifier |
| `verified` | Fresh-context verifier returned PASS | Human |
| `failed_verification` | Verifier returned FAIL; fix and re-submit | Implementer |
| `deferred` | Slice carved out per Rule 2; not in this release | Human |
| `shipped` | Slice is live in production | — (terminal) |

## Aggregate state

<Maintain a rolling count, updated whenever any slice transitions. The planner produces the initial counts; implementer and verifier update during the release.>

- Planned: N
- In progress: N
- Implemented (awaiting verification): N
- Verified (awaiting ship): N
- Failed verification: N
- Deferred: N
- Shipped: N

## Recent activity

<Chronological log of the most recent state transitions. Useful for continuation handshake — a new session can see what changed since the last one without grepping per-slice status.json.>

### <YYYY-MM-DD HH:MM> — `<slice-id>`: `<old-state>` → `<new-state>`

- **Actor**: <implementer / verifier / human>
- **Note**: <one line, e.g. verifier verdict summary or human ship approval>

## Decisions deferred (Rule 2)

<Items carved out of this release with explicit acknowledgement. Mirror the intake's "Adjacent / out of scope" section, but only items that came up post-decomposition land here.>

- ...

## Cross-slice notes

<Anything that affects more than one slice and needs human-level coordination — usually data-model migrations, env-var changes, or shared infra. Do not put implementation details here; that belongs in per-slice journals.>

- ...

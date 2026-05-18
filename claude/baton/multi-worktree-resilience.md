---
title: Multi-Worktree Resilience — coordinating in-flight releases without clobbering each other
description: When parallel releases run in separate git worktrees, four failure modes appear that single-worktree workflows don't see. This doc names them and the discipline that catches each.
---

# Multi-Worktree Resilience

This is a release-mode operational pattern, not a rule. It applies when a project runs multiple releases concurrently in separate `git worktree` directories, each on its own `release-wt/<name>` branch. Single-worktree workflows do not encounter these failure modes; multi-worktree ones routinely do, and each one is silent enough to mistake for unrelated bugs.

It complements [release-mode-slice-ref.md](release-mode-slice-ref.md), which covers the in-worktree case (single integration branch, rebase recovery, mid-flight handoff). This doc covers the cross-worktree case.

## When this applies

You're in scope if **two or more** of the following are true:

- Releases run in separate `git worktree` directories simultaneously.
- Each release has its own integration branch (`release-wt/<name>`) branched off a shared base (typically `release/v*`).
- Slices from different releases may touch overlapping files or routes.
- Implementer / verifier / planner sessions can run on different worktrees at the same time.

If only one of these holds you can read this as background; you will encounter it later.

## The four failure modes

| # | Name | Where it fires | Detection | Cure |
|---|------|----------------|------------|------|
| 1 | Direct touchpoint collision | Commit time | Merge conflict | Planned-files intersection check at slice claim |
| 2 | Transitive render-path collision | Test execution time | Route 500 / unexpected runtime error | Reachable-file enumeration at slice claim |
| 3 | Worktree-stale sibling status | Read time (silent) | Disagreement between briefer and implementer about a sibling slice's state | Read from the implementer's worktree, not the briefer's |
| 4 | Forward-port direction error | Sync time | Verified state overwritten back to `planned` | Only forward-port deltas where release-wt is *more advanced* than integration |

## 1. Direct touchpoint collision

The classical failure. Two in-flight slices on different worktrees both list the same files in their `planned_files`. At commit time, the second one to merge into integration hits a conflict. At rebase time, the slice fork-points diverge.

**Detection.** Before claiming a slice, intersect its `planned_files` against every peer slice's `planned_files` where `state ∈ {in_progress, implemented}`. Non-empty intersection ⇒ serial-only dependency. Surface to the operator with the overlap list before any code edit.

**Cure.** Sequence the slices. Whichever lands first, the other rebases on top.

## 2. Transitive render-path collision

The subtle cousin. Peer slice modifies a file your slice doesn't list, but your tests render a route that server-side-renders that file. The peer's uncommitted half-refactor (rename completed in one site but not another) 500s your test runs even though no merge conflict will ever surface.

**Direct overlap blocks at commit time** (merge conflict). **Transitive collision blocks at test execution time** (route 500). Same root cause — uncoordinated edits on the same surface across worktrees — but different symptom and different detection moment. The planned-files-intersection check (failure mode 1) reads clean.

### Concrete case

Slice S06-cashflow-view-playwright authored 5 Playwright walks against `/fire-calculator`. The anonymous walk PASSed. The four premium walks 500'd at SSR with `ReferenceError: resolvedTier is not defined at WorkspaceControlPanel.tsx:1167`. `git blame` showed "Not Committed Yet" — peer slice S07-g5-rule-editor-surface had `WorkspaceControlPanel.tsx` in its uncommitted WIP, with `resolvedTier` renamed to `resolvedUserTier` everywhere *except* line 1167.

`WorkspaceControlPanel.tsx` was not in S06's planned files. It was reachable from `/fire-calculator` SSR for authenticated users.

### Detection

After the planned-files intersection check, additionally enumerate every route any test in the slice will exercise. For each route, walk the App Router file tree (or framework equivalent) plus consumed `components/` for the set of files reachable at SSR. Intersect that reachable-set against every peer `in_progress` slice's `planned_files`.

```bash
# Pseudo-code — adapt to your framework
slice_routes_tested=$(grep -oh "page\.goto\(['\"]\([^'\"]*\)['\"]\)" tests/ | extract_routes)
for route in $slice_routes_tested; do
  ssr_reachable=$(find apps/web/app/$route/ apps/web/components/ -name "*.tsx" -o -name "*.ts")
  intersect "$ssr_reachable" with each peer slice's planned_files
done
```

**Cure.** Same as failure mode 1 — sequence the slices, or run only the unauthenticated portion of the test suite until the peer commits.

## 3. Worktree-stale sibling status

Each worktree branched off the integration tip at the moment it was created. The worktree's view of the *integration branch's release directory* — and therefore every `status.json` file inside it for sibling releases — is a snapshot at fork time. As integration moves on (other releases land, merge in), those status files in the older worktrees grow stale silently.

There is no merge conflict, no error message. A read of `apps/docs/.../release/<sibling-release>/<slice>/status.json` from inside the worktree returns the state at fork time, not the current state on integration.

### Concrete case

A briefer (running in the primary repo on `release/v0.5.0`) told an implementer (on a `release-wt/2026-05-17-cashflow-view` worktree) that capital-allocation slice S05b was `verified` and its engine routing was wired. The implementer ran a five-second audit:

- The worktree's copy of `capital-allocation/S05b-offset-target/status.json` read `state: planned`.
- The worktree's `go/pkg/tools/fire/types.go` at line 995 had only the constant declaration, no routing.

The implementer was correct *for this worktree*. The briefer was correct *for integration*. Both readings were honest; the worktree was simply behind.

### Detection

When briefing an implementer on a multi-worktree project, **the briefer's facts must come from the implementer's worktree**, not from the briefer's own checkout. Before stating a sibling slice's state in a brief:

```bash
grep '"state"' /path/to/<implementer-worktree>/apps/docs/.../release/<sibling>/<slice>/status.json
```

If the briefer is running in a different worktree (or the primary repo on the integration branch), the only reliable read is at the implementer's filesystem location.

### Cure

Two options, depending on urgency:

- **Merge integration into the worktree first.** Lifts the staleness for the cost of resolving any conflicts. Right when the integration drift carries dependencies the slice needs.
- **Treat the worktree's view as ground truth for this slice.** Ship the slice honest to the worktree's branch state; the eventual merge-back reconciles the inconsistency. Right when the integration drift is incidental and the merge has substantial conflicts.

The wrong move is to act on the briefer's view without checking the implementer's. That's the path to shipping code that references state the worktree doesn't yet have.

### Why this isn't covered by failure mode 1

Failure mode 1 is about *concurrent* edits to overlapping files within a single slice-claim window. Failure mode 3 is about *completed* sibling-release work landing on integration after a worktree forked, and the worktree's view of that completed work staying stale until the next sync. Same root cause family (worktrees diverge from integration), different operational moment, different detection.

## 4. Forward-port direction error

When syncing `status.json` files from worktrees back to integration (or vice versa), only forward-port deltas where the **release-wt branch is more advanced** than the integration branch reads. The intuitive "diff and copy all changes" can copy a worktree's stale-snapshot reading of a sibling slice (failure mode 3) back to integration, regressing verified state to `planned`.

### Concrete case

During a forward-port sync, three release-wt branches each contained their own stale snapshot of `capital-allocation/S05b-offset-target/status.json`. Two read `planned` (stale, pre-merge); one read `verified` (correct, post-merge). A naive `cp` of every delta would have written `planned` over `verified` on integration twice.

### Detection / cure

For each candidate forward-port file, read the state on both sides. Apply only when:

- Release-wt state is **strictly more advanced** than integration state (`planned → in_progress → implemented → verified/shipped/deferred`).
- Or the file is **new on the release-wt** (added since fork) and absent on integration.

Reject when:

- Integration state is more advanced than release-wt state. The worktree is reading a stale snapshot of a sibling release. Skip silently — the worktree resolves at its next merge-in.

A simple direction-of-truth rule: **state can only move forward via forward-port. Backwards movement requires a deliberate verifier FAIL or a deliberate human override commit.**

## Operational summary

For each new slice claimed on a multi-worktree project, the implementer's Step 0 sweeps:

1. Direct planned-files intersection against peer `in_progress` slices (failure mode 1).
2. Transitive SSR-reachable-file intersection against peer `in_progress` slices (failure mode 2).
3. Briefer-vs-worktree reality check on any sibling-release facts cited in the brief (failure mode 3).
4. Direction-of-truth check before any status forward-port (failure mode 4).

Each check is a few seconds. Each missed check produces a silent failure that takes 15–60 minutes to diagnose after the fact.

## Provenance

Source project's v0.5.0 push, 2026-05-18 to 2026-05-19. Four releases ran concurrently across four worktrees over a 36-hour window. All four failure modes fired at least once; each was caught by the operator running an ad-hoc version of the discipline this doc now formalises. The cost of each miss was 15–60 minutes of diagnostic conversation; the cost of the check at slice-claim time is seconds.

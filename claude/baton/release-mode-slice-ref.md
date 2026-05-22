---
title: Release Mode — slice-scoped remote ref (SUPERSEDED)
description: Superseded by track mode. The slice-scoped recovery ref is replaced by the per-track branch, which is itself the durable anchor. See track-mode.md.
---

# Release Mode — slice-scoped remote ref (SUPERSEDED)

> **This convention is superseded by [track mode](./track-mode.md).** Do not use `release/slice/<slice-id>` refs for new work.

## Why it was retired

The slice-scoped remote ref (`origin/release/slice/<slice-id>`) was a recovery anchor for the **one-worktree-per-release** model: all slices shared one branch, so an implementer's commits needed an off-branch backup against a force-rebase.

That ref was explicitly **write-only** — push to it, never `checkout`, never merge from it. In practice it got treated as a real branch and merged from anyway, which scattered a slice's commits topologically and caused a later integration merge to silently drop a verified slice. The recovery tool became a foot-gun.

Track mode removes the need for it:

- Each track has its **own worktree and its own branch** `track/<release>/<track-id>`. An implementer's commits are never on a shared, rebase-prone branch.
- The track branch is pushed to `origin/track/<release>/<track-id>` after every commit — it **is** the durable home and the recovery anchor, and it **is** the branch `/merge-track` merges. There is no separate ref to mistake for a branch.
- Concurrent in-tree races (the thing the slice ref never solved) are gone: tracks run in separate worktrees with separate indexes.

## What to read instead

- **[`track-mode.md`](./track-mode.md)** — the model: branch/worktree hierarchy, the four safety invariants, the touchpoint matrix, lifecycle, naming, and recovery.
- `role-prompts/implementer.md` — the implementer's track-branch push step.
- `claude/commands/implement-slice.md`, `verify-slice.md`, `merge-track.md`, `merge-release.md` — the slash commands that operate the model.

This file is retained only so historical references (older release journals, this doc's old links) do not dangle.

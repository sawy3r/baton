---
title: Release Mode — slice-scoped remote ref
description: Implementer sessions push every commit to origin/release/slice/<slice-id> so in-session work survives a rebase of the shared integration branch. Cheap recovery anchor, no worktree ceremony.
---

# Release Mode — slice-scoped remote ref

This is a release-mode operational tactic, not a rule. It expands one step of `role-prompts/implementer.md` and is referenced from `/implement-slice`. It applies only when multi-agent slice workflow (Rules 6 + 7) is in play.

## The failure mode

Implementer sessions run on the shared integration branch (`release/v*`). The branch is *active* — other implementer / planner / verifier sessions, automated jobs, and the human may all advance, rebase, or reset it during your session. When that happens:

- Your in-session commits can be lost if a force-rebase under you rewrites the branch.
- `git reflog` recovery works *for you on this machine*, but is invisible to any other session that needs to pick up the slice.
- Untracked new files survive (they're not in any commit), but edits to tracked files roll back to whatever the integration branch now points at.

This is not a hypothetical. It was observed during slice S03 of release `2026-05-16-encryption-posture-migration-baselines-and-scenarios`: the `start implementation` commit was rewritten away mid-session and four tracked-file edits had to be re-applied from scratch.

## The convention

After every commit on a slice, push HEAD to a slice-scoped remote ref:

```
git push origin HEAD:refs/heads/release/slice/<slice-id>
```

Properties of this ref:

- **Write-only.** Implementers push to it but never `checkout` it locally. It cannot accidentally become "the branch I'm on" and cause its own drift.
- **One per slice.** The slice ID is unique inside a release; collision across releases is possible but cheap to disambiguate by including the release name if needed.
- **Fast-forward only.** Each commit on the slice is an ancestor of the next, so the push is always a fast-forward. No `--force` required, no history rewrites.
- **Cleanup is manual.** After the slice is verified and merged, delete the ref with `git push origin --delete release/slice/<slice-id>`. The slice's history is preserved in the merged commits on the integration branch; the ref is no longer load-bearing.

## Recovery

If on session start (or mid-session) you discover that commits you remember making are not in `git log`, recover with:

```
git fetch origin
git reset --hard origin/release/slice/<slice-id>
```

If the integration branch has since advanced past your work, rebase your recovered slice work onto the new integration HEAD:

```
git rebase origin/release/v<version>
git push --force-with-lease origin HEAD:refs/heads/release/slice/<slice-id>
```

`--force-with-lease` is safe because the slice ref is yours alone for the duration of the slice — no other session is writing to it.

## Why this and not worktrees

The slice-ref convention and `git worktree` solve adjacent but distinct problems:

| Failure mode | Slice ref | Worktree |
|---|---|---|
| Force-rebase of integration branch wipes your commits | Solves (recovery anchor on origin) | Solves (your worktree's HEAD is independent) |
| Two implementer sessions race on the same working tree | Does **not** solve | Solves (separate filesystem paths, separate HEADs) |
| `git stash` from another session collides with yours | Does **not** solve | Solves |
| Ceremony cost | One push per commit | Separate folder per slice + prune step |

If sequential implementer sessions are the norm and the failure mode is rebase-related, the slice ref is sufficient. If parallel implementer sessions are routine, layer worktrees on top — they are not mutually exclusive.

## What this does not address

- **Concurrent in-tree edits.** Two implementer sessions on the same checkout will still clobber each other's index and working tree state. Use worktrees for that.
- **Lost untracked files.** Files that never reached the index (the screenshot you took, the scratch script you wrote) are not protected. Only commits are.
- **Remote unavailability.** If origin is down or unreachable, the push silently fails to provide protection. Implementer sessions running offline should fall back to a worktree.

## When to push

- After the `start implementation` commit (the first checkpoint).
- After every subsequent commit during the session, including documentation-only commits.
- Before any local action you suspect might be destructive (`git rebase`, `git reset`, recovering a stash, switching branches).

The push is cheap (a fast-forward on a tiny ref) and the cost of forgetting is the failure mode this whole page exists to prevent. Bias toward over-pushing.

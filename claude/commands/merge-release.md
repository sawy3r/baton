---
description: Merge a completed release's release-wt/<name> branch back into the integration branch. Hard-gates on every slice being verified. Does NOT push, delete the branch, or remove the worktree — those stay explicit. Usage: /merge-release <release-name>
argument-hint: <release-name> (e.g. 2026-05-16-expenses-ia)
---

You are now operating in the **Release Integrator role** for release `$1`. This command merges `release-wt/$1` back into the integration branch named in the release `index.md`. It is a deliberate, gated step — not "shipping" (shipping means code in prod; this only integrates verified work onto the base branch awaiting the next prod deploy).

**Vocabulary, locked:**
- "merge" = `release-wt/$1` → integration branch (this command).
- "ship" = the integration branch deploys to production (out of scope for this command; happens via your existing release pipeline).
- A slice stays in `verified` state through merge; it transitions to `shipped` only when the integration branch deploys. See memory `feedback_slice_shipped_means_prod`.

## Step 0 — Run from the primary worktree

This command runs in the **primary worktree** (`<REPO_ROOT>`), not the release worktree. Reasoning: the merge target is the integration branch, which the primary worktree owns; the release worktree owns the source branch.

1. Confirm cwd is the primary worktree (`git rev-parse --show-toplevel` returns `<REPO_ROOT>` or equivalent — i.e. the path matches `git worktree list --porcelain | awk '/^worktree/ {print $2; exit}'`, which is git's authoritative primary).
2. Confirm working tree is clean (`git status --short` returns nothing). If not, BLOCK with: "Working tree has uncommitted changes. Commit, stash, or revert before merging — see memory `feedback_parallel_agent_commit_sweep` and `feedback_git_add_sweeps_prestaged` for why a clean tree matters on shared release branches."

## Step 0.5 — Discover the release worktree from git, not docs

Documentation drifts; `git worktree list` is the ground truth. Resolve `<worktree_branch>` and `<worktree_path>` by pattern-matching the release name against git's worktree registry. The defined format is **`release-wt/$1`** for the branch and a sibling worktree path checked out on that branch.

1. Run `git worktree list --porcelain` and scan for a stanza whose `branch` line ends in `refs/heads/release-wt/$1`. Capture its `worktree <path>` line as `<worktree_path>` and `release-wt/$1` as `<worktree_branch>`.
2. If no matching stanza, fall back to `docs/release/$1/index.md` frontmatter (`worktree_path` + `worktree_branch`). Treat any mismatch between the two sources as docs drift — git wins; record the divergence in your Step 4 board update.
3. If neither source produces a result, BLOCK with: "Release `$1` has no `release-wt/$1` worktree registered with git and no recorded worktree in `docs/release/$1/index.md`. Nothing to merge — either no implementation happened, or this release was abandoned."
4. Confirm current branch is the release's integration branch. The integration branch is parsed from `docs/release/$1/index.md` "Release summary" → `Target version / integration branch`. If on a different branch, BLOCK with: "/merge-release must run on the integration branch `<integration>`. Switch to it and re-run."
5. `git fetch origin` and confirm the integration branch is at or ahead of `origin/<integration>`. If behind, BLOCK with: "Local `<integration>` is behind origin. Run `git pull --ff-only origin <integration>` and re-run."

## Step 1 — Read release state

1. **Read `status.json` for every slice from the worktree branch, not from the primary checkout.** Per-slice `state` transitions (`verified`, `implemented`, `failed_verification`) are committed by `/verify-slice` and `/implement-slice` onto `release-wt/$1`. Until this merge happens, the integration-branch copies of `status.json` are stale and will false-BLOCK an otherwise-mergeable release. Authoritative source = head of `<worktree_branch>`. Either:
   - `cd <worktree_path>` and read each `docs/release/$1/<slice>/status.json` from there, **or**
   - From the primary worktree, `git show <worktree_branch>:docs/release/$1/<slice>/status.json` for each slice.
2. Enumerate every slice folder by listing `<worktree_branch>`'s tree (`git ls-tree -d --name-only <worktree_branch>:docs/release/$1/`). Folder set on the integration branch can lag (newly-split slices, e.g. an S06 → S06a/b/c split, exist only on the worktree branch until merge). For each folder, capture `state` from the worktree-branch copy.
3. Build a state table. Every slice must be in one of these terminal-or-acceptable states:
   - `verified` — OK to merge
   - `deferred` — explicitly excluded from this release; OK
   - `superseded` — slice replaced by a re-spec; OK (folder retained for journal continuity)
   - `shipped` — already merged + deployed via a prior pathway; OK (rare)
   - Any other state (`planned`, `in_progress`, `implemented`, `failed_verification`) — BLOCK.
4. If any slice is in a blocking state, return: `BLOCKED: cannot merge release '$1' — the following slices are not verified: <list>. Each must complete /verify-slice with PASS before /merge-release.` Do not proceed. **Before returning BLOCKED, double-check you read from the worktree branch — the most common false-block is reading stale integration-branch status files.**

## Step 1.5 — Integration drift gate

Long-lived release worktrees diverge from their integration branch every time a sibling release merges first. A `git merge` that has to resolve sibling-release conflicts at integration time has no context for them — those conflicts belong in the release worktree, owned by the release author.

1. Run `git rev-list --count <worktree_branch>..<integration>`. If the count is `0`, proceed to Step 2.
2. If the count is non-zero, BLOCK with:

   > Integration branch `<integration>` has advanced N commits since `<worktree_branch>` was last synced. The merge will conflict on shared files (typical: validation/projection code that sibling releases also touch).
   >
   > Forward-merge integration into the release worktree first, so conflicts are resolved with full release context:
   >
   > ```
   > cd <worktree_path>
   > git fetch origin && git merge <integration>
   > # resolve any conflicts, run the release's test commands, commit
   > ```
   >
   > Then re-run `/merge-release $1` from the primary worktree.

   List the first 5 commits driving the drift (`git log --oneline <worktree_branch>..<integration> | head -5`) so the human can scan what's being absorbed.

## Step 2 — Confirm scope with the human

Print a short merge plan and ask `AskUserQuestion` to confirm before merging:

- Release name + integration branch + worktree branch.
- Slice state breakdown ("N verified, M deferred").
- The first 5 commits on `<worktree_branch>` not in `<integration>` (`git log --oneline <integration>..<worktree_branch> | head -5`).
- Total commit count diff (`git rev-list --count <integration>..<worktree_branch>`).

Question: "Merge `<worktree_branch>` into `<integration>` now?" Options: "Yes, merge" / "No, abort". If aborted, exit cleanly.

## Step 3 — Perform the merge

1. `git merge --no-ff <worktree_branch> -m "<merge message>"` where the merge message is:

   ```
   chore(<integration>): merge release/$1 — N slices verified, M deferred

   Release goal (from intake): <one-line from index.md "Goal" bullet>

   Slices merged:
   - <slice-id-1>: <one-line user outcome from spec.md>
   - <slice-id-2>: ...
   (one line per verified slice, with their user outcome)

   Deferred (not in this release):
   - <slice-id>: <one-line reason>

   Slices stay in state 'verified' until the integration branch ships to
   production. See memory feedback_slice_shipped_means_prod.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```

2. If the merge has conflicts, abort: `git merge --abort`. BLOCK with: "Merge of `<worktree_branch>` into `<integration>` conflicted on: <list>. Resolve in the release worktree first (rebase `release-wt/$1` onto `<integration>`), then re-run /merge-release."

## Step 4 — Update the release board

Append to `docs/release/$1/index.md` "Recent activity" section:

```markdown
### YYYY-MM-DD — release merged to <integration> (commit <SHA>)

- **Actor**: release integrator (/merge-release)
- **Note**: N verified slices merged. Slices remain in `verified` state until <integration> ships to production; at that point each slice's `status.json` flips to `shipped`. Branch `<worktree_branch>` retained; remove with `git branch -D <worktree_branch>` once you're sure no more work belongs to this release.
```

Commit on the integration branch: `docs(release/$1): record merge to <integration>`.

## Step 5 — Hand off

Tell the human, in one short message:

- Merge commit SHA.
- Reminder to push when ready: `git push origin <integration>`.
- Reminder that the release worktree at `<worktree_path>` and the branch `<worktree_branch>` are retained — clean up with `git worktree remove <worktree_path>` and `git branch -D <worktree_branch>` once you're sure no more slices will land. Both are destructive and so the command does not do them automatically.
- Confirm slices stay in `verified` state until the integration branch deploys; flip to `shipped` then.

## Strict role boundaries

- Do not push. Pushing is a network action the human triggers explicitly.
- Do not delete `release-wt/$1` or remove its worktree. Both are destructive and may need access for a post-merge fix (e.g. a hot-patch slice landing later that wants the same worktree).
- Do not flip slice states to `shipped`. Shipping = code in prod; this command only integrates code onto the base branch.
- Do not invoke `/plan-release`, `/implement-slice`, or `/verify-slice` from this session. Single-purpose: just the merge.

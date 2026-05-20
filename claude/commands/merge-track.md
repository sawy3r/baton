---
description: Merge a completed track's track/<release>/<track-id> branch into the release assembly branch release-wt/<release>. Hard-gates on every slice in the track being verified. Does NOT push or delete the branch/worktree. Usage: /merge-track <track-id> [<release-name>]
argument-hint: <track-id> [<release-name>] (e.g. T1-identity-account 2026-05-19-uat-bug-fix)
---

You are operating in the **Track Integrator role** for track `$1` in release `$2`. This command merges `track/$2/$1` into the release assembly branch `release-wt/$2`. It is a gated step in **track mode** — read `$HOME/.claude/baton/track-mode.md` first.

**Release artefact root:** All paths in this command are repo-relative and anchored at `docs/release/$2/`. If your project renders docs from a different location (e.g. Fumadocs at `apps/docs/content/docs/`), create a `docs/` symlink to that path before running the harness. When a symlink is in use, prefer the canonical (non-symlinked) target for `git add` / `git mv` / `git rm` — git refuses to stage paths "beyond a symbolic link".

**Vocabulary, locked:**
- "merge a track" = `track/$2/$1` → `release-wt/$2` (this command).
- "merge a release" = `release-wt/$2` → version integration branch (`/merge-release`).
- "ship" = the version branch deploys to production (neither command does this).

## Step 0 — Run inside the release worktree

The merge target is `release-wt/$2`, which the release worktree owns.

1. If `$2` is empty, find the release: search `docs/release/*/index.md` frontmatter for a `tracks:` entry with `id: $1`.
2. Read `docs/release/$2/index.md` frontmatter. Capture `release_worktree_path` and `release_worktree_branch` (= `release-wt/$2`). If `release_worktree_path` is unset, BLOCK: "Release `$2` has no release worktree — nothing has been implemented yet."
3. Confirm via `git worktree list` that the release worktree exists at `release_worktree_path` on `release-wt/$2`. If absent, BLOCK with the `git worktree add` recreate command.
4. For the rest of this session every git/file operation runs against `<release_worktree_path>` via `git -C` and absolute paths. Confirm its working tree is clean (`git -C <release_worktree_path> status --short` empty); if not, BLOCK.

## Step 1 — Locate the track and gate on verification

1. From `index.md` frontmatter `tracks:`, capture the entry `id: $1` — its ordered `slices`, `worktree_branch` (= `track/$2/$1`), `depends_on`, `state`. If no such track, BLOCK.
2. If the track's `state` is already `merged`, BLOCK: "Track `$1` is already merged."
3. If `depends_on` names another track whose `state` is not `merged`, BLOCK: "Track `$1` depends on `<other>` (state `<state>`) — merge that track first."
4. **Verification gate.** For every slice in the track, read its `status.json` `state` from the **track branch** — `git -C <release_worktree_path> show track/$2/$1:docs/release/$2/<slice>/status.json` — because the verifier's commits land on the track branch, not on `release-wt`. Every slice must be `verified` (or `deferred` / `superseded`). If any is `planned` / `in_progress` / `implemented` / `failed_verification`, BLOCK: "Cannot merge track `$1` — not verified: <list>. Each must complete /verify-slice with PASS first."

## Step 2 — Drift gate

1. `git -C <release_worktree_path> rev-list --count track/$2/$1..release-wt/$2`. If `0`, proceed to Step 3.
2. If non-zero, `release-wt/$2` has advanced since the track branched (a sibling track merged first). BLOCK with:

   > `release-wt/$2` has advanced N commits since track `$1` branched. Forward-merge it into the track worktree first so any reconciliation happens with track context:
   >
   > ```
   > cd <track-worktree-path>
   > git fetch origin && git merge release-wt/$2
   > # resolve any index.md reconciliation, re-run the track's tests, commit
   > ```
   >
   > Then re-run `/merge-track $1 $2`.

   List the first 5 driving commits (`git log --oneline track/$2/$1..release-wt/$2 | head -5`). By the touchpoint-disjointness invariant the forward-merge is conflict-free on code — expect at most an `index.md` reconciliation.

## Step 3 — Confirm scope with the human

`AskUserQuestion`: show release, track id, branch, the verified slice list, and the commit count (`git rev-list --count release-wt/$2..track/$2/$1`). Question: "Merge `track/$2/$1` into `release-wt/$2`?" Options: "Yes, merge" / "No, abort". If aborted, exit cleanly.

## Step 4 — Perform the merge

`git -C <release_worktree_path> merge --no-ff track/$2/$1 -m "<message>"` where the message is:

```
Merge track $1 into release-wt/$2 — N slices verified

Track: $1
Slices merged (all verified):
- <slice-id>: <one-line user outcome from spec.md>
...

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Conflict handling — the touchpoint matrix is the contract.** By invariant 2 of track-mode.md, code and test files cannot conflict between disjoint tracks. Therefore:

- If `git diff --name-only --diff-filter=U` shows **only** the release `index.md`: this is the expected board reconciliation. The per-slice rows and per-track rows are disjoint and auto-merge; only the **Aggregate state** block and the **Recent activity** log collide. Resolve by keeping both sides' rows, unioning the Recent activity entries chronologically, and recomputing the Aggregate state counts. `git add` `index.md` and complete the merge.
- If **any other file** conflicts: `git merge --abort` and BLOCK: "Merge of track `$1` conflicted on <files>. These are not `index.md`, so the touchpoint matrix was wrong — track `$1` and a sibling track both wrote <file>. Return to `/plan-release $2` (or `/replan-release $2`) to re-group the tracks before merging. (track-mode.md invariant 4.)"

## Step 5 — Update the board

On `release-wt/$2` (in the release worktree), update `docs/release/$2/index.md`:

- Set the track's `state: merged` — both the `tracks:` frontmatter entry and the Tracks table row.
- Recompute the **Aggregate state** block (slice counts + the track counts line).
- Add a **Recent activity** entry:

  ```markdown
  ### YYYY-MM-DD — track `$1` merged to release-wt (commit <SHA>)

  - **Actor**: track integrator (/merge-track)
  - **Note**: N verified slices merged: <slice-id list>. Track state -> merged.
  ```

Commit on `release-wt/$2`: `docs(release/$2): record track $1 merge to release-wt`.

## Step 6 — Hand off

Tell the human, in one short message:

- Merge commit SHA; track `$1` state is now `merged`.
- Remaining unmerged tracks (`index.md` `tracks:` entries with `state != merged`), each with its verified/total slice count.
- If every track is now `merged`: "All tracks merged — run `/merge-release $2` to integrate the release into the version branch."
- Reminder: this command did **not** push, and did **not** delete `track/$2/$1` or its worktree (both retained for any post-merge fix). Push `release-wt/$2` when ready; remove the track worktree with `git worktree remove <track-worktree-path>` once you are sure no more work belongs to the track.

## Strict role boundaries

- Do not push. Network actions are the human's to trigger.
- Do not delete the track branch or its worktree — both are destructive and may be needed for a post-merge fix.
- Do not merge `release-wt` into the version branch — that is `/merge-release`.
- Do not flip slice states to `shipped` — shipping is a production deploy, not an integration step.
- Do not invoke `/plan-release`, `/replan-release`, `/implement-slice`, or `/verify-slice`. Single-purpose: just the track merge.

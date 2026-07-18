---
description: Merge a completed release's release-wt/<name> branch back into the integration branch. Hard-gates on every track having passed track-mode's canonical integration-ready slice gate and merged to release-wt. Does NOT push, delete the branch, or remove the worktree — those stay explicit. Usage: /merge-release <release-name>
argument-hint: <release-name> (e.g. 2026-05-20-billing-redesign)
---

You are now operating in the **Release Integrator role** for release `$1`. This command merges `release-wt/$1` back into the integration branch named in the release `board.json`. It is a deliberate, gated step — not "shipping" (shipping means code in prod; this only integrates verified work onto the base branch awaiting the next prod deploy).

**Vocabulary, locked:**
- "merge a track" = `track/$1/<track-id>` → `release-wt/$1` (via `/merge-track` — a prerequisite for this command; every track must be merged before the release can be).
- "merge a release" = `release-wt/$1` → integration branch (this command).
- "ship" = the integration branch deploys to production (out of scope for this command; happens via your existing release pipeline).
- A slice stays in `verified` state through both merges; it transitions to `shipped` only when the integration branch deploys. See memory `feedback_slice_shipped_means_prod`.

Release work runs under **track mode** — see `$HOME/.claude/baton/track-mode.md`. By the time `/merge-release` runs, every track has already been merged into `release-wt/$1` by `/merge-track`; this command is the final hop to the version branch.

## Step 0 — Run from the primary worktree

This command runs in the **primary worktree** (`<REPO_ROOT>`), not the release worktree. Reasoning: the merge target is the integration branch, which the primary worktree owns; the release worktree owns the source branch.

1. Confirm cwd is the primary worktree (`git rev-parse --show-toplevel` returns `<REPO_ROOT>` or equivalent — i.e. the path matches `git worktree list --porcelain | awk '/^worktree/ {print $2; exit}'`, which is git's authoritative primary).
2. Confirm working tree is clean (`git status --short` returns nothing). If not, BLOCK with: "Working tree has uncommitted changes. Commit, stash, or revert before merging — see memory `feedback_parallel_agent_commit_sweep` and `feedback_git_add_sweeps_prestaged` for why a clean tree matters on shared release branches."

## Step 0.5 — Discover the release worktree from git, not docs

Documentation drifts; `git worktree list` is the ground truth. Resolve `<worktree_branch>` and `<worktree_path>` by pattern-matching the release name against git's worktree registry. The defined format is **`release-wt/$1`** for the branch and a sibling worktree path checked out on that branch.

1. Run `git worktree list --porcelain` and scan for a stanza whose `branch` line ends in `refs/heads/release-wt/$1`. Capture its `worktree <path>` line as `<worktree_path>` and `release-wt/$1` as `<worktree_branch>`.
2. If no matching stanza exists, BLOCK with: "Release `$1` has no
   `release-wt/$1` worktree registered with git. Nothing to merge — either no
   implementation happened, the worktree was removed prematurely, or this
   release was abandoned." `board-v1` deliberately stores no worktree path or
   branch fallback.
3. Confirm current branch is the release's integration branch. The integration branch is read from `docs/release/$1/board.json` `release.integration_branch`. If on a different branch, BLOCK with: "/merge-release must run on the integration branch `<integration>`. Switch to it and re-run."
4. `git fetch origin` and confirm the integration branch is at or ahead of `origin/<integration>`. If behind, BLOCK with: "Local `<integration>` is behind origin. Run `git pull --ff-only origin <integration>` and re-run."

## Step 1 — Read release state via the board oracle

Run the **board oracle** (reference implementation: `sworn board --json`) from the primary worktree. It resolves every slice's `status.json` and the `tracks` board straight from the `release-wt/$1` and `track/$1/*` **git refs** — the per-slice `state` transitions that `/verify-slice` and `/implement-slice` commit onto the track branches, which the integration-branch copies do not yet carry. This is exactly the "read from the worktree branch, not the stale primary checkout" rule, done mechanically — the most common false-BLOCK (reading stale integration-branch `status.json`) is structurally impossible. It also discovers slice folders that exist only on a track branch (e.g. an `S06 → S06a/b/c` split not yet on the integration branch). Do not read `status.json` or `board.json` by hand. Two distinct failures, two distinct remedies — do not conflate them. If the oracle command is **not on PATH**, BLOCK: "no Baton engine installed — Release Mode requires a conformant engine (reference implementation: `go install github.com/swornagent/sworn/cmd/sworn@latest`)." If the oracle **is installed but exits non-zero**, it ran and could not resolve the board: BLOCK with the engine's own stderr verbatim — "board oracle failed: `<stderr>`" — and do NOT advise installing or repairing the engine, or paraphrase its error.

Before any gate below, apply track-mode's full projection integrity gate to
`.releases["$1"]`. Duplicate track/slice ids, a row whose `track` disagrees with
its enclosing track, inconsistent normalized dependencies within a track, or a
release-key mismatch BLOCK as malformed oracle output.

1. **Slice gate.** Flatten the nested
   `.releases["$1"].tracks[] | (.slices // [])[]` rows into a state table and validate each complete
   `status.json` from `release-wt/$1`. Every slice must satisfy track-mode's canonical
   integration-ready predicate:
   - `verified` / `shipped` — OK to merge.
   - `deferred` with null `start_commit`, the empty pending cycle-0 maintainability template, and a
     non-empty Rule-2-complete deferral — unstarted scope excluded from this release; OK.
   - `deferred` with terminal `re_slice_required` — OK only when its recorded rollback is
     `verified` / `shipped` and the originating `/merge-track` provenance contains the applicable
     passing tree-equality gate.
   - started `deferred` with `retirement.disposition: protocol_history_invalid` — OK only when the
     embedded track integration proves every immutable invalid-history record uses its owner's exact
     path and parsed slice/release identity and lies strictly on owner first-parent history. The
     fresh Verifier BLOCKED status must be duplicate-free, historical-schema-valid, strictly before
     retirement, and preserve exact commit/path/blob identities and typed-evidence equality. Missing
     or non-object typed evidence fails deterministically without dereference, alongside byte-preserved maintainability
     value in qualifying `passed` state with a concrete PASS-pinned implementation head,
     verified/shipped mandatory rollback, and distinct strict first-parent chronology from retirement
     through rollback first status and verdict to replacement start. Each referenced replacement
     start itself must occur on the evaluated owner tip's first-parent history. Ordinary ancestry or equality,
     sequential ordering, and
     complete-envelope equality to the original `start_commit` tree. Recompute these from embedded
     track ancestry; do not trust only current states.
   - Any other state (`planned`, `in_progress`, `implemented`, `failed_verification`) — BLOCK.

   `superseded` is not a `slice-status-v1` state and never passes. If any slice is not ready, return:
   `BLOCKED: cannot merge release '$1' — the following slices are not integration-ready: <list>.`
   Do not proceed.
2. **Track merge gate.** For every `.releases["$1"].tracks[].id`, derive the
   track branch as `track/$1/<track-id>` and run
   `git merge-base --is-ancestor track/$1/<track-id> release-wt/$1`. A missing
   track ref or non-zero result means `/merge-track` has not integrated that
   track and its commits would be silently omitted. Do not use the oracle's
   display-oriented track `state` as the merge signal and do not require an
   optional `readyToMerge` field. If any track is not merged, BLOCK: `cannot
   merge release '$1' — these tracks are verified but not yet merged to
   release-wt: <list>. Run /merge-track <track-id> $1 for each before
   /merge-release.`
3. **Assembly gate (Rule 10 assembly stage).** Read `docs/release/$1/assembly-proof.json` from the `release-wt/$1` ref (`git show release-wt/$1:docs/release/$1/assembly-proof.json`). Three outcomes:
   - **Present with a passing verdict** — the release is `assembled`; note it in the Step 2 scope summary.
   - **Present with a failing verdict** — BLOCK: `cannot merge release '$1' — assembly run failed: <failing suites/observations from the proof>. Fix and re-run the assembly stage (reference implementation: sworn assemble) before /merge-release.` A recorded failing assembly is a hard stop regardless of per-slice states.
   - **Absent** — advisory (skew-window policy, baton#59): surface in the Step 2 scope summary as `WARNING: release '$1' has no assembly-proof.json — the assembled system has not been machine-walked end-to-end; per-slice verification cannot see cross-slice wire seams (CORS/middleware class). Proceed only if the human accepts the risk explicitly.` This flips to a hard BLOCK when the reference implementation (`sworn assemble`) ships.
4. **Planning-record integrity.** If the engine exposes optional top-level
   `.ghostSlices` or `.pendingSpecs` diagnostics for release `$1`, surface them
   in the Step 2 scope summary. Their absence is not an oracle-contract failure;
   malformed or missing records encountered while validating the nested track
   slices still fail through the normal record gates.

## Step 1.5 — Forward-merge the integration branch into the release worktree

Base drift is the normal state, not the exception. A long-lived release worktree falls behind `<integration>` every time a sibling release merges first, or a fix lands directly on the integration branch. The release worktree branch **must absorb `<integration>` before it can merge back** — otherwise the Step 3 merge resolves integration-side conflicts with no release context, in the wrong worktree, owned by the wrong role.

So the forward-merge is a routine prerequisite of `/merge-release`, not a failure mode. This step performs it for you when it is **conflict-free** (the common case), and BLOCKs to the release author **only when the forward-merge genuinely conflicts** and needs release context to resolve. The gate is conflict-presence, not drift-presence: drift alone is expected and safe to absorb mechanically.

1. Run `git rev-list --count <worktree_branch>..<integration>`. If the count is `0`, the worktree branch is already current — skip to Step 2.
2. Otherwise, list what will be absorbed: `git log --oneline <worktree_branch>..<integration>`. Report the count and the commits to the human so the forward-merge is never silent — a forward-merge commit is a real change to the release branch.
3. Confirm the release worktree's tree is clean: `git -C <worktree_path> status --short` returns nothing. If it is dirty, BLOCK with: "Release worktree `<worktree_path>` has uncommitted changes; the forward-merge needs a clean tree. Commit, stash, or revert there, then re-run /merge-release."
4. Perform the forward-merge **in the release worktree**, without leaving the primary worktree, using `git -C`:

   ```
   git -C <worktree_path> merge <integration> --no-ff \
     -m "chore(release-wt/$1): forward-merge <integration> before /merge-release"
   ```

5. **Conflict-free (exit 0) — the common case.** The worktree branch now contains `<integration>`. This is a mechanical, judgement-free sync; proceed to Step 2. In the Step 2 scope summary and the Step 5 handoff, state explicitly that a forward-merge commit was created on `<worktree_branch>` and list the absorbed commits. If any absorbed commit touches application code (not only docs / governance files), call that out in Step 2 so the human can choose to run the release's test suite before approving the merge.
6. **Conflicted — routes to the release author.** Abort the attempt (`git -C <worktree_path> merge --abort`) and BLOCK with:

   > Forward-merging `<integration>` into `<worktree_branch>` conflicts on: `<conflicted files>`. These conflicts must be resolved in the release worktree, by the release author, with full release context — the integrator role has none.
   >
   > ```
   > cd `<worktree_path>`
   > git merge `<integration>`
   > # resolve the conflicts, run the release's test commands, commit
   > ```
   >
   > Then re-run `/merge-release $1` from the primary worktree.

   When the conflict is in agent-discipline / harness files, a sibling fix on `<integration>` and one of this release's slices are often *adjacent fixes to the same area* — both sets of changes must survive the resolution; neither automatically supersedes the other. Name the overlapping files so the release author knows where to look.

## Step 2 — Confirm scope with the human

Print a short merge plan and ask `AskUserQuestion` to confirm before merging:

- Release name + integration branch + worktree branch.
- Slice state breakdown ("N verified, M deferred").
- Assembly status from Step 1 gate 3: `assembled` (passing proof), or the no-assembly-proof WARNING verbatim.
- If Step 1.5 created a forward-merge commit, say so: name the commit, list the commits it absorbed, and flag whether any of them touched application code (vs docs / governance files only).
- The first 5 commits on `<worktree_branch>` not in `<integration>` (`git log --oneline <integration>..<worktree_branch> | head -5`).
- Total commit count diff (`git rev-list --count <integration>..<worktree_branch>`).

Question: "Merge `<worktree_branch>` into `<integration>` now?" Options: "Yes, merge" / "No, abort". If aborted, exit cleanly.

## Step 3 — Perform the merge

1. `git merge --no-ff <worktree_branch> -m "<merge message>"` where the merge message is:

   ```
   chore(<integration>): merge release/$1 — N slices verified, M deferred

   Release goal (from intake): <one-line release goal from board.json>

   Slices merged:
   - <slice-id-1>: <one-line user outcome from spec.json>
   - <slice-id-2>: ...
   (one line per verified slice, with their user outcome)

   Deferred (not in this release):
   - <slice-id>: <one-line reason>

   Slices stay in state 'verified' until the integration branch ships to
   production. See memory feedback_slice_shipped_means_prod.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```

2. Step 1.5 has already pulled `<integration>` into `<worktree_branch>`, so this merge should apply cleanly. If it nonetheless conflicts, the integration branch advanced *again* between Step 1.5 and here (a sibling release or direct fix landed mid-command). Abort: `git merge --abort`. BLOCK with: "Merge of `<worktree_branch>` into `<integration>` conflicted on: `<list>` despite the Step 1.5 forward-merge — `<integration>` advanced again mid-command. Re-run /merge-release $1 so Step 1.5 re-syncs the new drift."

## Step 4 — Re-render the release view

Leave `docs/release/$1/board.json` byte-identical: it is the state-free release
plan, and the release merge commit is the durable integration activity record.
Validate the unchanged board against `board-v1`, then re-render `index.md` from
the board plus the now-integrated authoritative `status.json` records and
ref-derived track state. If the rendered bytes change, commit only `index.md` on
the integration branch as `docs(release/$1): re-render board — merged to
<integration>`. If they do not change, do not create an empty metadata commit.

## Step 5 — Hand off

Tell the human, in one short message:

- Merge commit SHA.
- Reminder to push when ready: `git push origin <integration>`.
- Reminder that the release worktree at `<worktree_path>` and the branch `<worktree_branch>` are retained — clean up with `git worktree remove <worktree_path>` and `git branch -D <worktree_branch>` once you're sure no more slices will land. Both are destructive and so the command does not do them automatically.
- Confirm slices stay in `verified` state until the integration branch deploys; flip to `shipped` then.

## Strict role boundaries

- The Step 1.5 forward-merge **is in scope** — but only when it is conflict-free. A conflict-free forward-merge is a mechanical sync the integrator may perform; a *conflicting* forward-merge is conflict resolution, which needs release context the integrator does not have, so it routes to the release author. Never resolve forward-merge conflicts yourself.
- Do not push. Pushing is a network action the human triggers explicitly. This includes the Step 1.5 forward-merge commit on `<worktree_branch>` — it stays local until the human pushes.
- Do not delete `release-wt/$1` or remove its worktree. Both are destructive and may need access for a post-merge fix (e.g. a hot-patch slice landing later that wants the same worktree).
- Do not flip slice states to `shipped`. Shipping = code in prod; this command only integrates code onto the base branch.
- Do not invoke `/plan-release`, `/implement-slice`, or `/verify-slice` from this session. Single-purpose: just the merge.

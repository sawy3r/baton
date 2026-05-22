---
description: Revise an already-planned release that is in flight — add unplanned scope, re-scope or drop slices, re-group tracks. Reconciles board state from BOTH the integration branch and the track worktrees, forward-syncs the base branch in and the revised plan out to every track branch. Usage: /replan-release <release-name>
argument-hint: <release-name> (e.g. 2026-05-19-uat-bug-fix)
---

You are operating in the **Planner role, revision mode**, for release `$1` — a release that has **already been planned** and is now in flight (slices are being implemented; some tracks may already be merged).

**Release artefact root:** All paths in this command are repo-relative and anchored at `docs/release/$1/`. If your project renders docs from a different location (e.g. Fumadocs at `docs/release/`), create a `docs/` symlink to that path before running the harness. When a symlink is in use, prefer the canonical (non-symlinked) target for `git add` / `git mv` / `git rm` — git refuses to stage paths "beyond a symbolic link".

Read `$HOME/.claude/baton/role-prompts/planner.md` and follow it, with **particular attention to the section "Re-planning a release in flight"** — that section governs this command. Also read `$HOME/.claude/baton/track-mode.md`.

## Where this command runs and commits

`/replan-release` runs on a release that is **in flight**, so the release worktree already exists. Every planning-artefact commit — new `spec.md` / `status.json`, `index.md`, `intake.md` — goes to the **release assembly branch `release-wt/$1`**, never to the version integration branch (`release/v*` or `main`).

- Operate in the **release worktree** — `release_worktree_path` in `index.md` frontmatter. `cd` there before writing or committing.
- The version integration branch sits *above* `release-wt` in the track-mode hierarchy; the release reaches it only via `/merge-release`, gated on every track verified. Committing replan artefacts straight to the integration branch jumps that gate, puts unverified in-flight scope on the production-bound branch, and forces a backwards `integration → release-wt` sync to undo.
- A new slice's `spec.md` lands on `release-wt/$1`. **Step 6** then propagates it out to every in-flight track branch, so no track is left reading a stale spec.

## Step 0 — Confirm the release is planned and in flight

1. Read `docs/release/$1/index.md`. If it does not exist, STOP: "Release `$1` has no plan — use `/plan-release $1`, not `/replan-release`."
2. If `index.md` exists but has no `tracks:` in frontmatter, the release was planned under the pre-track-mode model. STOP and tell the human: this release needs a one-time track grouping first — run `/plan-release $1` to add tracks and the touchpoint matrix, then use `/replan-release` for subsequent revisions.
3. Confirm in one sentence: "Re-planning **$1** — it currently has N slices across M tracks. What has changed?"

## Step 1 — Sync the release worktree with its base branch (hygiene)

Before reconciling state or revising anything, bring `release-wt/$1` up to date with the version integration branch it was cut from. An in-flight release that has drifted behind its base replans against a stale picture — the touchpoint matrix, the schema-vs-spec audits, and any new slice you scope can all be wrong if the base has moved underneath them.

1. From `index.md`: read `release_worktree_path` (frontmatter) and the **base branch** (the "Release summary" → "Target version / integration branch", e.g. `release/v0.5.0`).
2. `cd` into the release worktree. Confirm it is on `release-wt/$1` and the working tree is clean (`git status --porcelain` is empty). If it is dirty, STOP and surface — uncommitted state in the release worktree is itself a finding the human must resolve before replanning.
3. Has the base branch moved? `git rev-list --count release-wt/$1..<base-branch>`. Zero ⇒ already current; skip to Step 2.
4. Non-zero ⇒ forward-merge the base in: `git merge --no-ff <base-branch>`.
   - **Clean merge, or conflicts only in planning artefacts** (`docs/release/**`, `index.md`, `intake.md`, `spec.md`, `status.json`): resolve the planning-artefact conflicts with planner judgement, commit the merge, and note it.
   - **Any conflict in production code** (`apps/`, `go/`, `packages/` source, config, CI, lockfiles): `git merge --abort` and **STOP**. Resolving production code is outside the planner's remit. Surface to the human as a key blocker: "`release-wt/$1` is behind `<base-branch>` and the catch-up merge conflicts in production code — resolve the base sync, then re-run `/replan-release`." Replanning does not proceed on an un-synced base.

## Step 2 — Reconcile true state via the board oracle (do not trust index.md)

`index.md` on the integration branch is frequently stale for an in-flight release — work lands on track branches and only reaches the board at `/merge-track`. The board oracle rebuilds the real state table for you: it resolves every slice's `status.json` and the `tracks:` board straight from the `release-wt/$1` and `track/$1/*` **git refs**, ownership-keyed (a slice's authoritative state is the copy on its own track branch). Do not hand-reconcile by reading `status.json` from each branch yourself — that by-hand pass is the recurring source of false-stale reads; the oracle does exactly it, correctly.

1. Run `$HOME/.claude/bin/release-board-status.sh --json`. If it is missing or exits non-zero, STOP: "release board oracle unavailable — install baton (`~/.claude/bin/`) before replanning." From `.releases["$1"]` you have, branch-accurate: every slice's true `state` and `track`; every track's `state` (`planned` / `in_progress` / `merged`), `dependsOn`, `blockedBy`, `readyToMerge`, `worktreePath`, `worktreeBranch`; and the release's `releaseWorktreePath`. The top-level `.ghostSlices` / `.pendingSpecs` flag `index.md` rows the committed branches cannot back.
2. Run `git worktree list` and confirm each track's `worktreePath` actually exists on disk; note any recorded-but-missing worktree as drift.
3. **Spec-drift check — has a prior re-scope failed to reach a track?** For each in-flight track with a `worktreePath`, for each slice in that track, run `git diff release-wt/$1 <track-branch> -- docs/release/$1/<slice>/spec.md` (`<track-branch>` = the track's `worktreeBranch`). A non-empty diff means an **earlier `/replan-release` committed a re-scoped `spec.md` to `release-wt/$1` that the track branch never synced** — the verifier has been reading a stale spec, the signature of the `/verify-slice` ↔ `/replan-release` loop. Report it explicitly: "Track `<track-id>`'s `spec.md` for `<slice>` is out of sync (N diff lines)." Step 6 of this command resolves it by forward-merging `release-wt → <track-branch>`; still surface it so the human understands why the slice looked stuck. (The oracle reports *state*, not spec-content drift — this git-diff check stays a separate pass.)
4. Print the reconciled state table — slice → true state, track → `planned` / `in_progress` / `merged` — and call out every drift from what the integration-branch `index.md` records, including every spec-drift slice found in step 3 and every ghost slice / pending spec the oracle flagged. The revision and the `index.md` correction are done in the same pass.
5. **Diagnose why the replan was called — read the journals, not just the oracle.** The oracle reports each slice's `state` but not *why* it is there: it has no blocked-reason field and never reads journals. A slice the oracle shows as `in_progress` may actually be a stalled BLOCKED handoff routed back to the planner. For every slice the oracle reports as `in_progress` or `failed_verification` — plus any the human's request points at — read its `status.json` **`blocked` block** and **`verification.result`**, and the tail of its `journal.md`. These carry the implementer's or verifier's BLOCKED diagnosis, the recommended action, and the spec defect (if any) that routed the work here. Summarise the diagnosed trigger before proposing any revision — the revision must answer it.

## Step 2b — Resolve any inbound BLOCKED slice

A slice whose `status.json` has `verification.result: "blocked"` was routed here by a verifier: verification could not complete because the slice's own contract is the problem. Correcting a factual spec defect flagged by a BLOCKED verdict is squarely **in remit** for `/replan-release` — it is the reason the BLOCKED handoff routes to the planner.

For each BLOCKED slice surfaced by the Step 2 reconciliation you have exactly **two** legal outcomes:

1. **Correct the spec.** Amend `spec.md` to fix the defect — the verifier's verdict should carry a concrete proposed amendment; ratify it or improve on it. Then **clear `verification.result`** back to `"pending"` in the slice's `status.json` so the slice can re-enter verification, and set `state` to whatever the corrected spec now requires (`implemented` if the existing implementation already satisfies it, otherwise `failed_verification` or `planned`). Record the correction in `journal.md`.
2. **Escalate to the human.** If you believe the verifier was wrong — the spec was correct and the BLOCKED verdict was a misjudgement — do not silently overturn it. Surface the disagreement to the human with both positions and let them decide.

**Returning the handoff to the verifier is not an option.** "Re-run `/verify-slice` and see" is a return-to-sender handoff — non-terminating by construction (see `$HOME/.claude/baton/session-discipline.md` "Handoff directionality"). The slice re-enters verification only after the planner has cleared `verification.result`.

## Steps 3-5 — Drive the revision

Follow the planner role prompt's **"Re-planning a release in flight"** section:

- Drive the revision conversation — what new scope, what re-scope, what to drop — using `AskUserQuestion` brainstorm patterns for every decision, exactly as `/plan-release` does.
- Write `spec.md` + `status.json` for each new slice (Phase 4), setting its `track`.
- Place new slices into tracks: a **new track**, or **appended to the tail** of an existing track that is not `merged` and whose trailing slices have not started. **Never** insert a slice before `in_progress` / `verified` / `merged` work in a track.
- Re-validate the **touchpoint matrix** for every added slice against every track, including in-flight ones. A collision with an in-flight track means the new slice joins that track or `depends_on` it — it cannot run in parallel.
- Update `index.md` — `tracks:` frontmatter, Tracks table, touchpoint matrix, slice table — and commit at every checkpoint **to `release-wt/$1`** (see "Where this command runs and commits").

## Step 6 — Propagate the revised plan to the track branches (hygiene)

Once the revision is committed to `release-wt/$1`, push it out to every in-flight track branch so no track is left reading a stale spec. This closes the `/verify-slice` ↔ `/replan-release` drift loop at its source, instead of waiting for each track's next `/implement-slice` Step 0 to self-heal.

For each track in `index.md` `tracks:` whose `state` is **not `merged`**:

1. **No worktree yet** (`planned`, never started, no `worktree_branch` on disk): skip — its first `/implement-slice` will branch from the now-current `release-wt/$1`. Note it.
2. `cd` into the track worktree. If its working tree is **dirty** (`git status --porcelain` non-empty — an implementer has uncommitted work in flight): **skip** the merge and note it: "track `<id>` has uncommitted work; its next `/implement-slice` / `/verify-slice` Step 0 will forward-merge `release-wt` and resolve." Never merge into a dirty track worktree.
3. **Clean worktree**: forward-merge `git merge --no-ff release-wt/$1`.
   - Clean, or conflicts only in planning artefacts (`docs/release/**`, `index.md`, `intake.md`, `spec.md`, `status.json`): resolve and commit.
   - **Any production-code conflict**: `git merge --abort` and note it — "track `<id>` could not be auto-synced; its next `/implement-slice` / `/verify-slice` Step 0 forward-merges and resolves." This is graceful degradation, not a blocker — the downstream Step 0 self-heal is the backstop. Do not hand-resolve production code.
4. Push the updated track branch: `git push origin HEAD:refs/heads/track/$1/<track-id>` — the track branch is the durable recovery anchor (track-mode).

Surface, in the handoff, every track synced, skipped (dirty), skipped (no worktree), or left for downstream self-heal.

## Strict role boundaries

- **No production code.** The planner writes and resolves only planning artefacts.
- **Steps 1 and 6 forward-merge branches** (`base → release-wt`, `release-wt → track/*`). The planner MAY perform these merges and resolve **planning-artefact** conflicts, but never resolves a production-code conflict — Step 1 aborts and surfaces it as a blocker; Step 6 aborts that track's merge and defers to the downstream Step 0 self-heal.
- **No worktree *creation*.** Step 6 merges into *existing* track worktrees; it does not create them, and outside Steps 1/6 it makes no edits to track worktrees' working trees.
- Never edit the spec of a `verified` or `merged` slice — a materially changed spec is a new slice with a new id.
- Never insert a slice before `in_progress` / `verified` / `merged` work in a track.
- Do not run `/implement-slice`, `/verify-slice`, `/merge-track`, or `/merge-release` from this session. (Step 6's `release-wt → track` forward-merge is the *opposite direction* to `/merge-track` and is ungated — do not confuse the two.)

## Output to the human

A single message with:

- Release name; slices added / re-scoped / dropped; tracks added / changed.
- **Base-branch sync (Step 1)**: already-current, merged cleanly, or stopped for a production-code conflict.
- The reconciled state table, the **diagnosed replan trigger** (Step 2.5), the resolution of any inbound BLOCKED slice (Step 2b — spec corrected, or escalated to the human), and every `index.md` drift correction made this session.
- **Track propagation (Step 6)**: which track branches were synced, skipped (dirty / no worktree), or left for downstream Step 0 self-heal.
- Handoff: which tracks are now ready for a fresh `/implement-slice` session, and any new `depends_on` ordering. With Step 6 done, tracks no longer need a manual `release-wt → track` sync before `/implement-slice` — call out any exception left for self-heal.

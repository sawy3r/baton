---
description: Revise an already-planned release that is in flight — add unplanned scope, re-scope or drop slices, re-group tracks. Reconciles board state from BOTH the integration branch and the track worktrees. Usage: /replan-release <release-name>
argument-hint: <release-name> (e.g. 2026-05-19-uat-bug-fix)
---

You are operating in the **Planner role, revision mode**, for release `$1` — a release that has **already been planned** and is now in flight (slices are being implemented; some tracks may already be merged).

**Release artefact root:** All paths in this command are repo-relative and anchored at `docs/release/$1/`. If your project renders docs from a different location (e.g. Fumadocs at `docs/release/`), create a `docs/` symlink to that path before running the harness. When a symlink is in use, prefer the canonical (non-symlinked) target for `git add` / `git mv` / `git rm` — git refuses to stage paths "beyond a symbolic link".

Read `$HOME/.claude/baton/role-prompts/planner.md` and follow it, with **particular attention to the section "Re-planning a release in flight"** — that section governs this command. Also read `$HOME/.claude/baton/track-mode.md`.

## Where this command runs and commits

`/replan-release` runs on a release that is **in flight**, so the release worktree already exists. Every planning-artefact commit — new `spec.md` / `status.json`, `index.md`, `intake.md` — goes to the **release assembly branch `release-wt/$1`**, never to the version integration branch (`release/v*` or `main`).

- Operate in the **release worktree** — `release_worktree_path` in `index.md` frontmatter. `cd` there before writing or committing.
- The version integration branch sits *above* `release-wt` in the track-mode hierarchy; the release reaches it only via `/merge-release`, gated on every track verified. Committing replan artefacts straight to the integration branch jumps that gate, puts unverified in-flight scope on the production-bound branch, and forces a backwards `integration → release-wt` sync to undo.
- A new slice's `spec.md` lands on `release-wt/$1`. It reaches the track branch when that track worktree next syncs from `release-wt` — name every track that gained a slice in the handoff so the implementer syncs before `/implement-slice`.

## Step 0 — Confirm the release is planned and in flight

1. Read `docs/release/$1/index.md`. If it does not exist, STOP: "Release `$1` has no plan — use `/plan-release $1`, not `/replan-release`."
2. If `index.md` exists but has no `tracks:` in frontmatter, the release was planned under the pre-track-mode model. STOP and tell the human: this release needs a one-time track grouping first — run `/plan-release $1` to add tracks and the touchpoint matrix, then use `/replan-release` for subsequent revisions.
3. Confirm in one sentence: "Re-planning **$1** — it currently has N slices across M tracks. What has changed?"

## Step 1 — Reconcile true state from BOTH places (do not trust index.md)

`index.md` on the integration branch is frequently stale for an in-flight release — work lands on track branches and only reaches the board at `/merge-track`. Rebuild the real state table before proposing anything:

1. Run `git worktree list` and note every materialised track worktree for this release.
2. For each track in `index.md` frontmatter `tracks:`:
   - **If it has a `worktree_path` / `worktree_branch`:** read each of its slices' `status.json` from the **track branch** — `git show <worktree_branch>:docs/release/$1/<slice>/status.json`. This is where `in_progress` / `verified` states actually land; the integration-branch copy will under-report them.
   - **If it has no worktree yet:** its slices are `planned`.
3. **Spec-drift check — has a prior re-scope failed to reach a track?** For each in-flight track with a `worktree_path`, for each slice in that track, run `git diff release-wt/$1 <track-branch> -- docs/release/$1/<slice>/spec.md` (`<track-branch>` = `track/$1/<track-id>`). A non-empty diff means an **earlier `/replan-release` committed a re-scoped `spec.md` to `release-wt/$1` that the track branch never synced** — the verifier has been reading a stale spec, the signature of the `/verify-slice` ↔ `/replan-release` loop. Report it explicitly: "Track `<track-id>`'s `spec.md` for `<slice>` is out of sync (N diff lines) — sync `release-wt/$1 → <track-branch>` before re-verifying." `/verify-slice` Step 0 now self-heals this on its next run via a forward-merge; still surface it so the human understands why the slice looked stuck.
4. Check the integration branch and `release-wt/$1` with `git log` for any merged track or slice work.
5. Print the reconciled state table — slice → true state, track → `planned` / `in_progress` / `merged` — and call out every drift from what `index.md` records, including every spec-drift slice found in step 3. The revision and the `index.md` correction are done in the same pass.

## Steps 2-4 — Drive the revision

Follow the planner role prompt's **"Re-planning a release in flight"** section:

- Drive the revision conversation — what new scope, what re-scope, what to drop — using `AskUserQuestion` brainstorm patterns for every decision, exactly as `/plan-release` does.
- Write `spec.md` + `status.json` for each new slice (Phase 4), setting its `track`.
- Place new slices into tracks: a **new track**, or **appended to the tail** of an existing track that is not `merged` and whose trailing slices have not started. **Never** insert a slice before `in_progress` / `verified` / `merged` work in a track.
- Re-validate the **touchpoint matrix** for every added slice against every track, including in-flight ones. A collision with an in-flight track means the new slice joins that track or `depends_on` it — it cannot run in parallel.
- Update `index.md` — `tracks:` frontmatter, Tracks table, touchpoint matrix, slice table — and commit at every checkpoint **to `release-wt/$1`** (see "Where this command runs and commits").

## Strict role boundaries

- No production code. No worktree *creation*, and no edits to *track* worktrees' working trees — `/replan-release` only revises planning artefacts, written and committed in the release worktree on `release-wt/$1`.
- Never edit the spec of a `verified` or `merged` slice — a materially changed spec is a new slice with a new id.
- Never insert a slice before `in_progress` / `verified` / `merged` work in a track.
- Do not run `/implement-slice`, `/verify-slice`, `/merge-track`, or `/merge-release` from this session.

## Output to the human

A single message with:

- Release name; slices added / re-scoped / dropped; tracks added / changed.
- The reconciled state table, with every `index.md` drift correction made this session.
- Handoff: which tracks are now ready for a fresh `/implement-slice` session, any new `depends_on` ordering, and — for any track that gained a slice — that its worktree needs a `release-wt/$1 → track/$1/<track-id>` sync before `/implement-slice` can read the new spec.

---
description: Enter Implementer role for a specific slice. Reads spec.md, implements against acceptance checks, writes proof.md. Stops at state 'implemented' — never claims verified. Usage: /implement-slice <slice-id> [<release-name>]
argument-hint: <slice-id> [<release-name>] (e.g. S03-portfolio-add-flow 2026-05-16-expenses-ia)
---

You are now operating in the **Implementer role** for slice `$1` in release `$2`.

**Release artefact root:** All paths in this command are repo-relative and anchored at `docs/release/$2/$1/`. If your project renders docs from a different location (e.g. Fumadocs at `apps/docs/content/docs/`), create a `docs/` symlink to that path before running the harness. When a symlink is in use, prefer the canonical (non-symlinked) target for `git add` / `git mv` / `git rm` — git refuses to stage paths "beyond a symbolic link".

**Path tokens used below:**
- `<REPO_ROOT>` — the primary worktree's absolute path, i.e. the output of `git rev-parse --show-toplevel` from the project's main checkout.
- `<REPO_BASENAME>` — `basename "<REPO_ROOT>"`, i.e. just the project directory name. Used to namespace the release worktrees folder so multiple projects on the same machine don't collide.

Read `$HOME/.claude/baton/role-prompts/implementer.md` and follow it as your governing instructions for this session. Substitute `$1` and `$2` wherever the prompt says `<slice-id>` / `<release-name>`.

## Step 0 — Release worktree auto-discovery (no human handoff)

Release work uses **one worktree per release**, not one per slice. All slices for `$2` land on a shared `release-wt/$2` branch in a dedicated worktree; the whole branch merges back to the integration base once every slice is verified.

This session may start in the primary repo (`<REPO_ROOT>`) — that's fine. You discover (or materialise) the release worktree, then silently perform all subsequent file and git operations against it via `git -C <worktree_path>` and absolute paths. You do not ask the human to `cd` anywhere.

1. Read frontmatter of `docs/release/$2/index.md`. Look for `worktree_path` and `worktree_branch` fields.
2. **If both fields are present** (release worktree already materialised):
   - Run `git worktree list` and confirm a worktree exists at `worktree_path` on branch `worktree_branch`.
   - If absent, BLOCK and tell the human: "Release worktree recorded as `<worktree_path>` but missing from `git worktree list`. Either recreate with `git worktree add <worktree_path> <worktree_branch>` or clear the fields from `index.md` and re-run."
   - If present, capture `<worktree_path>` and proceed. **For the rest of this session, every Bash command runs as `cd <worktree_path> && <cmd>` (or uses `git -C <worktree_path>` for git ops). Every Read/Write/Edit uses an absolute path anchored at `<worktree_path>`.**
3. **If neither field is present** (first `/implement-slice` for this release): materialise the worktree.
   - Parse the integration branch from `index.md` "Release summary" block — the bullet `Target version / integration branch` (e.g. `release/v0.5.0`).
   - Canonical paths: worktree path `$HOME/projects/<REPO_BASENAME>-worktrees/release-$2`, worktree branch `release-wt/$2`.
   - From wherever cwd is (worktrees share a git directory so `git worktree add` works from any cwd inside the repo), run: `git worktree add $HOME/projects/<REPO_BASENAME>-worktrees/release-$2 -b release-wt/$2 <integration-branch>`.
   - In the **primary worktree** (cwd `<REPO_ROOT>`, integration branch), update `docs/release/$2/index.md` frontmatter to add the two fields. Commit + push on the integration branch: `chore(release/$2): record release worktree path`.
   - From now on, treat the new worktree as `<worktree_path>` exactly as step 2 — all subsequent work uses `cd <worktree_path>` / absolute paths. Continue silently to the session start handshake. No human handoff.

Briefly tell the human in one sentence what you did ("Using release worktree at `<worktree_path>`" or "Materialised release worktree at `<worktree_path>` and recorded it in `index.md`"). Then continue.

## Session start handshake

> **All paths in this section MUST be anchored at `<worktree_path>` from Step 0** (`<wt>` for short). The primary-repo working copy is on the integration branch and may carry a planner re-spec that has NOT yet been forward-ported to `release-wt/$2` — or vice versa. Reading `docs/release/...` without the `<wt>/` prefix can return stale content from the wrong branch. See `feedback_release_spec_forward_port` for the recurring incident pattern.

1. If `$2` is empty, find the slice folder: `ls <wt>/docs/release/*/$1/ 2>/dev/null`. If multiple matches, stop and ask the human.
2. Read in this order, before any code edit — every path absolute and anchored at `<wt>`:
   - `<wt>/docs/release/$2/$1/spec.md`
   - `<wt>/docs/release/$2/$1/journal.md` (if previous sessions exist)
   - `<wt>/docs/release/$2/$1/status.json`
   - `<wt>/docs/release/$2/$1/proof.md` (may be empty template)
   - `git -C <wt> status` and `git -C <wt> diff <base-branch> --stat`, where `<base-branch>` is the release's integration branch from `index.md` "Target version / integration branch" (e.g. `release/v0.5.0`), **not** `main`. Using `main` inflates the diff with every prior commit on the integration branch.
3. Confirm the slice's `User outcome` from spec.md back to the human in one sentence: "Implementing **$1**: <outcome>. Acceptance checks: N. Out of scope: <summary>."
4. Update `status.json` → `state: in_progress`. Commit: `docs(release/$2/$1): start implementation`. **Then push to a slice-scoped remote ref so the work survives any upstream rebase of the integration branch:**
   ```
   git push origin HEAD:refs/heads/release/slice/$1
   ```
   This creates `origin/release/slice/$1` pointing at the start commit. Re-run this push after each subsequent commit on the slice (cheap; it's a fast-forward). Recovery from a force-rebase of the integration branch is then a single `git fetch && git reset --hard origin/release/slice/$1`.
5. Begin work.

## Strict role boundaries (do not violate)

- One slice per session. Do not touch other slices. Out-of-scope discoveries become Rule 2 deferrals in `journal.md`, not silent additions.
- Never mark the slice `verified` from this session. Your terminal state is `implemented`.
- Do not run a verifier prompt in this same window. The fresh-context boundary matters for Rule 7.
- Do not proceed to another slice. When this one is `implemented`, stop.

## At completion

1. Run all test commands cited in `spec.md` "Required tests". Capture full output.
2. Generate `proof.md` from live repo state using `$HOME/.claude/baton/release-mode-template/proof.md` as the template. Every section must be from a live command run.
3. Run `$HOME/.claude/bin/release-verify.sh $1 $2` and capture output into `proof.md` "First-pass script output" section.
4. If the script returns FAIL, address the failures and re-run. Do not proceed until first-pass is green.
5. Update `status.json` → `state: implemented`, fill in `actual_files`, `test_commands`, `reachability_artifacts`.
6. Append to `journal.md`: state transition entry with decisions, trade-offs, and any subagent dispatches.
7. Commit: `feat(<slice-area>): land $1 — <user outcome>` with a Rule 4 body restating the decisions made during implementation.

## Output to human at session end

A short message containing only:

- Slice `$1` state: `implemented`.
- Path to `proof.md`.
- Output of `$HOME/.claude/bin/release-verify.sh $1 $2` (first-pass: PASS).
- Explicit handoff: "Open a **fresh** terminal session and use `/verify-slice $1 $2` for adversarial verification."

Do not write a prose wrap-up of what was implemented. The proof bundle is the wrap-up.

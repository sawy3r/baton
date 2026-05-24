---
description: Enter Implementer role for a specific slice. Reads spec.md, implements against acceptance checks, writes proof.md. Stops at state 'implemented' — never claims verified. Usage: /implement-slice <slice-id> [<release-name>]
argument-hint: <slice-id> [<release-name>] (e.g. S03-portfolio-add-flow 2026-05-20-billing-redesign)
---

## Argument resolution — do this first, before Step 0

This command is invoked as `/implement-slice <slice-id> [<release-name>]`. The
harness substitutes `$1` / `$2` into this prompt **before you see it**, and
that positional substitution has been observed to drop or swap tokens (the
release-name landing in the slice-id slot, `$2` left empty). **Do not trust
the substituted slice-id / release-name that appear in the text below.**
Re-derive them yourself, by shape:

1. Raw, unsplit argument string: `$ARGUMENTS`
2. Split it on whitespace.
3. The **slice-id** is the token matching `^S[0-9]+-` — e.g. `S03-portfolio-add-flow`.
4. The **release-name** is the token matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}-` — e.g. `2026-05-20-billing-redesign`. Optional; may be absent.
5. If the two tokens are swapped, trust the shape and reassign. If no slice-id-shaped token exists, stop and tell the human the invocation is malformed (show them `$ARGUMENTS`).

The values you resolve here are the single source of truth for `<slice-id>`
and `<release-name>` for the whole session. Wherever the text below shows a
concrete slice-id or release-name (a substituted `$1` / `$2`), use your
shape-resolved values instead if they differ.

You are now operating in the **Implementer role** for slice `$1` in release `$2`.

**Release artefact root:** All paths in this command are repo-relative and anchored at `docs/release/$2/$1/`. If your project renders docs from a different location (e.g. Fumadocs at `docs/release/`), create a `docs/` symlink to that path before running the harness. When a symlink is in use, prefer the canonical (non-symlinked) target for `git add` / `git mv` / `git rm` — git refuses to stage paths "beyond a symbolic link".

**Path tokens used below:**
- `<REPO_ROOT>` — the primary worktree's absolute path, i.e. the output of `git rev-parse --show-toplevel` from the project's main checkout.
- `<REPO_BASENAME>` — `basename "<REPO_ROOT>"`, i.e. just the project directory name. Used to namespace the release worktrees folder so multiple projects on the same machine don't collide.

Read `$HOME/.claude/baton/role-prompts/implementer.md` and follow it as your governing instructions for this session. Substitute `$1` and `$2` wherever the prompt says `<slice-id>` / `<release-name>`.

## Step 0 — Track worktree auto-discovery (no human handoff)

Release work runs under **track mode** — read `$HOME/.claude/baton/track-mode.md`. Each track has its own worktree on branch `track/$2/<track-id>`, cut from the release assembly branch `release-wt/$2`. Slices in a track are implemented sequentially in that worktree; `/merge-track` lands the track branch on `release-wt/$2` once every slice in it is verified.

**Launch-directory discipline — read this first.** This session is launched from whatever directory the human's terminal happens to be in — almost always the primary repo (`<REPO_ROOT>`), checked out on the integration branch. **That is not where this slice's work belongs.** Do not build, test, edit files, or run `git` writes in the launch directory. Step 0 discovers the correct **track worktree**; from that point on every Bash command is `cd <worktree_path> && <cmd>` (or `git -C <worktree_path>`) and every Read/Write/Edit uses an absolute path under `<worktree_path>`. If you ever run a mutating command without a `<worktree_path>` anchor, stop — you are in the wrong tree. You never ask the human to `cd`; discovery is silent and automatic.

**Read the board through the oracle — never by hand.** Every fact Step 0 needs (which track owns the slice, the track's state, its dependency gate, the sequential order of its slices, the worktree to operate in) comes from one branch-aware read:

```
$HOME/.claude/bin/release-board-status.sh --json
```

Run it from anywhere inside the repo — it resolves the repo from cwd and reads every `status.json` and `index.md` straight from the `track/$2/*` and `release-wt/$2` **git refs**, so it is correct regardless of which branch the launch directory sits on. Parse `.releases["$2"]` from its output. **Do not read `docs/release/$2/index.md` frontmatter or any `status.json` by hand in this step** — a launch-directory read silently misses every track and slice a `/replan-release` added after the release was cut (the recurring stale-branch trap). If the script is missing or exits non-zero, BLOCK: "release board oracle unavailable — install baton (`~/.claude/bin/`) before running release commands."

1. **Find the slice's track.** In the oracle JSON, take `.releases["$2"].tracks[]` and find the entry whose `.slices` array contains `$1`. If `$1` is in no track (or has no slice object under `.releases["$2"].slices[]`), BLOCK: "Slice `$1` is not assigned to a track — re-run `/plan-release $2` (or `/replan-release $2`) to group it." From the track entry capture `<track-id>` (`.id`), `<worktree_path>` (`.worktreePath`), `<worktree_branch>` (`.worktreeBranch`), `<blocked_by>` (`.blockedBy`), and the ordered `<slices>` (`.slices`).
2. **Enforce sequential order within the track.** For every slice listed *before* `$1` in the track's `.slices`, read its `.state` from `.releases["$2"].slices[]`. If any is not `verified` (nor `deferred` / `shipped`), BLOCK: "Slice `<earlier>` precedes `$1` in track `<track-id>` (state `<state>`). Slices in a track are implemented in order — finish and verify `<earlier>` first."
3. **If `<worktree_path>` is non-null** (track worktree already materialised):
   - Run `git worktree list`; confirm a worktree exists at `<worktree_path>` on `<worktree_branch>`. If absent, BLOCK: "Track worktree recorded as `<worktree_path>` but missing — recreate with `git worktree add <worktree_path> <worktree_branch>`, or clear the field and re-run."
   - Capture `<worktree_path>`. **For the rest of this session, every Bash command runs `cd <worktree_path> && <cmd>` (or `git -C <worktree_path>`); every Read/Write/Edit uses an absolute path anchored at `<worktree_path>`.** Skip to Step 0b (the BLOCKED-verdict guard) below.
4. **If `<worktree_path>` is null** (first `/implement-slice` for this track): materialise it.
   - **Dependency gate.** If the oracle reports a non-empty `.blockedBy` for this track, BLOCK: "Track `<track-id>` depends on `<blocked_by>` — not yet merged to `release-wt`. A dependent track may only start once its predecessors have merged." (`blockedBy` is exactly the subset of the track's `depends_on` whose tracks are not in state `merged`; an empty list means the gate is clear.)
   - **Release worktree first.** If `.releases["$2"].releaseWorktreePath` is null, this is also the first `/implement-slice` in the release: parse the integration branch from `index.md` "Release summary" → `Target version / integration branch` (e.g. `release/v0.5.0`), then `git worktree add $HOME/projects/<REPO_BASENAME>-worktrees/release-$2 -b release-wt/$2 <integration-branch>`.
   - **Materialise the track worktree** from the release branch: `git worktree add $HOME/projects/<REPO_BASENAME>-worktrees/release-$2-<track-id> -b <worktree_branch> release-wt/$2`.
   - **Record the worktree on the board — on `release-wt/$2`, not the integration branch.** The oracle reads `index.md` from `release-wt/$2`; the worktree_path must be written there or the next `/implement-slice` will not see it (and will try to re-materialise). In the **release worktree** (cwd `<release_worktree_path>`, branch `release-wt/$2`), update `docs/release/$2/index.md` frontmatter — set this track's `worktree_path` and `state: in_progress`, and `release_worktree_path` / `release_worktree_branch` if you just created the release worktree. Commit on `release-wt/$2`: `chore(release/$2): materialise worktree for track <track-id>`, then push. The integration branch stays untouched — it receives the release only via `/merge-release`.
   - Treat the new worktree as `<worktree_path>` per step 3. Continue silently — no human handoff.

Briefly tell the human in one sentence what you did ("Using track worktree at `<worktree_path>`" or "Materialised track worktree at `<worktree_path>` for track `<track-id>`"). Then continue.

## Step 0b — BLOCKED-verdict guard (before any implementation)

With `<worktree_path>` captured, read the target slice's own `status.json` from the **track worktree** — `<worktree_path>/docs/release/$2/$1/status.json`, never the launch-directory copy (the worktree is the only branch that carries the verifier's commits). The `verification.result` field is per-slice verdict detail the board oracle does not surface, so this one read is direct — but it is still worktree-anchored, never read from the launch directory. If `verification.result` is `"blocked"`, do **not** halt immediately — first cross-check `release-wt`'s copy of the same `status.json` to make sure the BLOCKED state has not already been cleared by a prior `/replan-release` whose Step 6 propagation failed to reach this track branch:

```
git -C <worktree_path> fetch origin --quiet
git -C <worktree_path> show origin/release-wt/$2:docs/release/$2/$1/status.json | jq -r '.verification.result'
```

- If `release-wt`'s copy is also `"blocked"`, the planner has not (yet) ratified a resolution — BLOCK and route to `/replan-release` as below. This is the canonical case.
- If `release-wt`'s copy is `"pending"` (or any non-`"blocked"` value) and was last updated by the planner *after* the track's BLOCKED verdict (compare `last_updated_at`), the planner has cleared the BLOCKED state but Step 6's release-wt → track propagation never reached here — the Step 6 ↔ Step 0b deadlock from baton#16. **Self-heal** by cherry-picking the planner's relevant commits onto the track branch *before* continuing. Identify the commits via `git -C <worktree_path> log origin/release-wt/$2 --not HEAD -- docs/release/$2/$1/` and cherry-pick them in order, resolving any planning-artefact conflicts. Push the track branch. Then re-read `status.json` and continue with the session start handshake. Note the self-heal in `journal.md`.

If you do need to halt, surface:

> Slice `$1` has an open BLOCKED verdict (also live on `release-wt`) — the implementer cannot resolve a blocker. Route it through `/replan-release $2` first; that clears `verification.result`.

A BLOCKED verdict means a fresh-context verifier found a spec defect or external gap that only the planner can resolve; an implementer session cannot clear it. Picking the slice up here would re-enter the verifier → planner → verifier loop this guard exists to break — the handoff routes forward to `/replan-release`, never back to the implementer (handoff directionality is canonical in `$HOME/.claude/baton/session-discipline.md`). Stop here; do not run the session start handshake.

## Session start handshake

> **All paths in this section MUST be anchored at `<worktree_path>` from Step 0** (`<wt>` for short). The primary-repo working copy is on the integration branch and may carry a planner re-spec that has NOT yet been forward-ported to `release-wt/$2` — or vice versa. Reading `docs/release/...` without the `<wt>/` prefix can return stale content from the wrong branch. See `feedback_release_spec_forward_port` for the recurring incident pattern.

1. If `$2` is empty, find the slice folder: `ls <wt>/docs/release/*/$1/ 2>/dev/null`. If multiple matches, stop and ask the human.
2. Read in this order, before any code edit — every path absolute and anchored at `<wt>`:
   - `<wt>/docs/release/$2/$1/spec.md`
   - `<wt>/docs/release/$2/$1/journal.md` (if previous sessions exist)
   - `<wt>/docs/release/$2/$1/status.json`
   - `<wt>/docs/release/$2/$1/proof.md` (may be empty template)
   - `git -C <wt> status` and `git -C <wt> diff <base> --stat`, where `<base>` is this slice's `start_commit` from `status.json` if already set, else `release-wt/$2` (the point the track branch was cut from). Never diff against `main` or the version branch — that inflates the diff with every prior track and slice.
3. Confirm the slice's `User outcome` from spec.md back to the human in one sentence: "Implementing **$1**: `<outcome>`. Acceptance checks: N. Out of scope: <summary>."
4. Update `status.json` → `state: in_progress`. Commit: `docs(release/$2/$1): start implementation`. Capture that commit's SHA (`git -C <wt> rev-parse HEAD`) and write it to `status.json` `start_commit` — it lands with your first implementation commit and is the verifier's exact diff base. **Then push the track branch so the work is durable:**
   ```
   git -C <wt> push origin HEAD:refs/heads/track/$2/<track-id>
   ```
   Re-run this push after every commit (cheap; fast-forward). `origin/track/$2/<track-id>` is the durable home of the track and the branch `/merge-track` lands. Recovery from an accidental local reset is `git fetch && git reset --hard origin/track/$2/<track-id>`.
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

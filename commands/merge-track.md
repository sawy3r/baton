---
description: Merge a completed track's track/<release>/<track-id> branch into the release assembly branch release-wt/<release>. Hard-gates on every slice in the track being verified, then re-runs the track's tests AND the affected-package regression suite on the merged base. Does NOT push or delete the branch/worktree. Usage: /merge-track <track-id> [<release-name>]
argument-hint: <track-id> [<release-name>] (e.g. T1-identity-account 2026-05-19-uat-bug-fix)
---

## Argument resolution — do this first

This command is invoked as `/merge-track <track-id> [<release-name>]`. The
harness substitutes `$1` / `$2` into this prompt **before you see it**, and
that positional substitution has been observed to drop or swap tokens (the
release-name landing in the track-id slot, `$2` left empty). **Do not trust
the substituted track-id / release-name that appear in the text below.**
Re-derive them yourself, by shape:

1. Raw, unsplit argument string: `$ARGUMENTS`
2. Split it on whitespace.
3. The **track-id** is the token matching `^T[0-9]+-` — e.g. `T1-identity-account`.
4. The **release-name** is the token matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}-` — e.g. `2026-05-19-uat-bug-fix`. Optional; may be absent.
5. If the two tokens are swapped, trust the shape and reassign. If no track-id-shaped token exists, stop and tell the human the invocation is malformed (show them `$ARGUMENTS`).

The values you resolve here are the single source of truth for `<track-id>`
and `<release-name>` for the whole session. Wherever the text below shows a
concrete track-id or release-name (a substituted `$1` / `$2`), use your
shape-resolved values instead if they differ.

You are operating in the **Track Integrator role** for track `$1` in release `$2`. This command merges `track/$2/$1` into the release assembly branch `release-wt/$2`. It is a gated step in **track mode** — read `$HOME/.claude/baton/track-mode.md` first.

**Release artefact root:** All paths in this command are repo-relative and anchored at `docs/release/$2/`. If your project renders docs from a different location (e.g. Fumadocs at `docs/release/`), create a `docs/` symlink to that path before running the harness. When a symlink is in use, prefer the canonical (non-symlinked) target for `git add` / `git mv` / `git rm` — git refuses to stage paths "beyond a symbolic link".

**Vocabulary, locked:**
- "merge a track" = `track/$2/$1` → `release-wt/$2` (this command).
- "merge a release" = `release-wt/$2` → version integration branch (`/merge-release`).
- "ship" = the version branch deploys to production (neither command does this).

## Step 0 — Run inside the release worktree

The merge target is `release-wt/$2`, which the release worktree owns.

**Read the board through the oracle** (reference implementation: `sworn board --json`). Run it from anywhere inside the repo — it reads `board.json` and every `status.json` straight from the `release-wt/$2` and `track/$2/*` **git refs**, so the track and slice states it reports are branch-accurate regardless of which branch the launch directory sits on. Every gate in Steps 0-1 reads this one JSON; do not re-read `board.json` or `status.json` by hand. If the oracle is unavailable or exits non-zero, BLOCK: "release board oracle unavailable — install the reference implementation (the open `sworn` binary) before merging."

1. If `$2` is empty, find the release from the oracle: the release whose `.tracks[]` contains an entry with `.id == "$1"`. Exactly one match ⇒ that is `$2`; none ⇒ BLOCK ("no release contains track `$1`"); more than one ⇒ stop and ask the human.
2. From `.releases["$2"]` capture `<release_worktree_path>` (`.releaseWorktreePath`) and `<release_worktree_branch>` (`.releaseWorktreeBranch`, = `release-wt/$2`). If `.releaseWorktreePath` is null, BLOCK: "Release `$2` has no release worktree — nothing has been implemented yet."
3. Confirm via `git worktree list` that the release worktree exists at `<release_worktree_path>` on `release-wt/$2`. If absent, BLOCK with the `git worktree add` recreate command.
4. For the rest of this session every git/file operation runs against `<release_worktree_path>` via `git -C` and absolute paths. Confirm its working tree is clean (`git -C <release_worktree_path> status --short` empty); if not, BLOCK.

## Step 1 — Locate the track and gate on verification

Every fact below comes from the Step 0 oracle JSON — `.releases["$2"].tracks[]` (each track carries `state`, `dependsOn`, `blockedBy`, `readyToMerge`, ordered `slices`, `worktreePath`, `worktreeBranch`) and `.releases["$2"].slices[]` (per-slice `state`). The oracle resolves each slice's state from its own track branch, so the verification gate cannot misfire on a stale integration-branch `status.json`.

1. Find the track entry with `.id == "$1"`. If none, BLOCK: "Track `$1` is not in release `$2`." Capture its ordered `<slices>` (`.slices`), `<worktree_branch>` (`.worktreeBranch`, = `track/$2/$1`), `<worktree_path>` (`.worktreePath`), `<blocked_by>` (`.blockedBy`), `<state>` (`.state`), and `<ready_to_merge>` (`.readyToMerge`).
2. **Idempotency gate — already-merged is a clean no-op, never a re-merge.** The track is already integrated if EITHER `<state>` is `merged` OR `git -C <release-worktree-path> merge-base --is-ancestor track/$2/$1 release-wt/$2` succeeds (release-wt already contains the track tip — nothing left to merge). In that case do NOT re-merge and do NOT BLOCK: emit a single success-shaped completion line — `Track \`$1\` already merged into \`release-wt/$2\` — no-op (idempotent re-dispatch).` — and exit cleanly. This is load-bearing: a spurious re-dispatch (e.g. an interpreter-pipe retry) MUST NOT add a duplicate merge commit. (merge-track is otherwise non-idempotent; this gate makes it safe to call more than once.)
3. If `<blocked_by>` is non-empty, BLOCK: "Track `$1` depends on `<blocked_by>` — not yet merged to `release-wt`. Merge those tracks first."
4. **Verification gate.** `<ready_to_merge>` is the oracle's bundled gate: true only when every slice in the track is terminal (`verified` / `deferred` / `shipped`), the track is not already merged, and `<blocked_by>` is empty. If `<ready_to_merge>` is false and Steps 1.2-1.3 passed, the cause is unverified slices: list every slice in `<slices>` whose `.state` (from `.releases["$2"].slices[]`) is not `verified` / `deferred` / `shipped`, and BLOCK: "Cannot merge track `$1` — not verified: `<list>`. Each must complete /verify-slice with PASS first." When `<ready_to_merge>` is true, proceed.

## Step 2 — Drift gate (self-healing)

`release-wt/$2` advances every time a sibling track merges, so from the second track merge of a release onward this gate almost always fires. **It is not a planner error — it is the ordinary cost of parallelism.** The older behaviour ejected you to forward-merge by hand; this step reconciles the drift itself, in the track worktree, and only BLOCKs on a genuine fault.

1. **Locate the track worktree.** Use `<worktree_path>` captured from the oracle in Step 1.1 (= `<track-worktree-path>`). If it is null, BLOCK: "Track `$1` has no worktree — nothing has been implemented." Confirm via `git worktree list` that it exists on branch `track/$2/$1`; if absent, BLOCK with the `git worktree add` recreate command. Confirm its working tree is clean (`git -C <track-worktree-path> status --short` empty); if dirty, BLOCK — never forward-merge into a dirty worktree.

2. **Measure drift.** `git -C <release_worktree_path> rev-list --count track/$2/$1..release-wt/$2`. If `0`, the track already carries `release-wt`'s tip — proceed to Step 3.

3. **Forward-merge `release-wt/$2` into the track worktree.** Drift is non-zero. List the driving commits first for the audit trail (`git -C <release_worktree_path> log --oneline track/$2/$1..release-wt/$2`), then:

   ```
   git -C <track-worktree-path> merge --no-ff release-wt/$2 -m "Merge release-wt/$2 into track/$2/$1 — sync before track merge

   Forward-merge so the track branch carries release-wt's tip before
   /merge-track integrates it back. Drift reconciled: <N> sibling commits.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

4. **Resolve conflicts — identical touchpoint contract to Step 4.** By invariant 2 of track-mode.md, disjoint tracks never write the same code/test file, so the forward-merge is conflict-free on code — expect at most a `board.json` reconciliation. On `git -C <track-worktree-path> diff --name-only --diff-filter=U`:

   - **No conflicts** — `git merge` already created the merge commit. Continue to step 5.
   - **Release `board.json`** — expected board reconciliation. Per-slice and per-track entries are disjoint and auto-merge; only the aggregate counts and the activity log collide. Resolve: keep both sides' entries, union the activity entries chronologically, recompute the aggregate counts, and re-render `index.md`. `git -C <track-worktree-path> add` both files.
   - **A documented shared file** (matrix row marked `DOCUMENTED SHARED` with each track's declared region) — inspect the hunks: if they sit in the declared-separate regions, keep both tracks' regions and `git -C <track-worktree-path> add`. If the hunks actually overlap, the matrix's region declaration was wrong — `git -C <track-worktree-path> merge --abort` and BLOCK as a planner error.
   - **Any other file** — `git -C <track-worktree-path> merge --abort` and BLOCK: "Forward-merge of `release-wt/$2` into track `$1` conflicted on `<files>`, which are neither `board.json` nor matrix-documented shared files. The touchpoint matrix was wrong — track `$1` and a merged sibling track both wrote `<file>`. Return to `/plan-release $2` or `/replan-release $2` to re-group before merging. (track-mode.md invariant 4.)"

   After resolving any conflicts, commit the merge: `git -C <track-worktree-path> commit --no-edit` (retains the message from step 3).

5. **Re-run the track's tests AND the affected-package suite in the track worktree.** Two layers, both from `<track-worktree-path>`, on the merged base:
   - **Per-slice commands.** The deduplicated union of every track slice's `status.json` `test_commands`.
   - **Affected-package sweep.** Per-slice `test_commands` only cover each slice's *own* package — a slice that edits a documented-shared file can break a package no slice's command names (this is exactly how a red `internal/run` suite once reached `release-wt`). So also run the project's full/affected regression suite over the merged base. Reference Go impl: `sworn regress --release $2 --worktree <track-worktree-path>` (runs `go test ./...` + any TS + golden-fixture checks against that worktree, exit non-zero on any failure). For a non-Go project, run the equivalent project-declared regression command.

   The per-slice verifications each ran against an *older* `release-wt`; this is the first run with the merged siblings underneath. If **either layer** fails (any command non-zero, or `sworn regress` exits non-zero), BLOCK with the failing command and its output — the forward-merge surfaced a real integration regression. The forward-merge commit stays on the track branch; fix forward, then re-run `/merge-track $1 $2`.

6. **Re-confirm.** `git -C <release_worktree_path> rev-list --count track/$2/$1..release-wt/$2` must now be `0`. Proceed to Step 3.

## Step 3 — Confirm scope

**Autonomous mode — if `BATON_AUTO_CONFIRM` is set in the environment** (the autonomous loop sets it):
do NOT call `AskUserQuestion`. The deterministic verification gate from Step 1.4 (`<ready_to_merge>` —
true only when every slice in the track is terminal/verified, the track is not already merged, and
`<blocked_by>` is empty) IS the authorization; asking a human would be redundant and, with no human
present, stalls the loop. Emit one line — `auto-confirm (BATON_AUTO_CONFIRM): merge track/$2/$1 into release-wt/$2 — <N> commits, gate green` (cite the Step 2 forward-merge sync SHA if one was performed) — and proceed directly to Step 4.

**Interactive mode — if `BATON_AUTO_CONFIRM` is unset** (a human is driving):
`AskUserQuestion`: show release, track id, branch, the verified slice list, and the commit count (`git rev-list --count release-wt/$2..track/$2/$1`). If Step 2 performed a forward-merge, say so explicitly — cite the sync commit SHA and note that the track's tests were re-run green on the merged base. Question: "Merge `track/$2/$1` into `release-wt/$2`?" Options: "Yes, merge" / "No, abort". If aborted, exit cleanly.

## Step 4 — Perform the merge

`git -C <release_worktree_path> merge --no-ff track/$2/$1 -m "<message>"` where the message is:

```
Merge track $1 into release-wt/$2 — N slices verified

Track: $1
Slices merged (all verified):
- <slice-id>: <one-line user outcome from spec.json>
...

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Conflict handling — the touchpoint matrix is the contract.** By invariant 2 of track-mode.md, code and test files cannot conflict between disjoint tracks. The only legitimate conflicts are `board.json` and **documented shared files** (rows the matrix marks `DOCUMENTED SHARED`). On `git diff --name-only --diff-filter=U`:

- **Release `board.json`** — expected board reconciliation. Per-slice and per-track entries are disjoint and auto-merge; only the aggregate counts and the activity log collide. Resolve: keep both sides' entries, union the activity entries chronologically, recompute the aggregate counts, and re-render `index.md`. `git add` both files and continue.
- **A documented shared file** (the touchpoint matrix marks it `DOCUMENTED SHARED` with each track's declared region) — the tracks were declared to edit well-separated regions. Inspect the conflict hunks: if they sit in the declared-separate regions, resolve by keeping both tracks' regions and `git add`. If the hunks actually overlap, the matrix's region declaration was wrong — `git merge --abort` and BLOCK as a planner error.
- **Any other file** — `git merge --abort` and BLOCK: "Merge of track `$1` conflicted on `<files>`, which are neither `board.json` nor matrix-documented shared files. The touchpoint matrix was wrong — track `$1` and a sibling track both wrote `<file>`. Return to `/plan-release $2` or `/replan-release $2` to re-group before merging. (track-mode.md invariant 4.)"

## Step 5 — Update the board

On `release-wt/$2` (in the release worktree), update `docs/release/$2/board.json`:

- Set the track's `state` to `"merged"` in the `tracks` array.
- Recompute the aggregate counts (slice counts + the track counts).
- Append an activity entry recording the merge: actor `track integrator (/merge-track)`, note `N verified slices merged: <slice-id list>. Track state -> merged.`, dated and tagged with the merge commit SHA.

Validate `board.json` against `board-v1`, then re-render `index.md` from it (the Tracks table, Aggregate state, and Recent activity sections are views). Commit both on `release-wt/$2`: `docs(release/$2): record track $1 merge to release-wt`.

## Step 6 — Hand off

Tell the human, in one short message:

- Merge commit SHA; track `$1` state is now `merged`.
- Remaining unmerged tracks (`board.json` `tracks` entries with `state != merged`), each with its verified/total slice count.
- If every track is now `merged`: "All tracks merged — run `/merge-release $2` to integrate the release into the version branch."
- Reminder: this command did **not** push, and did **not** delete `track/$2/$1` or its worktree (both retained for any post-merge fix). Push `release-wt/$2` when ready; remove the track worktree with `git worktree remove <track-worktree-path>` once you are sure no more work belongs to the track.

## Strict role boundaries

- Do not push. Network actions are the human's to trigger.
- Do not delete the track branch or its worktree — both are destructive and may be needed for a post-merge fix.
- Do not merge `release-wt` into the version branch — that is `/merge-release`.
- Do not flip slice states to `shipped` — shipping is a production deploy, not an integration step.
- Do not invoke `/plan-release`, `/replan-release`, `/implement-slice`, or `/verify-slice`. Single-purpose: just the track merge.

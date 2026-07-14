---
description: Enter Implementer role for a specific slice. On a `planned` slice, first produces the Design TL;DR (design.md) and halts at `design_review` for Captain review (Rule 9 — design review before code); once the review is acknowledged, implements against acceptance checks and writes proof.json. Stops at state 'implemented' — never claims verified. Usage: /implement-slice <slice-id> [<release-name>]
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

**Read the board through the oracle — never by hand.** Every fact Step 0 needs (which track owns the slice, the track's state, its dependency gate, the sequential order of its slices, the worktree to operate in) comes from one branch-aware read. Invoke the **board oracle** (reference implementation: `sworn board --json`):

```
sworn board --json
```

Run it from anywhere inside the repo — it resolves the repo from cwd and reads every `status.json` and `board.json` straight from the `track/$2/*` and `release-wt/$2` **git refs**, so it is correct regardless of which branch the launch directory sits on. Parse `.releases["$2"]` from its output. **Do not read `docs/release/$2/board.json` or any `status.json` by hand in this step** — a launch-directory read silently misses every track and slice a `/replan-release` added after the release was cut (the recurring stale-branch trap). The branch-aware state resolution is the oracle's contract (board-v1 + the `release-wt`/`track/*` ref read); the reference implementation is the open `sworn` binary. Two distinct failures, two distinct remedies — do not conflate them. If the oracle command is **not on PATH**, BLOCK: "no Baton engine installed — Release Mode requires a conformant engine (reference implementation: `go install github.com/swornagent/sworn/cmd/sworn@latest`)." If the oracle **is installed but exits non-zero**, it ran and could not resolve the board: BLOCK with the engine's own stderr verbatim — "board oracle failed: `<stderr>`" — and do NOT advise installing or repairing the engine, or paraphrase its error.

1. **Find the slice's track.** In the oracle JSON, take `.releases["$2"].tracks[]` and find the entry whose `.slices` array contains `$1`. If `$1` is in no track (or has no slice object under `.releases["$2"].slices[]`), BLOCK: "Slice `$1` is not assigned to a track — re-run `/plan-release $2` (or `/replan-release $2`) to group it." From the track entry capture `<track-id>` (`.id`), `<worktree_path>` (`.worktreePath`), `<worktree_branch>` (`.worktreeBranch`), `<blocked_by>` (`.blockedBy`), and the ordered `<slices>` (`.slices`).
2. **Enforce sequential order within the track.** For every slice listed *before* `$1` in the track's `.slices`, read its `.state` from `.releases["$2"].slices[]`. If any is not `verified` (nor `deferred` / `shipped`), BLOCK: "Slice `<earlier>` precedes `$1` in track `<track-id>` (state `<state>`). Slices in a track are implemented in order — finish and verify `<earlier>` first."
The worktree path and branch are **conventional, not read from a board field an implementer wrote**: `<worktree_branch>` = `track/$2/<track-id>` and `<worktree_path>` = `$HOME/projects/<REPO_BASENAME>-worktrees/release-$2-<track-id>`. The oracle reports these as `.worktreeBranch` / `.worktreePath`, derived the same way; trust the convention if they are null or disagree. (This is the Option-1 invariant: an implementer never writes `release-wt` — see track-mode.md "release-wt is written only by /merge-track and the planner". The materialisation record is the `track/$2/<track-id>` **branch ref**, not a `release-wt` board write.)

3. **Track worktree already materialised** — `git worktree list` shows a worktree at the conventional `<worktree_path>` on `<worktree_branch>`:
   - Capture `<worktree_path>`. **For the rest of this session, every Bash command runs `cd <worktree_path> && <cmd>` (or `git -C <worktree_path>`); every Read/Write/Edit uses an absolute path anchored at `<worktree_path>`.** Skip to Step 0b (the BLOCKED-verdict guard) below.
4. **Track worktree absent** from `git worktree list` (first `/implement-slice` for this track): materialise it — **writing nothing to `release-wt`**.
   - **Dependency gate.** If the oracle reports a non-empty `.blockedBy` for this track, BLOCK: "Track `<track-id>` depends on `<blocked_by>` — not yet merged to `release-wt`. A dependent track may only start once its predecessors have merged." (`blockedBy` is exactly the subset of the track's `depends_on` whose tracks are not in state `merged`; an empty list means the gate is clear.)
   - **Release worktree first.** If the release worktree (conventional path `$HOME/projects/<REPO_BASENAME>-worktrees/release-$2`, branch `release-wt/$2`) is absent from `git worktree list`, this is also the first `/implement-slice` in the release: read the integration branch from the oracle's `board.json` `release.integration_branch` (e.g. `release/v0.5.0`), then `git worktree add $HOME/projects/<REPO_BASENAME>-worktrees/release-$2 -b release-wt/$2 <integration-branch>`. This creates the `release-wt/$2` branch at the integration tip; it does **not** commit to it.
   - **Materialise the track worktree** from the release branch: `git worktree add <worktree_path> -b <worktree_branch> release-wt/$2`. This creates the `track/$2/<track-id>` branch off `release-wt`'s tip; it does **not** commit to `release-wt`.
   - **No board write, no `release-wt` commit.** The local `track/$2/<track-id>` branch ref is the materialisation record the oracle reads (it resolves track existence + worktree path from the branch and the naming convention — track-mode.md "Where the discovery data lives"); it becomes durable when the first commit (the design TL;DR, step 3 of the implementation loop) pushes the track branch. The worktree path is conventional, so nothing is persisted to the board; the track's live `in_progress` state is **derived** by the oracle from the branch, never stamped onto `release-wt`.
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

## Step 0c — Maintainability adjudication guard

Read `status.json` `maintainability` from the track worktree and apply the governing role prompt's
resume gate before implementation:

First validate the complete `status.json` against `slice-status-v1`. A schema-invalid lifecycle
record is a hard stop, not permission to fall through. In particular, `pending` is executable only
with `cycle: 0` and `implementation_head: null`; `pending` cycle 1 must never reach implementation.
Then run the governing contract's committed-history integrity check over every first-parent version
of this slice's `status.json`: `start_commit` must be immutable once non-null, `reports` must be
append-only by exact prefix, cycle may not decrease, every ledger entry must match its referenced
blob-pinned full report, no role/phase may repeat within a cycle, and any earlier
`re_slice_required` state is terminal for this slice id. Once non-null, Coach adjudication is
byte-immutable. A current initial-looking record does not override exhausted committed history.

- valid cycle-0 `pending` with no reports: continue normally. With exactly one Implementer
  preflight FAIL: resume only the already-open bounded remediation and closure; do not run another
  preflight.
- `needs_coach`: STOP for a Coach decision; do not start another review cycle.
- `re_slice_required`: STOP and route to `/replan-release $2`.
- `resume_approved`: validate the schema, cycle-1 ceiling, two unique source invocation ids and
  their corresponding fingerprints (which may be equal), and `resume_in_scope` permitted
  touchpoints before continuing. Require those paths to be a non-empty subset of the ratified spec
  touchpoints and reject any edit outside them. No cycle-1 reports starts its preflight; exactly one
  cycle-1 Implementer preflight FAIL resumes only remediation and closure. Reject any other
  incomplete sequence and never rerun a recorded phase.
- an unstaled `passed`: continue only for non-semantic proof/status handling; any semantic work
  follows the role prompt's cycle-aware transition before editing.

This guard is independent of `verification.result`; maintainability closure failure remains
`state: in_progress` and must not be disguised as a Verifier BLOCKED verdict.
Both the closure-failure handoff and the Coach decision must already be committed and pushed; if
their status/journal files are dirty, stop because the prior role did not complete its durable
handoff.

## Session start handshake

> **All paths in this section MUST be anchored at `<worktree_path>` from Step 0** (`<wt>` for short). The primary-repo working copy is on the integration branch and may carry a planner re-spec that has NOT yet been forward-ported to `release-wt/$2` — or vice versa. Reading `docs/release/...` without the `<wt>/` prefix can return stale content from the wrong branch. See `feedback_release_spec_forward_port` for the recurring incident pattern.

1. If `$2` is empty, find the slice folder: `ls <wt>/docs/release/*/$1/ 2>/dev/null`. If multiple matches, stop and ask the human.
2. Read in this order, before any code edit — every path absolute and anchored at `<wt>`:
   - `<wt>/docs/release/$2/$1/spec.json`
   - `<wt>/docs/release/$2/$1/journal.md` (if previous sessions exist)
   - `<wt>/docs/release/$2/$1/status.json`
   - `<wt>/docs/release/$2/$1/proof.json` (may be empty template)
   - `git -C <wt> status` and `git -C <wt> diff <base> --stat`, where `<base>` is this slice's `start_commit` from `status.json` if already set, else `release-wt/$2` (the point the track branch was cut from). Never diff against `main` or the version branch — that inflates the diff with every prior track and slice.
3. Confirm the slice's `User outcome` from spec.json back to the human in one sentence: "Implementing **$1**: `<outcome>`. Acceptance checks: N. Out of scope: <summary>."

   **Design TL;DR gate (Rule 9 — design review happens BEFORE code).** A slice must pass design review before any code is written. Determine where this slice sits in that gate from `status.json` `state` plus the artefacts in `<wt>/docs/release/$2/$1/`:

   - **`state: planned` (no design review yet).** Do NOT transition to `in_progress` and do NOT write code. Produce the **Design TL;DR**: a concise design plan derived from `spec.json` — the approach, key design choices + rationale, the files you intend to touch, and any design-level risks/pins worth a reviewer's eye (each AC traceable to a planned change). Write it to `<wt>/docs/release/$2/$1/design.md`. Set `status.json` → `state: design_review`. Commit `docs(release/$2/$1): produce design TL;DR — awaiting design review` and push the track branch. Then **STOP** — output: "design.md produced; slice now in `design_review`. Run `/design-review $1 $2` (Captain) before implementation." This is the gate the router and `/design-review` both expect (`/design-review` BLOCKs with "no design.md to review" if you skip it); skipping it is a Rule-9 violation.
   - **`state: design_review`, review NOT yet acknowledged** (no `review.md` carrying `DECISION: PROCEED`, or the Coach has not acknowledged per the orchestrator's ack convention — e.g. an `approved-ack.md` marker, or a human Coach confirmation): **STOP** — output: "design review pending — run `/design-review $1 $2`, then the Coach acknowledges (PROCEED) before implementation resumes." Do not write code.
   - **`state: design_review` WITH an acknowledged `DECISION: PROCEED`**, OR **`state: in_progress` / `failed_verification`** (already past the gate): the gate is satisfied — continue to step 4. (Apply any inline `IMPLEMENTER_FIX` pins from `review.md` as you implement; a design revised after a decline must be re-reviewed — re-enter `design_review`, do not jump to code.)

4. **(Design-review gate satisfied — see step 3.)** If `status.json` `start_commit` is null, update `status.json` → `state: in_progress`, commit `docs(release/$2/$1): start implementation`, capture that commit's SHA (`git -C <wt> rev-parse HEAD`), and write it to `start_commit` with the first implementation commit. If `start_commit` is already set for an `in_progress` or `failed_verification` slice, require it to resolve and preserve it byte-for-byte; never reset the slice's diff base on resume. **Then push the track branch so the work is durable:**
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

1. Complete Workflow step 5 in the governing Implementer role prompt in its stated order. That
   sequence owns deterministic tests, AC/security checks, proof emission and verification, the
   clean committed review checkpoints, bounded maintainability preflight/remediation/closure
   lifecycle, and the final semantic freeze. This command does not provide a second or later
   completion sequence.
2. Confirm the final `proof.json` was emitted from live repo state and that the current semantic
   review input still matches the fingerprint of the final maintainability PASS. Require
   `maintainability.implementation_head` to equal that report's `review_scope.head`. If either
   identity check fails, remain `in_progress` and follow the role prompt's cycle-aware path:
   cycle 0 stops for Coach adjudication; cycle 1 requires re-slicing.
3. Update `status.json` → `state: implemented`, fill in `actual_files`, `test_commands`,
   `reachability_artifacts`.
4. Append to `journal.md`: state transition entry with decisions, trade-offs, any subagent
   dispatches, and the final maintainability report fingerprint.
5. Commit: `feat(<slice-area>): land $1 — <user outcome>` with a Rule 4 body restating the decisions made during implementation.

## Output to human at session end

A short message containing only:

- Slice `$1` state: `implemented`.
- Path to `proof.json` (and the rendered `proof.md`).
- Output of the **proof-bundle verification gate** (`sworn verify $1 $2`) (first-pass: PASS).
- Explicit handoff: "Open a **fresh** terminal session and use `/verify-slice $1 $2` for adversarial verification."

Do not write a prose wrap-up of what was implemented. The proof bundle is the wrap-up.

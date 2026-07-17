---
description: Merge a completed track's track/<release>/<track-id> branch into the release assembly branch release-wt/<release>. Hard-gates on every slice satisfying track-mode's canonical integration-ready predicate, then re-runs the track's tests AND the affected-package regression suite on the merged base. Does NOT push or delete the branch/worktree. Usage: /merge-track <track-id> [<release-name>]
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

**Read the board through the oracle** (reference implementation: `sworn board --json`). Run it from anywhere inside the repo — it reads `board.json` and every `status.json` straight from the `release-wt/$2` and `track/$2/*` **git refs**, so the track and slice states it reports are branch-accurate regardless of which branch the launch directory sits on. Every gate in Steps 0-1 reads this one JSON; do not re-read `board.json` or `status.json` by hand. Two distinct failures, two distinct remedies — do not conflate them. If the oracle command is **not on PATH**, BLOCK: "no Baton engine installed — Release Mode requires a conformant engine (reference implementation: `go install github.com/swornagent/sworn/cmd/sworn@latest`)." If the oracle **is installed but exits non-zero**, it ran and could not resolve the board: BLOCK with the engine's own stderr verbatim — "board oracle failed: `<stderr>`" — and do NOT advise installing or repairing the engine, or paraphrase its error.

1. If `$2` is empty, find the release from the oracle: the release whose `.tracks[]` contains an entry with `.id == "$1"`. Exactly one match ⇒ that is `$2`; none ⇒ BLOCK ("no release contains track `$1`"); more than one ⇒ stop and ask the human.
2. Derive `<release_worktree_branch>` as `release-wt/$2` and
   `<release_worktree_path>` as
   `$HOME/projects/<REPO_BASENAME>-worktrees/release-$2`. Neither is a required
   oracle field; the authoritative existence test is the Git worktree registry
   check in step 3.
3. Confirm via `git worktree list --porcelain` that the exact `<release_worktree_path>` / `refs/heads/release-wt/$2` stanza exists. If absent, BLOCK: "Release `$2` has no release worktree on disk — nothing has been implemented yet (or recreate it with `git worktree add <release_worktree_path> release-wt/$2`)."
4. For the rest of this session every git/file operation runs against `<release_worktree_path>` via `git -C` and absolute paths. Confirm its working tree is clean (`git -C <release_worktree_path> status --short` empty); if not, BLOCK.

## Step 1 — Locate the track and gate on verification

The Step 0 oracle JSON supplies `.releases["$2"].tracks[]` with each track's
`id` and ordered nested `slices`; each slice supplies its state and
`dependsOnTracks`. Branch/path identity, dependency satisfaction, merged state,
and integration readiness are derived below. Do not require release-level
`.slices[]` or optional `blockedBy`, `readyToMerge`, `worktreePath`, or
`worktreeBranch` convenience fields.

1. Find the track entry with `.id == "$1"`. If none, BLOCK: "Track `$1` is
   not in release `$2`." Capture its ordered nested `<slices>` (`.slices`) and
   derive `<worktree_branch>` as `track/$2/$1` and `<worktree_path>` as
   `$HOME/projects/<REPO_BASENAME>-worktrees/release-$2-$1`. Derive the declared
   dependencies as the stable `dependsOnTracks` value on the track's slice
   rows; inconsistent dependency arrays across rows BLOCK as malformed oracle
   projection.
2. **Lifecycle-history integrity gate — before every success path.** For every slice in `<slices>`,
   validate current `status.json` against `slice-status-v1`, then enumerate every committed version
   of that physical path on `track/$2/$1`'s first-parent history and apply the complete canonical
   integrity/FSM check from `llm-checks/README.md`: immutable non-null `start_commit`, append-only
   report prefix, non-decreasing cycle, immutable non-null adjudication, blob-pinned full-report
   identity, legal phase ordering, state/newest-report coherence, and terminal
   `re_slice_required`. BLOCK on any regression before consulting oracle terminal state. This makes
   a rewritten current ledger incapable of hiding an earlier exhausted lifecycle or narrowing its
   candidate paths. Require every overall `verified` or `shipped` slice to have current
   maintainability `passed` with the newest entry a current-cycle Verifier `authoritative` PASS.
3. **Maintainability rollback gate.** Inspect every slice whose current or historical lifecycle is
   `re_slice_required`, regardless of the oracle's displayed state. Require the current lifecycle to
   preserve that terminal state, require overall state exactly `deferred`, and require a non-empty
   `rollback_slice_id`; `verified`, `shipped`, or any other state is invalid. The rollback slice must
   belong to this track, occur after the failed slice and before every functional replacement, and
   be `verified` or `shipped` (never deferred). BLOCK on any missing rollback, invalid order/state,
   report-identity failure, or tree mismatch. The rollback comparison set is the union of every
   slice-authored non-record path from the failed slice's immutable `start_commit` through the
   rollback slice's pinned implementation head, using the canonical first-parent non-merge and
   merge-overlap rules. For an ordinary maintainability failure, compare that complete envelope to
   the original start tree; do not stop at the failed report head. For a deterministic Step-2.6
   post-sync invalidation, instead require the recorded invalidating merge to be a recognized
   `release-wt` synchronization merge. Require `invalidated_review_head` to equal the preserved
   newest authoritative PASS `review_scope_head`; derive the affected slice's complete candidate set
   from `start_commit..invalidated_review_head`, never the deliberately cleared
   `implementation_head`, and compare it to that merge's exact parent-2 tree. Later authoritative
   slice intervals remain separately owned even when rollback was appended after them; the
   recoverability check in Step 2.6 proves they share no envelope path and are not swept into it.
   That parent is the synchronized release baseline: restoring to it removes the invalidated track
   bytes without deleting valid sibling-track bytes on a documented shared path. Any missing or
   mismatched recorded merge/baseline fails closed. Thus any post-report production commit is also
   restored to the correct durable baseline or blocks.
   For every other `deferred` slice, require an unstarted Rule-2 deferral: `start_commit: null`, the
   exact empty pending cycle-0 maintainability template, and at least one schema-valid
   `open_deferrals` entry. Any authored or lifecycle-bearing ordinary deferral BLOCKs.
4. **Idempotency gate — already-merged is a validated no-op, never a re-merge.** The track is already
   integrated when
   `git -C <release-worktree-path> merge-base --is-ancestor track/$2/$1 release-wt/$2` succeeds. In
   that case, first locate the first-parent `release-wt/$2` integration merge whose second parent is
   exactly the retained `track/$2/$1` ref and validate its complete canonical `/merge-track`
   provenance, including Steps 1.2-1.3 above, against the committed integration tree. Missing or
   invalid provenance BLOCKs. Only after those checks pass, emit
   `Track \`$1\` already merged into \`release-wt/$2\` — no-op (idempotent re-dispatch).` and exit
   cleanly. A spurious retry adds no commit, but idempotency never bypasses safety validation.
5. For every declared dependency `<dep>`, run
   `git -C <release-worktree-path> merge-base --is-ancestor track/$2/<dep>
   release-wt/$2`; a missing dependency ref or non-zero result adds `<dep>` to
   `<blocked_by>`. If `<blocked_by>` is non-empty, BLOCK: "Track `$1` depends
   on `<blocked_by>` — not yet merged to `release-wt`. Merge those tracks
   first."
6. **Verification gate.** After Steps 1.2-1.5, independently require every
   nested slice to satisfy track-mode's canonical integration-ready predicate.
   The optional oracle `readyToMerge` convenience field is neither required nor
   authoritative. List each non-ready slice and BLOCK: "Cannot merge track
   `$1` — not integration-ready: `<list>`. Complete verification, the Rule-2
   unstarted deferral, or the mandatory verified rollback first." When every
   slice is ready, proceed.

## Step 2 — Drift gate (self-healing)

`release-wt/$2` advances every time a sibling track merges, so from the second track merge of a release onward this gate almost always fires. **It is not a planner error — it is the ordinary cost of parallelism.** The older behaviour ejected you to forward-merge by hand; this step reconciles the drift itself, in the track worktree, and only BLOCKs on a genuine fault.

1. **Locate the track worktree.** Use the conventional `<worktree_path>`
   derived in Step 1. Confirm via `git worktree list --porcelain` that it exists
   on branch `track/$2/$1`; if absent, BLOCK: "Track `$1` has no worktree on
   disk — nothing has been implemented (or recreate it with `git worktree add
   <track-worktree-path> track/$2/$1`)." Confirm its working tree is clean
   (`git -C <track-worktree-path> status --short` empty); if dirty, BLOCK —
   never forward-merge into a dirty worktree.

2. **Measure drift.** `git -C <release_worktree_path> rev-list --count track/$2/$1..release-wt/$2`. If `0`, the track already carries `release-wt`'s tip — skip merge steps 3-4 and proceed to Step 2.5. The merged-base test rerun and canonical scope-freshness gate are mandatory even when another command already performed the synchronization.

3. **Forward-merge `release-wt/$2` into the track worktree.** Drift is non-zero. List the
   driving commits first for the audit trail
   (`git -C <release_worktree_path> log --oneline track/$2/$1..release-wt/$2`). Before mutating the
   branch, treat the current track tip as `P1` and the current release tip as `P2`, construct `B` and
   the canonical per-path expected map `E` for the union of `B..P1` and `B..P2` exactly as
   `llm-checks/README.md` specifies, and validate every `P2` `board.json.shared_touchpoints` member.
   Any ambiguous base, invalid declaration, or non-record composition conflict BLOCKs before
   `git merge`; retain `E` for the prospective-index identity check. Then:

   ```
   git -C <track-worktree-path> merge --no-ff --no-commit -Xno-renames release-wt/$2 -m "Merge release-wt/$2 into track/$2/$1 — sync before track merge

   Forward-merge so the track branch carries release-wt's tip before
   /merge-track integrates it back. Drift reconciled: <N> sibling commits.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

4. **Resolve conflicts against canonical `E`.** By invariant 2 of track-mode.md, disjoint tracks do
   not both change a production path except a declared shared file. The ordinary merge may still
   conflict on that file because repository or local merge-driver configuration is not protocol
   authority. On `git -C <track-worktree-path> diff --name-only --diff-filter=U`:

   - **No conflicts** — the merge is staged but uncommitted because step 3 used `--no-commit`. Continue to the prospective-index check below.
   - **Release `index.md` only** — discard both rendered versions and re-render
     it from the unchanged pure-plan `board.json` plus the authoritative
     statuses/ref-derived state after the merge. Stage only `index.md`.
   - **Release `board.json`** — take the exact `release-wt/$2` version (the
     planner authority being forward-merged), validate it against `board-v1`,
     and stage it. Do not union the two objects or add lifecycle/activity data.
   - **A documented shared file** with a preflight `E` tuple — ignore the configured driver's staged or conflicted result. Materialise the exact committed bytes from `git cat-file blob <E-oid>` to a temporary file in the path's directory, set its executable bit from `<E-mode>`, and atomically rename it over `<path>`; do not pass it through checkout/smudge filters or hand-edit it. Then feed exactly `<E-mode> <E-oid>\t<path>\0` to `git -C <track-worktree-path> update-index -z --index-info`, clearing conflict stages and installing the canonical blob. If `E` is absent, malformed, or was not produced by the both-parents-changed rule, abort and BLOCK.
   - **Any other file** — `git -C <track-worktree-path> merge --abort` and BLOCK: "Forward-merge of `release-wt/$2` into track `$1` conflicted on undeclared production path `<files>`. The touchpoint plan was wrong. Return to `/plan-release $2` or `/replan-release $2` to re-group before merging. (track-mode.md invariant 4.)"

   Whether or not Git reported a conflict, overwrite every both-parents-changed documented shared
   path in the worktree and prospective index with its exact `E` bytes/mode/tuple using the same
   atomic materialisation and NUL-delimited `--index-info` operation. Thus a configured driver cannot
   supply either a false conflict or a false clean blob.
   After resolving release-record conflicts, extend the canonical path set with every non-record path
   changed from `P1` to the prospective index, assigning `P1` as the expected tuple for any new path,
   then compare that index against `E`. Any missing parent-2 change, extra edit, manual composition, custom
   driver result, mode mismatch, or object mismatch aborts and BLOCKs before a commit. Only after the
   index passes, commit the merge: `git -C <track-worktree-path> commit --no-edit` (retains the message
   from step 3). For each canonical shared path, require
   `git hash-object --no-filters -- <path>` to equal its `E` object id, then require empty staged and
   unstaged diffs before running tests; a configured filter or worktree rewrite may not replace the
   reviewed bytes.

5. **Re-run the track's tests AND the affected-package suite in the track worktree.** Two layers, both from `<track-worktree-path>`, on the merged base:
   - **Per-slice commands.** The deduplicated union of every track slice's `status.json` `test_commands`.
   - **Affected-package sweep.** Per-slice `test_commands` only cover each slice's *own* package — a slice that edits a documented-shared file can break a package no slice's command names (this is exactly how a red `internal/run` suite once reached `release-wt`). So also run the project's full/affected regression suite over the merged base. Reference Go impl: `sworn regress --release $2 --worktree <track-worktree-path>` (runs `go test ./...` + any TS + golden-fixture checks against that worktree, exit non-zero on any failure). For a non-Go project, run the equivalent project-declared regression command.

   The per-slice verifications each ran against an *older* `release-wt`; this is the first run with the merged siblings underneath. If **either layer** fails (any command non-zero, or `sworn regress` exits non-zero), BLOCK with the failing command and its output — the forward-merge surfaced a real integration regression. The forward-merge commit stays on the track branch; fix forward, then re-run `/merge-track $1 $2`.

6. **Re-confirm and re-gate, including canonical scope freshness.**
   `git -C <release_worktree_path> rev-list --count track/$2/$1..release-wt/$2` must now be `0`.
   Whether this command created the synchronization merge or found it already present, re-run Step
   1's lifecycle-history/FSM and rollback gates against the current track tip. Then run the
   canonical **track-integration freshness composition** from `llm-checks/README.md` across the
   track's ordered evidence intervals. An active interval belongs to a `verified` or `shipped` slice
   and ends at its authoritative `implementation_head`. A retired-ownership interval belongs to a
   terminal deferred `re_slice_required` original: it ends at `invalidated_review_head` for a
   Step-2.6 invalidation, otherwise at the `review_scope_head` in the newest immutable report present
   in the first committed status version that entered `re_slice_required`. Admit that retired
   interval only after Step 1's linked verified-rollback
   tree proof passes. It owns historical commits but never advances a reviewed frontier or supplies
   PASS evidence. The verified rollback and any replacement slices remain ordinary active intervals.
   For an ordinary failure, an otherwise-unowned semantic commit after the retired head and through
   the rollback slice's `start_commit` is legal only inside the complete rollback envelope proven
   restored by Step 1; for a post-sync invalidation, later authoritative
   intervals remain separately owned and every other semantic gap fails closed.

   Reconstruct each interval's first-parent non-merge candidate paths and immutable head. Walk the
   track first-parent history in order: commits inside a later active interval are covered by that
   slice and advance the reviewed frontier for the paths it authored; they do not stale every earlier
   slice merely because the track is sequential. Commits inside an admitted retired interval are
   owned but do not become a frontier. Classify each commit once: the ordinary rollback-gap exception
   covers only commits not already owned by an active or retired interval. Other non-record non-merge
   commits are unowned and fail closed.

   Validate every synchronization merge with release provenance and the canonical per-path
   composition rule from `llm-checks/README.md`. Ordinary contribution paths must equal parent 2. A result that
   differs from both parents is recognized only on an exact board-declared `shared_touchpoints`
   path and only when its mode/object id equals the conflict-free `merge-file --object-id` result;
   manual composition is custom and fails. Ignore disjoint sibling-only contribution paths. For each
   contribution that intersects a current-track candidate path, compare the merge position with that
   path's latest authoritative reviewed frontier. A contribution after the frontier is stale; one
   followed by a later authoritative slice that authors the path is covered by that later fresh
   verification. This composition is deterministic and makes no new model call.

   An unowned semantic commit, unrecognized/custom merge, or invalid parent-2 provenance is history
   corruption with no trustworthy release baseline. BLOCK without mutating lifecycle state and
   require human repair/reconstruction of the track; never invent rollback metadata for it.

   A contribution from a **recognized** synchronization merge after an intersecting path's latest
   reviewed frontier is recoverable only when the affected slice's complete candidate set is
   disjoint from every later authoritative slice candidate set. If a later slice re-authored any of
   those paths, BLOCK without lifecycle mutation and require human track reconstruction; rollback
   could not both restore the release baseline and preserve the later slice's verified bytes.

   For the disjoint recoverable case, do not integrate on the old PASS and do not append a second
   authoritative report to its completed cycle. Under the narrow Track
   Integrator invalidation transition defined by Rule 7, commit the
   invalidation on the track branch: preserve the report ledger and any Coach adjudication, clear
   `maintainability.implementation_head`, set `maintainability.state: re_slice_required`, set the
   affected overall slice `state: failed_verification`, set `verification.result: fail`, and record
   the concrete stale-scope evidence in `verification.violations` and `journal.md`, including the
   former pin as `invalidated_review_head`, `invalidating_sync_merge`, and its exact parent-2
   `rollback_baseline_commit`. Require `invalidated_review_head` to equal the newest authoritative
   PASS `review_scope_head` before clearing `implementation_head`. A `shipped` slice is
   human-terminal and may not be rewritten by this role; BLOCK and escalate it instead. Commit
   this invalidation on the local track ref; this command does not push. Then BLOCK and route to
   `/replan-release $2`. That
   planner must create the mandatory rollback and replacement slice ids; each new slice must reach
   `implemented` and receive a fresh-context `/verify-slice` PASS before `/merge-track` may resume.
   This transition spends no extra maintainability run on an inseparable old scope and cannot be
   bypassed by re-dispatching this command.

   Finally refresh the oracle, re-check nested slice readiness, and re-run the
   Git ancestry dependency checks. BLOCK on any new regression;
   only a fully re-gated track proceeds to Step 3.

## Step 3 — Confirm scope

**Autonomous mode — if `BATON_AUTO_CONFIRM` is set in the environment** (the autonomous loop sets it):
do NOT call `AskUserQuestion`. The deterministic gates from Steps 1.2-1.6
(canonical integration readiness for every slice, track not already merged,
and Git-derived `<blocked_by>` empty) ARE the authorization; asking a human would be redundant and, with no human
present, stalls the loop. Emit one line — `auto-confirm (BATON_AUTO_CONFIRM): merge track/$2/$1 into release-wt/$2 — <N> commits, gate green` (cite the Step 2 forward-merge sync SHA if one was performed) — and proceed directly to Step 4.

**Interactive mode — if `BATON_AUTO_CONFIRM` is unset** (a human is driving):
`AskUserQuestion`: show release, track id, branch, the verified slice list, and the commit count (`git rev-list --count release-wt/$2..track/$2/$1`). If Step 2 performed a forward-merge, say so explicitly — cite the sync commit SHA and note that the track's tests were re-run green on the merged base. Question: "Merge `track/$2/$1` into `release-wt/$2`?" Options: "Yes, merge" / "No, abort". If aborted, exit cleanly.

## Step 4 — Perform the merge

`git -C <release_worktree_path> merge --no-ff --no-commit -Xno-renames track/$2/$1 -m "<message>"` where the message is:

```
Merge track $1 into release-wt/$2 — N slices verified

Track: $1
Slices merged (all verified):
- <slice-id>: <one-line user outcome from spec.json>
...

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Conflict handling — the touchpoint matrix is the contract.** By invariant 2 of track-mode.md, code and test files cannot conflict between disjoint tracks. Only release-record conflicts are resolvable; a production conflict, including on a documented shared path, BLOCKs. On `git diff --name-only --diff-filter=U`:

- **Release `index.md` only** — discard both rendered versions and re-render it
  from the unchanged pure-plan `board.json` plus the authoritative
  statuses/ref-derived state after the merge. Stage only `index.md` and
  continue.
- **Release `board.json`** — keep the exact pre-merge `release-wt/$2` version
  (the planner authority and first parent), validate it against `board-v1`, and
  stage it. Do not union plan variants or add lifecycle/activity data.
- **A documented shared file** (one exact `board.json.shared_touchpoints` entry names every contributing track and region, and the matrix renders it `DOCUMENTED SHARED`) — the exception is valid only when Git composes the regions without a conflict. `git merge --abort` and BLOCK as a planner error; never create a hand-resolved production blob in the release integration merge.
- **Any other file** — `git merge --abort` and BLOCK: "Merge of track `$1` conflicted on production path `<files>`. The touchpoint plan was wrong — only release-record conflicts are resolvable, and even a documented shared path must compose without conflict. Return to `/plan-release $2` or `/replan-release $2` to re-group before merging. (track-mode.md invariant 4.)"

Before committing, validate the prospective index tree as the canonical `/merge-track` integration
shape from `llm-checks/README.md`: exactly two parents, second parent exactly the retained
`track/$2/$1` ref, all lifecycle/FSM/rollback gates still green in that parent, and every result
outside the physical release-record root equal in mode/object id to that second parent. If the
prospective tree or parent identity fails, `git merge --abort` and BLOCK; do not create a
non-conformant integration commit. After the
prospective tree passes, commit with the prepared merge message, capture the merge SHA, and validate
the committed parents/tree once more before proceeding. Normal integration and idempotent re-entry
therefore use the same provenance test.

## Step 5 — Re-render the board view

The track's `merged` state is **derived**, not written (invariant 5): the merge commit you just made puts the track branch in `release-wt/$2`'s ancestry, which *is* the `merged` signal. `board.json` is a pure plan — it has no `state` field to set, so there is nothing to update in it for this merge.

Re-render `index.md` from `board.json` (the renderer derives track `$1` as
merged from ref ancestry) and commit it on `release-wt/$2`:
`docs(release/$2): re-render board — track $1 merged`. If your project renders
`index.md` on demand rather than committing it, skip this commit — the merge
commit alone is the durable, authoritative record.

## Step 6 — Hand off

Tell the human, in one short message:

- Merge commit SHA; track `$1` state is now `merged`.
- Remaining unmerged tracks (oracle track ids whose derived branch is not an
  ancestor of `release-wt/$2`), each with its verified/total slice count.
- If every track is now `merged`: "All tracks merged — run `/merge-release $2` to integrate the release into the version branch."
- Reminder: this command did **not** push, and did **not** delete `track/$2/$1` or its worktree (both retained for any post-merge fix). Push `release-wt/$2` when ready; remove the track worktree with `git worktree remove <track-worktree-path>` once you are sure no more work belongs to the track.

## Strict role boundaries

- Do not push. Network actions are the human's to trigger.
- Do not delete the track branch or its worktree — both are destructive and may be needed for a post-merge fix.
- Do not merge `release-wt` into the version branch — that is `/merge-release`.
- Do not flip slice states to `shipped` — shipping is a production deploy, not an integration step.
- Do not invoke `/plan-release`, `/replan-release`, `/implement-slice`, or `/verify-slice`. Single-purpose: just the track merge.

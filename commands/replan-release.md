---
description: Revise an already-planned release that is in flight — add unplanned scope, re-scope or drop slices, re-group tracks. Reconciles lifecycle state from authoritative status records across release and track refs, forward-syncs the base branch in and the revised plan out to every track branch. Usage: /replan-release <release-name>
argument-hint: <release-name> (e.g. 2026-05-19-uat-bug-fix)
---

You are operating in the **Planner role, revision mode**, for release `$1` — a release that has **already been planned** and is now in flight (slices are being implemented; some tracks may already be merged).

**Release artefact root:** All paths in this command are repo-relative and anchored at `docs/release/$1/`. If your project renders docs from a different location (e.g. Fumadocs at `docs/release/`), create a `docs/` symlink to that path before running the harness. When a symlink is in use, prefer the canonical (non-symlinked) target for `git add` / `git mv` / `git rm` — git refuses to stage paths "beyond a symbolic link".

Read `$HOME/.claude/baton/role-prompts/planner.md` and follow it, with **particular attention to the section "Re-planning a release in flight"** — that section governs this command. Also read `$HOME/.claude/baton/track-mode.md`.

## Where this command runs and commits

`/replan-release` runs on a release that is **in flight**, so the release worktree already exists. Every planning-artefact commit — new `spec.json` / `status.json`, `board.json`, `intake.md` — goes to the **release assembly branch `release-wt/$1`**, never to the version integration branch (`release/v*` or `main`).

- Operate in the **release worktree** — conventional path `$HOME/projects/<REPO_BASENAME>-worktrees/release-$1` on branch `release-wt/$1` (derived, not stored in `board.json`). `cd` there before writing or committing.
- The version integration branch sits *above* `release-wt` in the track-mode hierarchy; the release reaches it only via `/merge-release`, gated on every track verified. Committing replan artefacts straight to the integration branch jumps that gate, puts unverified in-flight scope on the production-bound branch, and forces a backwards `integration → release-wt` sync to undo.
- A new slice's `spec.json` lands on `release-wt/$1`. **Step 6** then propagates it out to every in-flight track branch, so no track is left reading a stale spec.

## Step 0 — Confirm the release is planned and in flight

1. Derive the release worktree path by convention
   (`$HOME/projects/<REPO_BASENAME>-worktrees/release-$1`) and confirm `git worktree list --porcelain`
   contains its exact `refs/heads/release-wt/$1` stanza. If it does not, STOP: "Release `$1` has no release worktree — use
   `/plan-release $1` for a new release or restore the missing `release-wt/$1` worktree."
2. Read the absolute `<release-worktree>/docs/release/$1/board.json`, never the launch-directory
   relative copy. If it does not exist, STOP: "Release `$1` has no plan — use `/plan-release $1`,
   not `/replan-release`."
3. If that `board.json` has an empty or absent `tracks` array, the release was planned under the
   pre-track-mode model. STOP and tell the human: this release needs a one-time track grouping first
   — run `/plan-release $1` to add tracks and the touchpoint matrix, then use `/replan-release` for
   subsequent revisions.
4. Confirm in one sentence: "Re-planning **$1** — it currently has N slices across M tracks. What has changed?"

## Step 0a — Validate the board projection before any mutation

Before Step 1 runs — and before any merge, commit, planning-artefact write, or
other release-branch mutation — run the **board oracle** (reference
implementation: `sworn board --json`). Two distinct failures, two distinct
remedies — do not conflate them. If the oracle command is **not on PATH**, STOP:
"no Baton engine installed — Release Mode requires a conformant engine
(reference implementation:
`go install github.com/swornagent/sworn/cmd/sworn@latest`)." If the oracle **is
installed but exits non-zero**, it ran and could not resolve the board: STOP
with the engine's own stderr verbatim — "board oracle failed: `<stderr>`" — and
do NOT advise installing or repairing the engine, or paraphrase its error.

Apply track-mode's full projection integrity gate to `.releases["$1"]` now.
Any duplicate ownership, row/parent mismatch, inconsistent normalized
dependency set, duplicate track id, or release-key mismatch STOPs as malformed
oracle output. This first result is a read-only preflight only: do not use it as
the post-sync lifecycle snapshot. Step 2 reruns and revalidates the oracle after
Step 1 because a successful base sync may change the projection.

## Step 1 — Sync the release worktree with its base branch (hygiene)

Before reconciling state or revising anything, bring `release-wt/$1` up to date with the version integration branch it was cut from. An in-flight release that has drifted behind its base replans against a stale picture — the touchpoint matrix, the schema-vs-spec audits, and any new slice you scope can all be wrong if the base has moved underneath them.

1. Derive the release worktree path by convention (`$HOME/projects/<REPO_BASENAME>-worktrees/release-$1`, branch `release-wt/$1`), and read the **base branch** from `board.json` (`release.integration_branch`, e.g. `release/v0.5.0` — this field stays; only worktree path + state are derived).
2. `cd` into the release worktree. Confirm it is on `release-wt/$1` and the working tree is clean (`git status --porcelain` is empty). If it is dirty, STOP and surface — uncommitted state in the release worktree is itself a finding the human must resolve before replanning.
3. Has the base branch moved? `git rev-list --count release-wt/$1..<base-branch>`. Zero ⇒ already current; skip step 4 and continue to step 5.
4. Non-zero ⇒ forward-merge the base in: `git merge --no-ff <base-branch>`.
   - **Clean merge, or conflicts only in planning artefacts** (`docs/release/**`, `board.json`, `intake.md`, `spec.json`, `status.json`): resolve the planning-artefact conflicts with planner judgement, commit the merge, and note it. Any `status.json` resolution here is temporary release-worktree hygiene, never lifecycle authority; Step 2.6 replaces every started unmerged slice's status with its exact owner-track record before mutation or propagation.
   - **Any conflict in production code** (`apps/`, `go/`, `packages/` source, config, CI, lockfiles): `git merge --abort` and **STOP**. Resolving production code is outside the planner's remit. Surface to the human as a key blocker: "`release-wt/$1` is behind `<base-branch>` and the catch-up merge conflicts in production code — resolve the base sync, then re-run `/replan-release`." Replanning does not proceed on an un-synced base.
5. Only after the base sync is complete, capture
   `PLANNER_START_SHA=$(git rev-parse HEAD)`. Step 6 uses this as the exclusive lower bound when
   cherry-picking this session's later planning-artefact commits. The base merge itself is therefore
   outside `PLANNER_START_SHA..release-wt/$1`; the fallback range contains no base production commit
   or merge commit.

## Step 2 — Reconcile true state via the board oracle

`board.json` is the state-free release plan, so it cannot be stale about
lifecycle. The board oracle combines that plan with every slice's
`status.json` from `release-wt/$1` and `track/$1/*` **git refs**,
ownership-keyed (a slice's authoritative state is the copy on its own track
branch). Do not hand-reconcile by reading `status.json` from each branch
yourself — that by-hand pass is the recurring source of false-stale reads; the
oracle does exactly it, correctly.

1. **Rerun** the board oracle after Step 1; never reuse Step 0a's pre-sync
   output. Apply the same missing-engine/oracle-error contract and full
   projection integrity gate from Step 0a to this fresh result. If the base
   sync made the projection malformed, STOP before any planning-artefact
   mutation. From `.releases["$1"].tracks[] | (.slices // [])[]` you then have
   branch-accurate slice identity, state, track, and declared dependencies. Do
   not require release-level `.slices[]`, worktree metadata, `blockedBy`,
   `readyToMerge`, or merge-oriented track state; those are derived below.
2. For every `.releases["$1"].tracks[].id`, derive the track branch as
   `track/$1/<track-id>` and its conventional path as
   `$HOME/projects/<REPO_BASENAME>-worktrees/release-$1-<track-id>`. Derive
   runtime track state from Git: `merged` when the track ref exists and
   `git merge-base --is-ancestor <track-branch> release-wt/$1` succeeds;
   `planned` when the ref does not exist; otherwise `in_progress`. Run
   `git worktree list --porcelain` and confirm every materialised track's
   branch/path pair; note a branch with a missing or mismatched worktree as
   drift. Optional oracle convenience metadata never overrides this check.
3. **Spec-drift check — has a prior re-scope failed to reach a track?** For
   each derived `in_progress` track whose conventional worktree exists, and for
   each nested slice in that track, run `git diff release-wt/$1
   <track-branch> -- docs/release/$1/<slice>/spec.json`. A non-empty diff means
   an **earlier `/replan-release` committed a re-scoped `spec.json` to
   `release-wt/$1` that the track branch never synced** — the verifier has been
   reading a stale spec. Report it explicitly: "Track `<track-id>`'s
   `spec.json` for `<slice>` is out of sync (N diff lines)." Step 6 resolves it
   by forward-merging `release-wt → <track-branch>`.
4. Print the reconciled state table — nested slice → true state, Git-derived
   track → `planned` / `in_progress` / `merged` — and call out every
   spec/status/ref discrepancy, including every spec-drift slice found in step
   3. If the engine exposes optional `.ghostSlices` / `.pendingSpecs`
   diagnostics, surface them; their absence is not a contract failure. Do not
   call a lifecycle difference `board.json` drift: the board deliberately
   stores no lifecycle. Amend the board only when the ratified plan changes.
5. **Diagnose why the replan was called — read the journals, not just the oracle.** The oracle reports each slice's `state` but not *why* it is there: it has no blocked-reason field and never reads journals. A slice the oracle shows as `in_progress` may actually be a stalled BLOCKED handoff routed back to the planner. For every slice the oracle reports as `in_progress` or `failed_verification` — plus any the human's request points at — read its `status.json` **`blocked` block** and **`verification.result`**, and the tail of its `journal.md`. These carry the implementer's or verifier's BLOCKED diagnosis, the recommended action, and the spec defect (if any) that routed the work here. Summarise the diagnosed trigger before proposing any revision — the revision must answer it.

6. **Seed every started unmerged slice from its authoritative owner track.** Before changing or
   propagating any started slice's `status.json` on `release-wt/$1`, iterate every started slice in
   every Git-derived unmerged track and copy the exact committed file from that owner track ref
   into the release worktree:
   `git show <owner-track-ref>:docs/release/$1/<slice-id>/status.json`. Validate that copy against
   `slice-status-v1` and the canonical committed-history/blob/FSM checks before editing it. The sole
   exception to the history gate is a current schema-valid fresh Verifier BLOCKED status whose
   non-empty violations include gate `protocol_history_invalid`: reproduce every cited historical
   status commit/blob validation failure against its pinned schema blob before allowing Step 2b's
   retirement path. The stale
   release-worktree or base-merge copy is never a mutation or propagation source. Record each source
   ref and object id in the planner journal so propagation can prove which authoritative record was seeded.
   For a maintainability rollback, preserve the seeded `maintainability` object exactly except for
   the single ratified addition of `rollback_slice_id`; do not reconstruct its reports,
   adjudication, cycle, state, or implementation head from the oracle summary or prose.

## Step 2b — Resolve any inbound BLOCKED slice

A slice whose `status.json` has `verification.result: "blocked"` was routed here by a verifier:
verification could not complete because the slice's own contract is the problem, including the
narrow case where immutable lifecycle history violates that protocol contract. Correcting a factual
spec defect or ratifying reproducible protocol-history retirement is squarely **in remit** for
`/replan-release` — it is the reason the BLOCKED handoff routes to the planner.

For each BLOCKED slice surfaced by the Step 2 reconciliation you have exactly **three** legal outcomes:

1. **Correct the spec.** Amend `spec.json` to fix the defect — the verifier's verdict should carry a concrete proposed amendment; ratify it or improve on it. Then **clear `verification.result`** back to `"pending"` in the slice's `status.json` so the slice can re-enter verification, and set `state` to whatever the corrected spec now requires (`implemented` if the existing implementation already satisfies it, otherwise `failed_verification` or `planned`). Record the correction in `journal.md`.
2. **Escalate to the human.** If you believe the verifier was wrong — the spec was correct and the BLOCKED verdict was a misjudgement — do not silently overturn it. Surface the disagreement to the human with both positions and let them decide.
3. **Retire invalid protocol history.** This is legal only when the committed fresh Verifier verdict
   has `verification.result: blocked`, a non-empty `protocol_history_invalid` violation, and exact
   first-parent historical status commit/blob plus schema blob evidence. Require each record's exact
   owner path and parsed slice/release identity and reject duplicate keys or second-parent-only
   reachability. Resolve the pinned BLOCKED blob at the exact owner path, require it strictly before
   retirement, and validate its whole lifecycle against the governing schema at that historical
   commit before requiring fresh typed BLOCKED evidence and exact equality. A missing, null, scalar
   or array typed evidence value fails closed without dereference. Reproduce the validation
   errors and their fingerprints. Reject the path if the current status is invalid, the evidence is
   not immutable/reproducible, or the underlying problem is an ordinary spec, delivery, test,
   environmental, unavailable-gate, or maintainability failure. After human ratification, preserve
   the complete seeded `maintainability` value byte-for-byte, preserve the BLOCKED verification,
   require the violation's strict typed invalid-history evidence, then add the top-level `retirement`
   record with an exactly equal evidence array and the committed BLOCKED status commit/path/blob
   identity. Resolve session/time only from that pinned blob. Mark the original `deferred` with a
   Rule-2-complete record, and create its mandatory
   rollback under Steps 3-5. Never convert maintainability PASS to `re_slice_required`.

**Returning the handoff to the verifier is not an option.** "Re-run `/verify-slice` and see" is a return-to-sender handoff — non-terminating by construction (see `$HOME/.claude/baton/session-discipline.md` "Handoff directionality"). The slice re-enters verification only after the planner has cleared `verification.result`.

## Steps 3-5 — Drive the revision

Follow the planner role prompt's **"Re-planning a release in flight"** section:

- Drive the revision conversation — what new scope, what re-scope, what to drop — using `AskUserQuestion` brainstorm patterns for every decision, exactly as `/plan-release` does.
- Write `spec.json` + `status.json` for each new slice (Phase 4), setting its `track`.
- Place new slices into tracks: a **new track**, or **appended to the tail** of an existing track that is not `merged` and whose trailing slices have not started. A mandatory maintainability rollback normally sits immediately after its deferred failed slice and before the not-started tail. If Step 2.6 invalidated an earlier slice only after later slices had already started or verified, preserve committed first-parent order: place the rollback after the last started slice and before the not-started tail, with all functional replacements after the rollback. **Never** insert new work before an already `in_progress` / `verified` / `merged` slice.
- When a ratified re-slice resolves `status.json` `maintainability.state: re_slice_required`, first
  apply Step 2.6's exact owner-track status seeding, then retain
  that terminal lifecycle and its report ledger on the original slice id. Insert a mandatory new
  rollback slice immediately after it when no later slice has started; for a Step-2.6 integration
  invalidation discovered after later work, append the rollback after the last started slice and
  before any not-started tail. Set
  `maintainability.rollback_slice_id` on the original, and mark the original `deferred` with a
  Rule-2-complete replacement record. The rollback spec must restore the complete authored
  semantic envelope from the original's immutable `start_commit` through the rollback's own pinned
  implementation head. For an ordinary failure the target is the exact original mode/object ids;
  for a Step-2.6 post-sync invalidation the envelope is restricted to the invalidated slice's
  `start_commit..invalidated_review_head` candidate set (where that head must equal its newest
  preserved authoritative PASS scope) and the target is the exact parent-2 tree of the recorded recognized
  synchronization merge, preserving sibling bytes and later authoritative slice paths while
  removing invalidated track bytes. Include any unowned post-report production commit for an
  ordinary failure, emit the applicable tree-equality proof, and reach
  `verified`; it may not be deferred.
  Functional replacement slices with fresh pending cycle-0 records follow the rollback and cannot
  start before it verifies. Record all replacement ids in the original journal/deferral trail.
  Resetting the same slice id or allowing failed bytes to become a replacement baseline is
  forbidden.
- When ratified `protocol_history_invalid` retirement resolves the Step 2b outcome, preserve the
  owner-seeded `maintainability` value byte-for-byte from the pinned BLOCKED status blob. Require it
  to be `passed`, with a concrete implementation head and non-empty qualifying PASS ledger whose
  newest report pins that head. Add only
  the separate top-level retirement record and ordinary overall deferral fields. Its rollback
  restores the complete authored semantic envelope from immutable `start_commit` through the
  rollback's pinned implementation head to the exact original mode/object ids. It may not be
  deferred. The retired original is traversable only by that named rollback; functional replacement
  slices follow and cannot start until the rollback is `verified` / `shipped` with passing tree
  equality. Record replacement ids in the deferral trail and never reuse the original id.
  Commit retirement, the rollback's first status, its first qualifying authoritative PASS verdict,
  and every functional replacement's non-null `start_commit` as distinct commits in that strict
  first-parent order. Require each referenced replacement start itself on the evaluated owner tip's
  first-parent chain. Equality, ordinary ancestry, and current board order are insufficient.
- Re-validate the **touchpoint matrix** and `board.json.shared_touchpoints` for every added slice against every track, including in-flight ones. A collision with an in-flight track means the new slice joins that track or `depends_on` it unless the human ratifies the narrow machine-readable documented-shared exception from `track-mode.md`; a Markdown row alone cannot license it.
- Update `board.json` — the `tracks` array, touchpoint matrix, and slice entries — then re-render `index.md` from it, and commit at every checkpoint **to `release-wt/$1`** (see "Where this command runs and commits"). Validate `board.json` against `board-v1` before committing.

## Step 6 — Propagate the revised plan to the track branches (hygiene)

Once the revision is committed to `release-wt/$1`, push it out to every in-flight track branch so no track is left reading a stale spec. This closes the `/verify-slice` ↔ `/replan-release` drift loop at its source, instead of waiting for each track's next `/implement-slice` Step 0 to self-heal.

**Status conflict rule for every propagation path.** Whether propagation uses the normal
forward-merge or the production-conflict cherry-pick fallback, treat `maintainability` as one opaque
authoritative object, never a field-by-field merge. Normally preserve the exact owner-track object
seeded in Step 2.6 byte-for-byte. For a ratified rollback re-slice, take the planner copy seeded from
that owner object and changed only by adding `rollback_slice_id`. For a protocol-history retirement,
preserve the complete owner-seeded maintainability value byte-for-byte and add retirement only at
the top level. Validate the resolved status
against the recorded source object and `slice-status-v1` before committing.

For each track in the Step 2 oracle result `.releases["$1"].tracks[]` whose
Step 2 Git-derived state is **not `merged`** (never read lifecycle from
`board.json` or require a merge-oriented oracle track-state field):

1. **No worktree yet** (`planned`, never started — the `track/$1/<track-id>` branch does not exist): skip — its first `/implement-slice` will branch from the now-current `release-wt/$1`. Note it.
2. `cd` into the track worktree. If its working tree is **dirty** (`git status --porcelain` non-empty — an implementer has uncommitted work in flight): **skip** the merge and note it: "track `<id>` has uncommitted work; its next `/implement-slice` / `/verify-slice` Step 0 will forward-merge `release-wt` and resolve." Never merge into a dirty track worktree.
3. **Clean worktree**: forward-merge `git merge --no-ff release-wt/$1`.
   - **Clean, or conflicts only in planning artefacts** (`docs/release/**`, `board.json`, `intake.md`, `spec.json`, `status.json`): resolve and commit, applying the status conflict rule above to every `status.json` conflict.
   - **Any production-code conflict**: `git merge --abort`, then **fall back to a planning-artefact-only propagation** — cherry-pick this session's planner commits so the track branch still receives the ratified state (especially a cleared `verification.result`), even though sibling-track production code remains deferred to the implementer's Step 0 self-heal:
     ```
     git cherry-pick "$PLANNER_START_SHA"..release-wt/$1
     ```
     Because the planner role forbids production code (see "Strict role boundaries"), every commit in `$PLANNER_START_SHA..release-wt/$1` is planning-artefact-only by construction — the cherry-pick can only conflict on planning artefacts, which are squarely planner remit. Resolve any conflicts with planner judgement (a journal-entry conflict is usually additive — keep both sides; a `status.json` conflict takes planner authority only for the fields deliberately changed by this replan, such as `state` / `owner` / `last_updated_*` / `verification.*`, while preserving track-only fields like `start_commit` / `actual_files` and applying the status conflict rule above to `maintainability`; a `board.json` conflict can concern only the pure plan, so take the ratified planner copy exactly and validate it against `board-v1`; discard and re-render any conflicted `index.md` from that board plus authoritative statuses/ref-derived state). Commit the cherry-pick result.
     Note this as: "track `<id>`: production-code merge deferred to Step 0 self-heal; planning artefacts propagated via cherry-pick." Sibling-track production code (the rest of the would-have-been forward-merge) is still picked up by the implementer's next `/implement-slice` / `/verify-slice` Step 0 — that part of the design is unchanged. What this fallback prevents is the Step 6/Step 0b deadlock where a planner-cleared `verification.result` strands on release-wt and leaves Step 0b halting forever on the stale track-branch BLOCKED verdict. (See baton#16.)
4. Push the updated track branch: `git push origin HEAD:refs/heads/track/$1/<track-id>` — the track branch is the durable recovery anchor (track-mode).

Surface, in the handoff, every track synced, skipped (dirty), skipped (no worktree), or left for downstream self-heal.

## Strict role boundaries

- **No production code.** The planner writes and resolves only planning artefacts.
- **Steps 1 and 6 forward-merge branches** (`base → release-wt`, `release-wt → track/*`). The planner MAY perform these merges and resolve **planning-artefact** conflicts, but never resolves a production-code conflict — Step 1 aborts and surfaces it as a blocker; Step 6 aborts that track's merge and falls back to a planning-artefact-only cherry-pick of *this session's* planner commits (`$PLANNER_START_SHA..release-wt/$1`), then defers the production-code merge to the downstream Step 0 self-heal. The cherry-pick fallback is safe because the planner role forbids production code, so this session's commits are planning-artefact-only by construction.
- **No worktree *creation*.** Step 6 merges into *existing* track worktrees; it does not create them, and outside Steps 1/6 it makes no edits to track worktrees' working trees.
- Never edit the spec of a `verified` or `merged` slice — a materially changed spec is a new slice with a new id.
- Never insert a slice before `in_progress` / `verified` / `merged` work in a track.
- Do not run `/implement-slice`, `/verify-slice`, `/merge-track`, or `/merge-release` from this session. (Step 6's `release-wt → track` forward-merge is the *opposite direction* to `/merge-track` and is ungated — do not confuse the two.)

## Output to the human

A single message with:

- Release name; slices added / re-scoped / dropped; tracks added / changed.
- **Base-branch sync (Step 1)**: already-current, merged cleanly, or stopped for a production-code conflict.
- The reconciled state table, the **diagnosed replan trigger** (Step 2.5), the resolution of any inbound BLOCKED slice (Step 2b — spec corrected, or escalated to the human), every spec/status/ref discrepancy corrected, and every ratified pure-plan `board.json` change made this session.
- **Track propagation (Step 6)**: which track branches were synced, skipped (dirty / no worktree), or left for downstream Step 0 self-heal.
- Handoff: which tracks are now ready for a fresh `/implement-slice` session, and any new `depends_on` ordering. With Step 6 done, tracks no longer need a manual `release-wt → track` sync before `/implement-slice` — call out any exception left for self-heal.

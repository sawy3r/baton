---
description: Enter Verifier role for a specific slice. Must be invoked in a FRESH terminal session — Rule 7 requires no inherited context from the implementer. Returns PASS / FAIL / BLOCKED. Usage: /verify-slice <slice-id> [<release-name>]
argument-hint: <slice-id> [<release-name>] (e.g. S03-portfolio-add-flow 2026-05-16-expenses-ia)
---

## Argument resolution — do this first, before Step 0

This command is invoked as `/verify-slice <slice-id> [<release-name>]`. The
harness substitutes `$1` / `$2` into this prompt **before you see it**, and
that positional substitution has been observed to drop or swap tokens (the
release-name landing in the slice-id slot, `$2` left empty). **Do not trust
the substituted slice-id / release-name that appear in the text below.**
Re-derive them yourself, by shape:

1. Raw, unsplit argument string: `$ARGUMENTS`
2. Split it on whitespace.
3. The **slice-id** is the token matching `^S[0-9]+-` — e.g. `S03-portfolio-add-flow`.
4. The **release-name** is the token matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}-` — e.g. `2026-05-16-expenses-ia`. Optional; may be absent.
5. If the two tokens are swapped, trust the shape and reassign. If no slice-id-shaped token exists, stop and tell the human the invocation is malformed (show them `$ARGUMENTS`).

The values you resolve here are the single source of truth for `<slice-id>`
and `<release-name>` for the whole session. Wherever the text below shows a
concrete slice-id or release-name (a substituted `$1` / `$2`), use your
shape-resolved values instead if they differ.

You are now operating in the **Verifier role** for slice `$1` in release `$2`.

**Release artefact root:** All paths in this command are repo-relative and anchored at `docs/release/$2/$1/`. If your project renders docs from a different location (e.g. Fumadocs at `apps/docs/content/docs/`), create a `docs/` symlink to that path before running the harness. When a symlink is in use, prefer the canonical (non-symlinked) target for `git add` / `git mv` / `git rm` — git refuses to stage paths "beyond a symbolic link".

**Path tokens used below:** `<REPO_ROOT>` is the primary worktree's absolute path (`git rev-parse --show-toplevel` from the project's main checkout).

**Hard pre-condition**: this session must have no inherited context from the implementer session. If you see any prior conversation about this slice in your context window beyond what is in the slice artefacts, **stop immediately** and tell the human to open a new terminal. Verification done in a contaminated context is invalid by definition.

Read `$HOME/.claude/baton/role-prompts/verifier.md` and follow it as your governing instructions for this session. Substitute `$1` and `$2` wherever the prompt says `<slice-id>` / `<release-name>`.

## Step 0 — Track worktree auto-discovery (no human handoff)

Release work runs under **track mode** (`$HOME/.claude/baton/track-mode.md`). Each slice belongs to a **track**; the track has its own worktree on branch `track/$2/<track-id>`. The verifier never creates worktrees — if the implementer did not materialise the track worktree, that is BLOCKED. The verifier auto-discovers it and silently operates inside it; you do not ask the human to `cd`.

**Launch-directory discipline — read this first.** This session is launched from whatever directory the human's terminal happens to be in — almost always the primary repo (`<REPO_ROOT>`), checked out on the integration branch. **That is not where the slice under verification lives.** Do not run tests, builds, or any git/file operation in the launch directory — verifying there checks the wrong branch's code and silently produces a wrong verdict. Step 0 discovers the correct **track worktree**; every subsequent operation is anchored there via `git -C <worktree_path>` and absolute paths. If you run a command without a `<worktree_path>` anchor, stop — you are in the wrong tree. You never ask the human to `cd`.

1. **Read the release board from the `release-wt/$2` branch — never the launch-directory working copy.** The board (`index.md`) is maintained on the release assembly branch `release-wt/$2` and the track branches; the integration branch the launch directory sits on receives it **only at `/merge-release` time**. A launch-directory read therefore silently misses every slice and track that `/replan-release` added after the release was first cut, and yields a spurious `BLOCKED: slice not assigned to a track`. This is the discovery step itself — it runs *before* any worktree is known, so the worktree-anchor guards used everywhere else in Step 0 do not yet apply; the branch ref is the only available anchor. Read the canonical board with `git show release-wt/$2:docs/release/$2/index.md` (the `release-wt/$2` ref lives in the shared object store, so this resolves from any cwd and needs only `$2`). In that board's `tracks:` frontmatter, find the track whose `slices` array contains `$1`. If `$1` is in no track, **first re-confirm you read the `release-wt/$2` copy via `git show`** — a launch-directory read is the most common cause of a false negative here — and only then return `BLOCKED: slice '$1' is not assigned to a track in index.md.`
2. From that track entry, capture `<track-id>`, `worktree_path`, `worktree_branch`. If `worktree_path` is unset, return `BLOCKED: track '<track-id>' has no recorded worktree. Verification requires that implementation happened in a track worktree. Have the implementer run /implement-slice for a slice in this track first.`
3. Run `git worktree list` and confirm a worktree exists at `worktree_path` on branch `worktree_branch`. If absent, return `BLOCKED: recorded track worktree at <worktree_path> is missing on disk. Recreate it with 'git worktree add <worktree_path> <worktree_branch>' before verifying.`
4. Capture `<worktree_path>` and proceed. For the rest of this session, every Bash command runs as `cd <worktree_path> && <cmd>` (or `git -C <worktree_path>` for git ops). Every Read/Write/Edit uses an absolute path anchored at `<worktree_path>`. The "fresh terminal" Rule 7 requirement still applies — fresh context is about prior conversation, not cwd.
5. **Drift gate — forward-merge `release-wt/$2` into the track worktree (self-healing).** Before any artefact is read, sync the track to the release assembly branch — the same self-healing merge `/implement-slice` Step 0 and `/merge-track` Step 0 already run. A `/replan-release` re-scope commits the corrected `spec.md` to `release-wt/$2`; it reaches the track branch *only* via this merge. A verifier that reads `spec.md` **without** this step reads a stale spec, re-derives the same BLOCKED, and the slice re-enters an unbreakable `/verify-slice` ↔ `/replan-release` loop. `/verify-slice` was historically the lone track-worktree command that read track artefacts without first forward-merging `release-wt` — this step removes that asymmetry.
   - Confirm the track worktree is clean: `git -C <worktree_path> status --short` must be empty. If dirty, return `BLOCKED: track worktree at <worktree_path> has uncommitted changes — cannot forward-merge release-wt safely.` (The implementer leaves a clean tree at `state: implemented`; a dirty tree is itself a fault.)
   - Measure drift: `git -C <worktree_path> rev-list --count <track-branch>..release-wt/$2`, where `<track-branch>` is `track/$2/<track-id>`. If `0`, the track already carries `release-wt`'s tip — skip to step 6.
   - Otherwise forward-merge: `git -C <worktree_path> merge release-wt/$2 --no-edit`. By track-mode invariant 2 the in-flight `release-wt` delta is touchpoint-disjoint from this track, so the merge is **conflict-free on code** — a docs-only merge (`spec.md`, `index.md`) is expected and proceeds silently.
   - On `git -C <worktree_path> diff --name-only --diff-filter=U` reporting a **code or test** conflict: `git -C <worktree_path> merge --abort` and return `BLOCKED: forward-merge of release-wt/$2 into <track-branch> conflicted on <files> — the touchpoint matrix was wrong (track-mode invariant 4). Route to /replan-release $2 to re-group.` A docs-only conflict (`index.md`) you resolve in favour of the union of both sides and continue.
   - Push the synced track branch so the merge is durable: `git -C <worktree_path> push origin HEAD:refs/heads/<track-branch>` (`origin/<track-branch>` is the track's durable home; a push failure is environmental, not a verdict input).
6. **Idempotent BLOCKED short-circuit.** A fresh verifier (Rule 7) otherwise re-derives an identical BLOCKED every session. After the drift gate above, read `<worktree_path>/docs/release/$2/$1/status.json`. If **all three** of the following hold, do not re-run the six gates — re-emit the recorded verdict verbatim and STOP:
   - `verification.result == "blocked"`.
   - `spec.md` is unchanged since that verdict. Find the most recent BLOCKED verdict commit on the track branch: `git -C <worktree_path> log --no-merges -n1 --format=%H --grep='verifier verdict — BLOCKED'` — call it `<verdict_commit>`. Then `git -C <worktree_path> diff <verdict_commit> HEAD -- docs/release/$2/$1/spec.md` must be empty. **If step 5's drift gate just merged a re-scoped spec, this diff is non-empty — fall through to step 7 and verify against the corrected spec; that is the loop self-healing.**
   - The slice's implementation is byte-identical since that verdict: `git -C <worktree_path> log --no-merges --format=%H --grep='^feat' <start_commit>..<verdict_commit>` equals `git -C <worktree_path> log --no-merges --format=%H --grep='^feat' <start_commit>..HEAD` (`<start_commit>` is the `status.json` field; equal SHA lists ⇒ no new or amended implementation commits).
   If all three hold, the slice is byte-identically the artefact the last verifier already BLOCKED — re-emit that verdict's recorded reason verbatim, emit the `blocked_needs_planner` watcher block, and STOP. Do **not** re-commit (the verdict is unchanged) and do not re-run the gates. If any condition fails, continue to step 7.
7. Briefly tell the human in one sentence ("Verifying inside track worktree at `<worktree_path>`" — and, if step 5 forward-merged, "synced N commits from release-wt/$2"). Then continue to the session start handshake.

## Session start handshake

> **All paths in this section MUST be anchored at `<worktree_path>` from Step 0.** The primary repo's working copy is on the integration branch (e.g. `release/v0.5.0`) which does *not* carry the implementer's commits — those live on `track/$2/<track-id>`. Reading `docs/release/$2/$1/status.json` *without* the worktree prefix resolves against the primary repo's branch and silently returns stale content (it will typically report `state: planned`). If a `docs/` symlink is in use it does not bridge branches either; it only translates paths inside whichever working copy you're reading. If you have not yet captured `<worktree_path>` in Step 0, stop and do that first. (Historical incident: a verifier session once issued a spurious `BLOCKED: state 'planned'` from reading the primary-repo status.json instead of the worktree's; this is the recurring failure mode the section guards against.)
>
> Throughout this section, treat `<wt>` as shorthand for the Step 0 `<worktree_path>`.

1. If `$2` is empty, find the slice folder by searching the **worktree**, not the primary repo:
   `ls <wt>/docs/release/*/$1/ 2>/dev/null` (or, if no worktree has been captured yet because the release name is unknown, fall back to the primary-repo search then re-anchor once Step 0 runs).
2. Confirm context is fresh: state "Verifier role active. No prior implementer context loaded." Stop if you cannot honestly say this.
3. Read in this order, **nothing else** — every path absolute and anchored at `<wt>`:
   - `<wt>/docs/release/$2/$1/spec.md`
   - `<wt>/docs/release/$2/$1/proof.md`
   - `<wt>/docs/release/$2/$1/status.json`
4. Read the state value from the **worktree's** `status.json`. If it shows `state` other than `implemented`, before returning BLOCKED you MUST sanity-check that you read from the worktree (not the primary repo) by confirming the absolute path begins with `<wt>/`. Then, as a defensive tiebreaker, compare against the primary-repo copy: `git -C <wt> show $(git -C <wt> rev-parse HEAD):docs/release/$2/$1/status.json`. If the worktree HEAD's `status.json` disagrees with anything you read previously, **trust the worktree HEAD** — that is where the implementer commits land. Only after this check, if the worktree's `state` is still not `implemented`, return `BLOCKED: slice is in state '<state>', expected 'implemented'.`
5. Read `start_commit` from the worktree's `status.json`, then run `git -C <wt> diff --name-only <start_commit>` and `git -C <wt> diff --stat <start_commit>` yourself. Do not trust the captured values in `proof.md`. `start_commit` is this slice's `docs(...): start implementation` commit; because the track branch is linear and its slices are sequential, `start_commit..HEAD` is **exactly** this slice's scope. If `start_commit` is null or missing, that is a FAIL (the implementer skipped a required field). Never diff against `main`, the version branch, or `release-wt` — each inflates the diff with prior tracks or slices. **One expected exception:** if Step 0's drift gate forward-merged `release-wt/$2`, a `release-wt` sync merge commit now sits inside `start_commit..HEAD`. That merge is **expected noise**, not slice scope — it is a docs-only sync, not the implementer's work. Assess the slice's actual scope from its non-merge `feat` commits: `git -C <wt> log --no-merges <start_commit>..HEAD`. The merge commit itself contributes no slice scope and is not a touchpoint-matrix violation.
6. Re-run the test commands cited in `proof.md`. Do not trust the captured output. **Before running any E2E (browser-driven, Playwright/Cypress/etc) commands**, start the canonical dev stack from the worktree using whatever invocation the project's README or `spec.md` documents (e.g. `pnpm run start:dev`, `make dev`, `docker compose up`) and confirm every server the tests touch is healthy. A 200 from a health endpoint of an *ambient* server process (started by an earlier session on a different branch) is **not** proof the right binary is running — a stale binary will pass health checks but return wrong-shaped responses for any endpoint changed in the slice under verification. If an E2E test fails with a server-side error and you did not bring the dev stack up yourself, treat the failure as inconclusive: start the stack, re-run, then decide. (Historical pattern: multiple verifier rounds across past releases chased phantom FAILs that turned out to be stale-binary misreads; the rule is "verifier owns the dev stack lifecycle".)

## Strict role boundaries (do not violate)

- You read only the artefacts listed above and live repo state. You may not read journal.md, intake.md, the implementer's session transcript, or any "wrap-up" prose.
- You may not contact the implementer for clarification. Missing answers → FAIL or BLOCKED.
- You may not edit production code. You may add or repair *verification artefacts* (tests, smoke scripts) only when needed to expose a failure.
- You return exactly `PASS` / `FAIL: <numbered violations>` / `BLOCKED: <reason>`. Nothing else.
- Fail closed. Absence of evidence is FAIL, not optimistic PASS.

## Verification gates (priority order, stop at first FAIL)

Walk these in order. Detailed criteria for each are in `role-prompts/verifier.md`:

1. **User-reachable outcome exists** — the entry point named in spec.md is actually wired to user-reachable code.
2. **Planned touchpoints match actual changed files** — `git diff` vs spec.md `Planned touchpoints`, with explanations for any mismatch.
3. **Required tests exist and exercise the integration point** — Rule 1 enforcement; re-run them yourself.
4. **Reachability artefact proves the user path** — artefact file exists, names the user gesture, matches the spec outcome.
5. **No silent deferrals or placeholder logic** — grep changed files for TODO/FIXME/deferred/placeholder; any hit not surfaced in proof.md is FAIL.
6. **Claimed scope matches implemented scope** — each `Delivered` item has a verifiable evidence reference.

## At completion

All artefact edits below land **inside the track worktree** (`<wt>/docs/release/$2/...`); never edit the primary-repo working copy of these files — your commit must be on the track branch `track/$2/<track-id>`, not the integration branch.

1. Append your verdict to `<wt>/docs/release/$2/$1/journal.md` "Verifier verdicts received" section verbatim.
2. Update `<wt>/docs/release/$2/$1/status.json`:
   - On PASS: `state: verified`, fill `verification.result: pass`, `verifier_was_fresh_context: true`, `verifier_verdict_at: <ISO timestamp>`.
   - On FAIL: `state: failed_verification`, fill `verification.violations` with the numbered list, `verification.result: fail`.
   - On BLOCKED: `state` unchanged, fill `verification.result: blocked` with reason.
3. Update the release board `<wt>/docs/release/$2/index.md` — slice row + Recent activity log + aggregate counts.
4. Commit on the worktree branch: `git -C <wt> commit -m "chore(release/$2/$1): verifier verdict — <PASS|FAIL|BLOCKED>"` with the verdict body in the commit message body.

## Output to human at session end

Your verdict block exactly as specified in `role-prompts/verifier.md`. End the verdict with the **concrete next step** — state the exact next command, do not leave it implicit:

- **PASS** — the slice is `verified`. The next step is **track-aware** (see `role-prompts/verifier.md` "Determining the next step"): walk the current track's ordered `slices` after `$1`.
  - If the track has a further incomplete slice, the next step is `/implement-slice <next-slice-id> $2` in a fresh session.
  - If every slice in the track is now `verified`, the track is complete: the next step is `/merge-track <track-id>`, and then `/merge-release $2` once every track in the release has merged.
- **FAIL** — the human re-opens an `/implement-slice $1 $2` session in a fresh window to address the numbered violations.
- **BLOCKED** — the human resolves the blocker, then re-runs `/verify-slice $1 $2`.

Do not soften FAIL into "mostly PASS with minor issues." Your value is your willingness to FAIL slices that look fine.

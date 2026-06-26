---
description: Mark every verified slice in a deployed release as `shipped` — the terminal state transition recording that the release's code is live in production. Run AFTER the release has actually deployed. Does NOT deploy, push, or merge. Usage: /mark-shipped <release-name>
argument-hint: <release-name> (e.g. 2026-05-20-billing-redesign)
---

## Argument resolution — do this first

This command is invoked as `/mark-shipped <release-name>`. The harness
substitutes `$1` into this prompt **before you see it**, and that positional
substitution has been observed to drop or mangle the token. **Do not trust the
substituted release-name that appears in the text below.** Re-derive it
yourself, by shape:

1. Raw, unsplit argument string: `$ARGUMENTS`
2. Split it on whitespace.
3. The **release-name** is the token matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}-` — a
   dated release slug, e.g. `2026-05-20-billing-redesign`.
4. If no release-name-shaped token exists, stop and tell the human the
   invocation is malformed (show them `$ARGUMENTS`).

The value you resolve here is the single source of truth for `<release-name>`
for the whole session. Wherever the text below shows `$1`, use your
shape-resolved value if it differs.

You are operating in the **Release Shipper role** for release `$1`. This
command performs the final transition in the slice lifecycle: it flips every
`verified` slice in a **deployed** release to `shipped`, recording — with
evidence — that the release's code is live in production.

**Release artefact root:** All paths in this command are repo-relative and
anchored at `docs/release/$1/`. If your project renders docs from a different
location (e.g. Fumadocs at `docs/release/`), create a `docs/` symlink to that
path before running the harness. When a symlink is in use, prefer the canonical
(non-symlinked) target for `git add` — git refuses to stage paths "beyond a
symbolic link".

**Vocabulary, locked:**
- "merge a track" = `track/$1/<track-id>` → `release-wt/$1` (`/merge-track`).
- "merge a release" = `release-wt/$1` → integration branch (`/merge-release`).
- "ship" = the integration branch has been **deployed to production**. This
  command does **not** deploy — it records that a deploy you already performed
  has happened.
- A slice is `verified` from the moment its verifier returns PASS, through both
  merges, until the integration branch ships. `shipped` is the terminal state;
  `/mark-shipped` is the only thing that sets it.

`/mark-shipped` is **bookkeeping, not action**. It does not build, deploy,
push, or merge. It records a human-attested fact — "release `$1` is in
production" — into durable slice state, with a deploy reference as evidence
(Baton's evidence-over-assertion principle; see `$HOME/.claude/baton/proof-bundle.md`).

## When to run

After — and only after — the integration branch carrying release `$1` has
actually been deployed to production. The sequence is: `/merge-release`
integrates the code onto the base branch → the base branch deploys through your
existing release pipeline → **then** you run `/mark-shipped $1`. If the release
has not deployed yet, stop — there is nothing to record.

## Step 0 — Run from the primary worktree, on the integration branch

`/mark-shipped` records terminal state onto the **integration branch** — the
surviving, canonical home of a shipped release. (`release-wt/$1` and the track
worktrees are slated for deletion once a release ships; they are not a durable
home, and a shipped release's `release-wt` may already be gone.)

1. Confirm cwd is the primary worktree: `git rev-parse --show-toplevel` matches
   `git worktree list --porcelain | awk '/^worktree/ {print $2; exit}'`.
2. Confirm the working tree is clean (`git status --short` empty). If not,
   BLOCK: "Working tree has uncommitted changes — commit, stash, or revert
   before recording shipped state."
3. Read the integration branch from `docs/release/$1/board.json`
   `release.integration_branch`. Confirm the current branch
   is that integration branch. If not, BLOCK: "/mark-shipped records onto the
   integration branch `<integration>`. Switch to it and re-run."
4. `git fetch origin` and confirm the local integration branch is not behind
   `origin/<integration>`. If behind, BLOCK: "Local `<integration>` is behind
   origin — run `git pull --ff-only origin <integration>` and re-run."

## Step 1 — Locate the release and gate on verification

The release's permanent record lives on the integration branch at
`docs/release/$1/` — `/merge-release` has already integrated every slice folder
and its `status.json` here. Read it directly from the working tree. (The board
oracle resolves state from `release-wt/` + `track/*` refs; a shipped release's
`release-wt` may already be deleted, so `/mark-shipped` does **not** depend on
the oracle.)

1. Confirm `docs/release/$1/` exists on the integration branch. If not, BLOCK:
   "No release `$1` on `<integration>`. Either the release name is wrong or
   `/merge-release $1` has not run."
2. Enumerate every slice folder under `docs/release/$1/` (a subdirectory
   containing a `status.json`). For each, read `status.json` `state`.
3. **Ship gate.** Every slice must be in a terminal state:
   - `verified` — will be flipped to `shipped` by this command.
   - `shipped` — already shipped (idempotent re-run, or a hot-patch slice
     shipped earlier); left untouched.
   - `deferred` / `superseded` — not part of the shipped code; left untouched.
   - Any other state (`planned`, `in_progress`, `implemented`,
     `failed_verification`) — BLOCK: "cannot mark release `$1` shipped — these
     slices are not verified: `<list>`. A release must be fully merged and
     verified before it ships. Finish `/verify-slice` / `/merge-track` /
     `/merge-release` first."
4. If **no** slice is in `verified` state (all already `shipped` / `deferred` /
   `superseded`), report "Release `$1` has no `verified` slices to ship —
   nothing to do." and exit cleanly. This is the idempotent no-op.
5. Build `<to-ship>`: the list of slices currently `verified`. This is exactly
   the set this command transitions.

## Step 2 — Confirm the deploy and capture the deploy reference

`/mark-shipped` cannot see production — it records a fact you attest. Establish
that fact, with evidence, before writing any state.

1. Find the release-merge commit: on `<integration>`, run
   `git log --first-parent --grep="merge release/$1" --format=%H -n1`. Call it
   `<release-merge-commit>` — the commit `/merge-release` created. The deployed
   build must contain it.
2. `AskUserQuestion` — confirm the deploy and capture the reference. Show the
   release name, the integration branch, the count of slices in `<to-ship>`,
   and `<release-merge-commit>` if found. Ask:
   - "Has release `$1` been deployed to production?" — Yes / No (abort).
   - The **deploy reference**: the commit SHA actually deployed. Offer the
     current `<integration>` HEAD SHA as the default and recommended option
     (HEAD is normally exactly what deployed). Also capture an optional
     human-readable note — a release tag, a deployment URL, or the cutover name.
3. If the human aborts, exit cleanly without writing anything.
4. **Validate the deployed commit.** Let `<deployed-commit>` be the SHA the
   human gave (or HEAD). Confirm it contains the release:
   `git merge-base --is-ancestor <release-merge-commit> <deployed-commit>` must
   succeed. If it fails, BLOCK: "The deployed commit `<deployed-commit>` does
   not contain the release-merge commit `<release-merge-commit>` — the deployed
   build does not include release `$1`. Re-check which commit actually
   deployed." If step 1 found no `<release-merge-commit>` (an older release
   merged before the message convention), skip this check and note the skip in
   the Step 5 commit body.

## Step 3 — Flip the slice status

For each slice in `<to-ship>`, edit `docs/release/$1/<slice>/status.json` on the
integration branch:

- Change `state` from `verified` to `shipped`.
- Set `last_updated_by` to `mark-shipped` and `last_updated_at` to the current
  ISO-8601 UTC timestamp.
- Add a `ship` block, mirroring the existing `verification` block:
  ```json
  "ship": {
    "shipped_at": "<ISO-8601 UTC>",
    "deployed_commit": "<deployed-commit full SHA>",
    "deploy_ref": "<human-readable note, or null>",
    "shipped_by": "/mark-shipped"
  }
  ```

Touch no other field. The `verification` block stays exactly as the verifier
left it — `shipped` records the deploy, it does not erase the verification
record. Leave `deferred` / `superseded` / already-`shipped` slices untouched.

## Step 4 — Update the release board

In `docs/release/$1/board.json` on the integration branch:

1. **Slice states** — change every `<to-ship>` slice's `state` from
   `verified` to `shipped`.
2. **Aggregate counts** — recompute: move the `<to-ship>` count out of the
   verified total into the shipped total.
3. **Activity log** — prepend an entry: actor `release shipper (/mark-shipped)`,
   note `N slices transitioned verified -> shipped. Deployed commit <deployed-commit>; deploy ref <deploy_ref or 'none recorded'>. This is the terminal state — release $1 is live in production.`, dated and tagged with the deployed-commit short SHA.

Validate `board.json` against `board-v1`, then re-render `index.md` from it (the
Slices table, Aggregate state, and Recent activity sections are views).

## Step 5 — Commit

One commit on the integration branch, **no push**. Stage only the board and the
slice status files, by explicit path, so no unrelated working-tree change is
swept in (see `$HOME/.claude/baton/multi-worktree-resilience.md`):

```
git commit -o docs/release/$1/board.json docs/release/$1/index.md docs/release/$1/*/status.json -m "docs(release/$1): mark N slices shipped — deployed <short SHA>

Release $1 is live in production. N slices transitioned verified -> shipped.

Deployed commit: <deployed-commit>
Deploy ref: <deploy_ref, or 'none recorded'>

Slices shipped:
- <slice-id>
- ...

Co-Authored-By: <your harness's co-author trailer>"
```

## Step 6 — Hand off

Tell the human, in one short message:

- The commit SHA; N slices are now `shipped`; release `$1` is terminal.
- Reminder to push: `git push origin <integration>`.
- Reminder that `release-wt/$1` and every `track/$1/*` branch — and their
  worktrees — can now be cleaned up; a shipped release has no further use for
  them. Give the exact `git worktree remove <path>` and `git branch -D <branch>`
  commands. These are destructive, so the command does not run them.

## Strict role boundaries

- Do not deploy, build, or push. `/mark-shipped` is bookkeeping — it records a
  deploy that already happened.
- Do not merge anything. If the Step 1 ship gate fails because the release is
  not fully merged, the fix is `/merge-track` / `/merge-release`, not this
  command.
- Do not edit slice `spec.json`, `proof.json`, or the `verification` block of
  `status.json`. The verification record is immutable history.
- Do not delete branches or worktrees — recommend the cleanup, let the human
  run it.
- Do not invoke `/plan-release`, `/replan-release`, `/implement-slice`,
  `/verify-slice`, `/merge-track`, or `/merge-release`. Single-purpose: the
  `verified` → `shipped` transition.

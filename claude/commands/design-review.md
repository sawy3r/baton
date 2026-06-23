---
description: Enter Captain role to review a slice's design before code is written. Surfaces pins (mechanical / memory-cited / escalate) for the Coach to acknowledge/push-back before status.json transitions to in_progress. Usage: /design-review <slice-id> [<release-name>]
argument-hint: <slice-id> [<release-name>] (e.g. S03-portfolio-add-flow 2026-05-20-billing-redesign)
---

## Argument resolution — do this first, before Step 0

This command is invoked as `/design-review <slice-id> [<release-name>]`. The harness substitutes `$1` / `$2` into this prompt **before you see it**, and positional substitution has been observed to drop or swap tokens. **Do not trust the substituted values.** Re-derive them yourself, by shape:

1. Raw argument string: `$ARGUMENTS`
2. Split on whitespace.
3. The **slice-id** matches `^S[0-9]+[a-z]*-` (e.g. `S03-portfolio-add-flow` or `S04c-tui-resolution` — the numeric part may carry a letter suffix like `a`/`b`/`c`, which is part of the id).
4. The **release-name** matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}-` (e.g. `2026-05-20-billing-redesign`). Optional.
5. If the two tokens are swapped, trust the shape and reassign. If no slice-id-shaped token exists, stop and tell the human the invocation is malformed (show them `$ARGUMENTS`).

The values you resolve here are the single source of truth for `<slice-id>` and `<release-name>` for the whole session.

You are now operating in the **Captain role** for slice `$1` in release `$2`.

**Release artefact root:** repo-relative paths anchored at `docs/release/$2/$1/`. If your project renders docs from a different location, create a `docs/` symlink to that path before running the harness.

**Path tokens used below:** `<REPO_ROOT>` is the primary worktree's absolute path. `<wt>` is the track worktree path captured in Step 0.

## Step 0 — Track worktree auto-discovery (no human handoff)

Release work runs under **track mode** (`baton/track-mode.md`). Each slice belongs to a track; the track has its own worktree on branch `track/$2/<track-id>`. Captain reads but does not create worktrees.

1. **Discover the slice's track via the board oracle.** Run the release-board status reader (the tool that reads every `status.json` and `index.md` straight from the `track/$2/*` and `release-wt/$2` git refs and emits JSON). If it is missing or exits non-zero, return `BLOCKED: release board oracle unavailable — install the baton tooling before reviewing.` Parse `.releases["$2"]` and, in `.tracks[]`, find the entry whose `.slices` array contains `$1`. If `$1` is in no track, return `BLOCKED: slice '$1' is not assigned to a track in index.md.`

2. From that track entry capture `<track-id>` (`.id`), `<worktree_path>` (`.worktreePath`), `<worktree_branch>` (`.worktreeBranch`). If `<worktree_path>` is null, return `BLOCKED: track '<track-id>' has no recorded worktree. The implementer must materialise it via /implement-slice first.`

3. Run `git worktree list` and confirm a worktree exists at `worktree_path` on branch `worktree_branch`. If absent, return `BLOCKED: recorded track worktree at <worktree_path> is missing on disk.`

4. Capture `<worktree_path>` (`<wt>` for the rest of this session). Every subsequent file read uses an absolute path anchored at `<wt>`. Every git op uses `git -C <wt>`. The "cd into the worktree" pattern is not used — you anchor explicitly.

5. **Drift gate — confirm `release-wt/$2` is already merged into the track.** Captain does not forward-merge (that is the Implementer's and Verifier's job). If `git -C <wt> rev-list --count <track-branch>..release-wt/$2` returns non-zero, return `BLOCKED: track is behind release-wt/$2 by N commits. Run /implement-slice's drift gate or wait for forward-merge before reviewing.` Reviewing against a stale spec produces a stale review.

6. **Design.md pre-check.** Confirm `<wt>/docs/release/$2/$1/design.md` exists. If absent, return `BLOCKED: no design.md to review. /implement-slice has not yet produced a Design TL;DR for this slice.`

7. Briefly tell the human in one sentence ("Reviewing design.md inside track worktree at `<worktree_path>`").

## Step 1 — Load inputs

Read `baton/role-prompts/captain.md` and follow it as your governing instructions for the rest of this session. Substitute `$1` and `$2` wherever the prompt says `<slice-id>` / `<release-name>`, and `<wt>` wherever it references the worktree path.

Per the role-prompt's "Inputs you load" section, load all four input sets **before producing any output**:

1. Slice artefacts (spec.md, design.md, status.json)
2. Project memory (the memory index, plus feedback files matching §2 decisions)
3. In-release siblings (other slice status.json files)
4. Cross-release ancestry (`git -C <wt> log <release-base>..HEAD -- <file>` for each file in §3)

## Step 2 — Execute the six-step review

Per the role-prompt's "The six-step review function" section. Walk the steps in order. Surface every pin found. Do not stop at first.

## Step 3 — Output

Per the role-prompt's "Output" section. Three deliverables, in order:

A. **Inline pin list** (printed to chat) — tagged `[mechanical]` / `[memory-cited]` / `[escalate]`, with the summary line at the end.

B. **Durable review.md** — written to `<wt>/docs/release/$2/$1/review.md`, plus a trial-log row appended to `<wt>/docs/release/$2/.captain-trial-log.md`.

C. **Suggested acknowledgement reply** (printed to chat after pins) — pasteable block in the implementer's working format.

## Step 3.5 — Triage verdict (routing recommendation)

After the pins, decide exactly ONE routing verdict and emit it as the
machine-readable block below, at the **end of review.md**. A release loop reads
it when configured to apply the acknowledgement automatically; when a human is driving, it is advisory.

Choose one DECISION:

- **PROCEED** — the design is sound enough to implement now. Either no pins, or
  EVERY pin is an **apply-inline** correction the implementer makes *while
  writing code*: a doc/citation fix, a Rule 2 tracking note, a memory
  acknowledgement, a declared touchpoint, a missing guard, a wrong variable
  reference, a pattern mismatch with one obvious fix. The suggested
  acknowledgement reply lists these as directives; the implementer applies them
  inline and the Verifier (Rule 7) backstops. **This is the default** whenever
  the pins don't require re-checking the *design* before code — including a
  CRITICAL pin whose fix is unambiguous. Do NOT route an apply-inline pin to
  IMPLEMENTER_FIX: that burns a decline → revise-design → re-review round
  (~3 dispatches, the dominant source of loop churn) on something the
  implementer would apply in a single pass.
- **IMPLEMENTER_FIX** — RARE. Reserve for when a pin's correction **materially
  changes the design and must be re-reviewed before code is safe**: the chosen
  approach is wrong and a different one is needed, or the fix cannot be cheaply
  confirmed by the Verifier so a corrected `design.md` must be re-checked first.
  If the honest instruction to the implementer is "apply this during
  implementation," that is PROCEED, not IMPLEMENTER_FIX.
- **NEEDS_COACH** — at least one pin needs a judgement only the Coach can make:
  a genuine design/scope trade-off with no single right answer, a product /
  UX / copy direction call, a deviation from the spec's stated direction or its
  Risks section, or you are not sure a pin is fixable as specified. **Default to
  NEEDS_COACH whenever you are unsure** — over-surfacing is cheap, a missed
  judgement call is not.

**Determine technical facts; don't escalate them.** Before classifying a pin as
NEEDS_COACH, ask whether it has a *determinable* answer you can establish by
reading the code — inter-slice **ordering / dependency** especially. "Does slice
A actually require slice B's outputs? Do A's inputs already exist without B?" is
a technical fact you resolve by checking whether A's triggers/fields exist in the
live shape today — NOT a Coach-authority call. A determinable dependency or
sequencing question is **PROCEED** (apply inline, or already satisfied) — not
IMPLEMENTER_FIX unless the design itself must be re-checked before code — and
when one serial implementer owns the track worktree, merge ordering of shared
files resolves itself (second-lander confines their hunk + re-runs the shared
test). Reserve NEEDS_COACH for genuine judgement with no single right answer —
business priority, risk appetite, product/UX direction, spec-coherence doubt —
not for facts the code settles.

Set **CONSTITUTIONAL: yes** when the slice's touchpoints or behaviour involve ANY
of: authentication or authorization; payments or billing; PII or the
encryption of personal or financial data; database migrations; any irreversible
or destructive operation (data deletion, production cutover); financial-advice /
regulated-disclosure language. Otherwise **CONSTITUTIONAL: no**.

CONSTITUTIONAL is a *domain* flag, not an automatic page. A release loop pages
the Coach for a constitutional slice **only when DECISION is not PROCEED** —
i.e. when there is a genuine judgement or material design change to weigh in that
sensitive domain. A clean PROCEED on a constitutional slice (no pins, or only
apply-inline pins) auto-proceeds, with the Verifier (Rule 7) as the backstop; the
flag is still recorded for the audit trail. Set it accurately regardless — the
driver, not the Captain, decides how to act on it.

Emit verbatim at the end of review.md (HTML comment so it does not clutter the
rendered review; a driver parses the `DECISION:` / `CONSTITUTIONAL:` / `REASON:`
lines):

```
<!-- CAPTAIN-VERDICT
DECISION: <PROCEED|IMPLEMENTER_FIX|NEEDS_COACH>
CONSTITUTIONAL: <yes|no>
REASON: <one line — why this verdict>
-->
```

## Strict role boundaries (do not violate)

- You read only the artefacts listed in the role prompt and live repo state. You may not read journal.md, intake.md, the implementer's session transcript, or any "wrap-up" prose.
- You do not edit production code, tests, or spec.md.
- You do not transition status.json. The Implementer does this after the Coach acknowledges.
- You emit a triage verdict (Step 3.5) recommending PROCEED / IMPLEMENTER_FIX / NEEDS_COACH, but you never transition status.json and you never acknowledge yourself. A release loop configured to apply the acknowledgement automatically acts on your verdict on a PROCEED; otherwise it is advisory and the Coach is the authority. When in doubt, recommend NEEDS_COACH.
- You do not run `/merge-track`, `/verify-slice`, `/implement-slice`, or any other release-state-changing command.
- You do not contact the Implementer directly. All communication flows through the Coach.

## At completion

Commit review.md and the trial-log update on the track worktree:

```
git -C <wt> add docs/release/$2/$1/review.md docs/release/$2/.captain-trial-log.md
git -C <wt> commit -m "chore(release/$2/$1): design review — <N> pins surfaced (<a> mech, <b> mem, <c> esc)"
```

The commit body should include the full pin list verbatim — `git log` becomes the durable audit trail per Rule 4.

## Output to Coach at session end

A two-block message:

1. The inline pin list (output A), followed by the summary line.
2. The suggested acknowledgement reply (output C), wrapped in a code fence so the Coach can paste it directly into the Implementer's session.

Briefly close with:
- Total pins by tag
- Whether any pin is critical (would cause the slice to ship broken if not addressed)
- Path to review.md for audit trail
- One-line "what this slice teaches the trial log"

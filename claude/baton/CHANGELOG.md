---
title: Baton Changelog
description: Version history for the rule-set
---

# Changelog

This package follows semver against the *content* (rules, role prompts, templates, patterns), not the source repo. Major bumps: breaking rewordings, removed rules, renamed role contracts. Minor bumps: new rules or new roles. Patch bumps: new templates, new brainstorm patterns, clarifications, and examples — anything that augments existing rules or roles without changing their contract.

## 0.3.4 — 2026-05-16

Patch: rationalises forward-looking capture path from `docs/superpowers/captures/` to `docs/captures/`. Historical captures stay where they are; new captures land at the cleaner path.

### Motivation

The `docs/superpowers/` directory tree was a historical artefact of an earlier plugin-based workflow that was decommissioned during the v0.5.0 release cycle (May 2026). The plugin is no longer in use; perpetuating the `superpowers/` prefix in forward-looking prescriptions was carrying a name with no remaining meaning. User directive: "we can leave the artefacts there, and we will reference them still, but we shouldn't be adding anything further there."

The canonical path going forward is `docs/captures/`. Existing artefacts at `docs/superpowers/captures/` stay in place — they are real files with their own URLs, referenced by provenance citations across the rule docs, and renaming them would invalidate those citations and break any external links. The two paths coexist: historical captures at `docs/superpowers/captures/`, new captures at `docs/captures/`.

### Changes

- `proof-bundle.md` — all forward-looking write/read path references updated to `docs/captures/`
- `AGENTS-fragment.md` — Rule 6 inline summary updated to prescribe `docs/captures/<date>-<topic>-proof.md` for non-release work
- `release-mode-template/intake.md` — "Related captures" example now points at `docs/captures/` as primary, with historical `docs/superpowers/captures/` noted as a possible secondary source
- `.claude/commands/plan-release.md` — naming-convention citation updated to point at `docs/captures/` instead of the historical path
- Root `AGENTS.md` — Rule 6 inline summary and Subagent Output Handling both updated to `docs/captures/`; the Subagent Output Handling section also explicitly explains the dual-path situation
- New: `docs/captures/README.md` — orients adopters to what goes in the directory, naming convention, and the relationship with the historical `docs/superpowers/captures/`

### What did NOT change

Provenance citations across the rule docs (e.g. `capture-discipline.md:78`, `session-discipline.md:85`, `README.md:95`, `CHANGELOG.md` 0.1.0 + 0.3.1 entries) still cite specific historical files under `docs/superpowers/captures/` and `docs/superpowers/plans/`. Those are references to real existing files; rewriting them would be revisionist. The `README.md` "Provenance citations are historical" note already documents this distinction.

### Files changed

- `proof-bundle.md` (updated)
- `AGENTS-fragment.md` (updated)
- `release-mode-template/intake.md` (updated)
- `.claude/commands/plan-release.md` (updated)
- `AGENTS.md` (root, updated)
- `docs/captures/README.md` (new — directory orientation)
- `CHANGELOG.md` (updated)

---

## 0.3.3 — 2026-05-16

Patch: README + CHANGELOG framing tidy.

### Motivation

The package started as five rules and three onboarding files (0.1.0); by 0.3.2 it had grown to seven rules, three role prompts, six templates, and five brainstorm patterns. The README's opening still framed it as "a portable set of process rules," which under-sold the harness layer and obscured the adoption choice between Rules 1-5 (independently adoptable) and Rules 6-7 (require the harness).

The semver definition was also fuzzy. Clarified the major / minor / patch boundaries to match how 0.3.x has actually been used: new rules / roles bump minor, new templates / patterns / clarifications bump patch.

### Changes

- `README.md` frontmatter title and description updated to name all four artefact kinds (rules, role prompts, templates, brainstorm patterns)
- `README.md` intro paragraph lists the four kinds in order of operational specificity, with a clear note that Rules 1-5 are independently adoptable
- `README.md` "Independence" section updated to mention the optional shell script and the `AskUserQuestion` implementation note for the brainstorm patterns
- `README.md` Versioning section rewritten with the sharper major / minor / patch heuristic
- `CHANGELOG.md` header updated with the same semver definition so the framing matches in both places

### Files changed

- `README.md` (updated)
- `CHANGELOG.md` (updated — header + this 0.3.3 entry)

---

## 0.3.2 — 2026-05-16

Patch: adds `brainstorm-patterns.md` — five visual decision-surface patterns the planner role uses during Phase 2 (Discovery) and Phase 3 (Decomposition).

### Motivation

The 0.3.0 planner role required conversational discovery to produce durable artefacts (`intake.md` + slice specs) but did not prescribe *how* decisions surfaced during the conversation. In practice this defaulted to long prose paragraphs — "what about this, also consider that" — which made decisions invisible and unverifiable. Future sessions reading the prose could not tell which paragraphs were resolved decisions versus open trade-offs, regenerating the discussion.

A specific feature of the Claude superpowers plugin (decommissioned at this project; cause was workflow misfit, not decision-rendering quality) was its decision-card surfacing rhythm during brainstorming. That rhythm is genuinely useful independent of the plugin scaffolding. This patch extracts the rhythm as portable markdown patterns, binds them to Claude Code's native `AskUserQuestion` tool (with its `preview` field for monospace side-by-side rendering), and makes their use *mandatory* in the planner role during decision-point handling.

The patterns are not a methodology. They are visual rhythms that force every decision to be a discrete, capturable event rather than a paragraph of conditional reasoning.

### Patterns added

- **Pattern 1 — Option Matrix**: 2-4 distinct approaches with trade-off bullets, file estimates, and migration cost. Use for the open questions surfaced in `intake.md`.
- **Pattern 2 — Decision Card**: binary or short-list choices (yes / no / defer).
- **Pattern 3 — Scope-Ceiling Bar**: visualises proposed slices as horizontal bars sized by file-count estimate. Slices over the 15-25 file ceiling become visually obvious at a glance.
- **Pattern 4 — Dependency Graph**: ASCII flowchart of cross-slice ordering and external blockers.
- **Pattern 5 — Deferral Card**: Rule 2-compliant deferral structure with why / tracking / acknowledgement as required fields.

### Implementation note

On Claude Code, `AskUserQuestion` is the native implementation. The visual pattern goes in the `preview` field; the user's chosen option plus the preview body lands in `intake.md` "Decisions made during planning" in the same turn. On other tools, the patterns render as markdown code blocks in chat and the response is captured manually into intake.

### Changes

- Added `brainstorm-patterns.md` — five patterns with examples and implementation guidance
- Updated `role-prompts/planner.md` Phase 2 and Phase 3 sections to require pattern usage for decision points
- Updated `.claude/commands/plan-release.md` to instruct the planner to use `AskUserQuestion` with preview content for every decision point
- Updated `README.md` rule-set summary to list the patterns alongside the other harness artefacts

### Files changed

- `brainstorm-patterns.md` (new)
- `role-prompts/planner.md` (updated)
- `.claude/commands/plan-release.md` (updated)
- `README.md` (updated)
- `CHANGELOG.md` (updated)

---

## 0.3.1 — 2026-05-16

Patch: codifies the release-folder naming convention as `YYYY-MM-DD-<theme>`.

### Motivation

The 0.3.0 templates and examples used a mix of formats (`v0.6.0`, `2026-q2-revenue`, `2026-major-platform-release`) without setting a firm convention. On the harness's first real use — initialising `expenses-ia` from issue #715 — the absence of a default sort order made the release folder visually un-rankable against the existing date-prefixed conventions used elsewhere in the repo (notably `docs/superpowers/captures/<date>-<topic>.md`).

Convention now: `YYYY-MM-DD-<theme>` where the date is **planning-start** (the day the folder is first created). Rationale documented in `role-prompts/planner.md`:

- Planning-start is unambiguous (doesn't change with replanning, target-ship slips, etc.)
- Free chronological sort in file trees, IDE views, GitHub folder listings
- Matches the existing captures convention exactly
- Theme part of the name describes *what is being delivered*, never sequence suffixes like `-round2` or `-v2` — those signal unclear scope and should trigger re-decomposition rather than a new folder

The *target version* of a release (e.g. `v0.5.0`) goes in `index.md`'s "Target version / integration branch" field, not in the folder name. Branches are ephemeral integration targets; release folders are permanent record of scope.

### Changes

- `role-prompts/planner.md` — adds a "Release naming convention" section
- `release-mode-template/intake.md` — naming-convention note in the header
- `release-mode-template/index.md` — naming-convention note in the header; adds "Target version / integration branch" field to the Release summary block
- `.claude/commands/{plan-release,implement-slice,verify-slice}.md` — argument-hints updated to show date-prefixed examples; `plan-release.md` adds an explicit Release naming convention section that suggests the date prefix when a non-conventional name is supplied
- `apps/docs/content/docs/release/2026-05-16-expenses-ia/` — original `expenses-ia` folder renamed to align with the new convention; its index + intake heading updated; target-version field added

### Files changed

- `role-prompts/planner.md` (updated)
- `release-mode-template/intake.md` (updated)
- `release-mode-template/index.md` (updated)
- `.claude/commands/plan-release.md` (updated)
- `.claude/commands/implement-slice.md` (updated)
- `.claude/commands/verify-slice.md` (updated)
- `apps/docs/content/docs/release/expenses-ia/` → `apps/docs/content/docs/release/2026-05-16-expenses-ia/` (renamed)
- `CHANGELOG.md` (updated)

---

## 0.3.0 — 2026-05-16

Adds Rule 7 — Adversarial Verification, and the Release Mode harness that operationalises Rules 6 and 7.

### Motivation

Rule 6 (0.2.0) required completion claims to be backed by a structured proof bundle written to disk. That closed the gap between "claimed state" and "remembered state" but did not close the gap between "claimed state" and "actually-true state": the same reasoning thread that did the implementation was still writing the certificate. The proof bundle could be accurate about the diff yet still misinterpret what the diff delivered.

Rule 7 routes verification through a *fresh-context session* that loads only the slice artefacts and live repo state. Same model, separate window, no transcript inheritance. This is the cheapest viable adversarial separation: it requires no new tools, no second model subscription, and no continuous multi-agent loop.

The pair is designed as a producer-consumer loop. Rule 6 produces the artefact; Rule 7 consumes it adversarially. Neither rule alone is sufficient for the failure mode they target together.

### Changes

- Added `adversarial-verification.md` — Rule 7 full doc
- Added `role-prompts/planner.md` — chat-mode requirements discovery + slice decomposition role
- Added `role-prompts/implementer.md` and `role-prompts/verifier.md` — paste-into-session role contracts
- Added `release-mode-template/` — slice folder template (`spec.md`, `journal.md`, `proof.md`, `status.json`) plus release-level `intake.md` (discovery output) and `index.md` (release board)
- Updated `AGENTS-fragment.md` — Rule 7 inline summary; rule count six → seven
- Updated `README.md` — closes the 0.2.0 "applied separately" deferral by adding Rule 6 and Rule 7 rows to the rule table, expanding the failure-mode list, and documenting the Release Mode harness
- Updated `INSTALL.md` — adds Release Mode adoption section covering harness installation, role-prompt copy-out, and the planner/implementer/verifier loop
- New: `scripts/release-verify.sh` in the source monorepo — deterministic first-pass verification script. Adopters should port this to their own repo; the script is intentionally project-aware (test commands, base branch) and ships as a reference implementation rather than a portable artefact

### Files changed

- `adversarial-verification.md` (new)
- `role-prompts/planner.md` (new)
- `role-prompts/implementer.md` (new)
- `role-prompts/verifier.md` (new)
- `release-mode-template/spec.md` (new)
- `release-mode-template/journal.md` (new)
- `release-mode-template/proof.md` (new)
- `release-mode-template/status.json` (new)
- `release-mode-template/intake.md` (new)
- `release-mode-template/index.md` (new)
- `AGENTS-fragment.md` (updated)
- `README.md` (updated — also closes 0.2.0 deferral)
- `INSTALL.md` (updated — Release Mode adoption section)
- `CHANGELOG.md` (updated)
- `scripts/release-verify.sh` (new in source monorepo; reference implementation)

### Provenance

Rule 7 was drafted in response to a Perplexity-assisted analysis of the source v0.5.0 release cycle, conducted two days after Rule 6 shipped in 0.2.0. The analysis identified that proof bundles were being written by the same reasoning thread that did the implementation — preserving the overclaiming failure mode in a more structured shape. The fix that survived multiple framings of the problem was always the same: the certifier must not share a context window with the implementer. Rule 7 codifies that constraint as a hard gate.

---

## 0.2.0 — 2026-05-16

Adds Rule 6 — Proof Bundle.

### Motivation

The five rules in 0.1.0 are backward-looking capture rules: they ensure knowledge is preserved after something happens. They cannot prevent an agent from self-attesting completion through prose alone, because prose-based capture and prose-based completion claims are indistinguishable from the agent's perspective.

Rule 6 closes this gap by requiring machine-verifiable evidence — drawn from live repo state, not from context — to be written to a structured file on disk before any task can be marked complete. It also introduces a mandatory continuation handshake at session start that regenerates proof state from repo reality rather than prior context.

Motivated by the v0.5.0 release cycle at the source project (May 2026), where multiple sessions ended with orchestrator completion claims followed by stocktakes revealing thin delivery — consistently, across both Claude Code and Codex.

### Changes

- Added `proof-bundle.md` — Rule 6 full doc
- Updated `AGENTS-fragment.md` — Rule 6 inline summary added; rule count updated from five to six
- Updated `README.md` rule table — Rule 6 row added (to be applied separately)

### Files changed

- `proof-bundle.md` (new)
- `AGENTS-fragment.md` (updated)
- `CHANGELOG.md` (updated)

---

## 0.1.0 — 2026-05-13

Initial release. Five rules, drafted in response to the source v0.5.0 release audit.

### Rules included

- Rule 1 — Reachability Gate
- Rule 2 — No Silent Deferrals
- Rule 3 — Capture Discipline
- Rule 4 — Commit Messages as Capture Layer
- Rule 5 — Session Discipline

### Templates included

- `AGENTS-fragment.md` — canonical block for project AGENTS.md / CLAUDE.md
- `CLAUDE-md-user-level.md` — optional user-level fallback
- `INSTALL.md` — adoption guide

### Provenance

All five rules are derived from specific failure modes observed during the source v0.5.0 audit. Full case study: `docs/superpowers/captures/2026-05-13-v0.5.0-audit-handoff.md` in the source monorepo. Each rule's `## Provenance` section cites the specific incident that motivated it.

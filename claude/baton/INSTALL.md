---
title: Installation — adopting Baton in your project
description: Step-by-step guide to adopting the Baton rules in a new project
---

# Installation

Adopting Baton in a new project is mostly a copy-paste exercise. The rules themselves are inert markdown; what makes them load-bearing is putting them where your agents see them.

## Install with your agent (recommended)

Baton is an agent protocol, so the fastest install is to let your agent do it. In Claude Code, Codex, Gemini CLI, OpenCode, Hermes Agent, or any coding agent, paste:

> Clone https://github.com/sawy3r/baton, then install Baton for the tool I'm using: place the slash commands in this tool's commands directory (transforming them if the tool needs a different format), copy the rule docs + role prompts into my repo's `docs/baton/`, and wire `AGENTS-fragment.md` into my agent-instructions file. Show me the plan first.

The agent uses the table below to put things in the right place for your tool — including the one case that isn't a straight file copy (Gemini commands are TOML, not markdown).

| Tool | Slash commands → | Instructions file (wire the fragment) | Notes |
|---|---|---|---|
| **Claude Code** | `~/.claude/commands/*.md` | `~/.claude/CLAUDE.md` (user) or repo `AGENTS.md` | Native markdown. `install.sh` does this. |
| **Codex** | `~/.codex/prompts/*.md` | `AGENTS.md` | Native markdown (`$ARGUMENTS`, `$1…$9`). `install-codex.sh` installs them as skills. |
| **OpenCode** | `~/.config/opencode/commands/*.md` | `AGENTS.md` | Native markdown; the file body is the command template. |
| **Gemini CLI** | `~/.gemini/commands/*.toml` | `GEMINI.md` | **Transform:** wrap the command body in `prompt = """…"""`, add `description`, change `$ARGUMENTS` → `{{args}}`. |
| **Hermes Agent** | skill in `~/.hermes/skills/<name>/` (skill name → `/name`) | `AGENTS.md` | Skills-based — each command installs as a skill (the same direction Claude Code and Codex are moving). |
| **Any other agent** | the tool's commands dir (or drive the command docs by hand) | the tool's instructions file | Rule docs + role prompts are tool-agnostic; only the slash-command wrapper is tool-specific. |

In every case the rule docs + role prompts + templates go in your repo's `docs/baton/` (version-controlled, visible to collaborators and CI), and the `AGENTS-fragment.md` rules get wired into the tool's instructions file. The manual steps below describe exactly what the agent does — follow them yourself if you prefer.

## Quickest path (5 minutes)

1. **Copy `AGENTS-fragment.md` into your project's agent-instructions file.** This is `AGENTS.md` at the repo root for most projects, or `CLAUDE.md` / `GEMINI.md` / `.cursorrules` depending on your stack.
2. **Customise the project-specific examples in the fragment** — replace project-specific paths and team names with your own.
3. **Commit.**

That's it for Rules 1–5. The rules are now in scope for every agent session in that repo. Reference rule details by linking to this package or copying it whole into your `/docs`.

For Rules 6 through 11 (Proof Bundle, Adversarial Verification, and the fidelity + parallel-safety rules) you also need the Release Mode harness — see "Release Mode adoption" below. Without the harness, those rules are advisory rather than enforceable.

## Full path (~30 minutes — recommended for teams)

### Step 1 — Copy the package into your repo

Either:
- (a) Copy the entire `baton/` directory into your `/docs/` content (preserves all rules in your own version-control), OR
- (b) Add this repo as a git submodule or vendored dependency (lets you pull updates).

Option (a) is simpler and the default recommendation.

### Step 2 — Wire into your AGENTS.md

Copy the content of `AGENTS-fragment.md` into your `AGENTS.md`. Place it under a top-level section called `Capture Discipline` or `Engineering Process`. Reference the full rule docs by relative path:

```markdown
## Engineering Process

See `/docs/baton/` for the full rule-set. Highlights:

- Rule 1 — Reachability Gate: every UI feature's first failing test renders through the user-path integration point. (`reachability-gate.md`)
- Rule 2 — No Silent Deferrals: inline "deferred" comments require why + tracking + acknowledgement. (`no-silent-deferrals.md`)
- Rule 3 — Capture Discipline: conversation context is ephemeral; subagent findings + decisions land in durable storage before session ends. (`capture-discipline.md`)
- Rule 4 — Commit Messages as Capture Layer: decisions restated in commit body, not "see plan X." (`commit-messages-as-capture.md`)
- Rule 5 — Session Discipline: sessions anchored to GitHub Issues; captures at session boundaries. (`session-discipline.md`)
- Rule 6 — Proof Bundle: completion claims require a structured proof file written from live repo state. (`proof-bundle.md`)
- Rule 7 — Adversarial Verification: verification must come from a fresh-context session loaded only with slice artefacts. (`adversarial-verification.md`)
- Rule 8 — Requirements Fidelity: needs verified (29148 quality), validated (human sense-check), and traced (need → AC → test). (`requirements-fidelity.md`)
- Rule 9 — Design Fidelity: human-owned design calibrated to stakes (reversibility × blast-radius); Type-1 choices need a recorded human decision. (`design-fidelity.md`)
- Rule 10 — Customer Journey Validation: critical journeys are a ratified artefact re-walked against real boundaries; the no-mock boundary is the enforcement teeth. (`customer-journey-validation.md`)
- Rule 11 — Process-Global Mutation Guard: mutating cwd/env/worktree requires guaranteed restore + a fail-closed target assertion + a reachability artefact. (`process-global-mutation.md`)
```

### Step 3 — Optional: user-level fallback

If you (the individual developer) want these rules to apply across all your projects regardless of whether the project has adopted them, copy `CLAUDE-md-user-level.md` content into your `~/.claude/CLAUDE.md` (Claude Code) or equivalent for your tool.

This is per-user, not per-project — your settings, your call.

> **Do not let Step 3 replace Step 2.** The user-level fallback makes Baton "work
> everywhere" on *your* machine, which is exactly why the per-project AGENTS.md
> wiring (Step 2) is so easy to skip — everything seems fine in your own sessions.
> But the global `~/.claude/CLAUDE.md` is invisible to **everyone else and to CI**:
> a collaborator's agent, a contributor's agent, or a CI bot reads the *repo's*
> `AGENTS.md`, never your machine's config. Any repo that others touch — and every
> public repo — must have Step 2 done in-repo. Step 3 is a personal add-on, never a
> substitute. (If you use SwornAgent, `sworn init` performs Step 1 + Step 2 for you.)

### Step 4 — Seed per-project memory (Claude Code only)

If your AI tool supports per-project persistent memory (Claude Code does via `~/.claude/projects/<scope>/memory/`), seed it with the rule provenance:

```bash
# From the project root, for Claude Code:
PROJECT_MEMORY=~/.claude/projects/$(pwd | sed 's|/|-|g')/memory
mkdir -p "$PROJECT_MEMORY"

# Copy the rule files as feedback memory entries:
for rule in reachability-gate no-silent-deferrals capture-discipline commit-messages-as-capture session-discipline proof-bundle adversarial-verification requirements-fidelity design-fidelity customer-journey-validation process-global-mutation; do
  cp docs/baton/$rule.md "$PROJECT_MEMORY/feedback_$(echo $rule | tr - _).md"
done

# Update the MEMORY.md index (manually — entries should be one-line descriptions)
```

After seeding, the rules are loaded into context every session via the memory index.

### Step 5 — Verify

In your next agent session, ask the agent: "What's our reachability gate rule?" If it answers with the rule's specifics, adoption worked. If it doesn't, check that AGENTS.md is actually being loaded (varies by tool).

## Release Mode adoption (Rules 6–11)

The Release Mode harness is what makes Rules 6 through 11 enforceable. Without it, the rules are aspirational — there's no artefact for the verifier to read and no fresh-context boundary preventing self-certification.

The harness is intentionally minimal: four artefact files per slice, four role prompts, one shell script. There is no orchestration framework.

### Step A — Create the release directory

```bash
mkdir -p docs/release
```

This is where per-release planning lives. Each release gets a subfolder; each slice within a release gets its own subfolder under that.

### Step B — Copy the templates

```bash
cp -r docs/baton/release-mode-template docs/release/_template
cp -r docs/baton/role-prompts docs/release/_role-prompts
```

Adopters copy these into the repo so they're discoverable from `docs/release/` directly, rather than spread across the documentation package. The originals stay in `docs/baton/` as the canonical reference; the copies are working templates.

### Step C — Adjust `release-verify.sh` to your stack

`./install.sh` places `release-verify.sh` at `~/.claude/bin/release-verify.sh`; the slash commands invoke it from there by absolute path. It is a reference implementation, not a universal artefact — it bakes in defaults that may not match your project:

- The base branch name (defaults to `main`)
- Test commands relevant to the reference project (Go + TypeScript)
- Dark-code marker patterns
- Glob patterns for which files are scanned

Adjust those defaults to your stack — edit `bin/release-verify.sh` in your baton checkout and re-run `./install.sh`, or edit the installed copy directly. Keep the structure (six checks producing a numbered first-pass verdict) — the structure is the contract, the contents are project-flavoured.

### Step D — Bind the harness to your workflow

The full loop, per release, is:

1. **Planner session (chat mode)**. Human pastes `role-prompts/planner.md` into a fresh agent session. They describe the release conversationally — screenshots, gestures, references. The planner captures everything to `docs/release/<release-name>/intake.md`, proposes a slice decomposition, writes a `spec.md` per agreed slice, and commits. No code is written in this session.

2. **Implementer session (per slice)**. Human opens a fresh session and pastes `role-prompts/implementer.md`. The implementer reads the slice's `spec.md`, makes the changes, writes `proof.md` from live repo state, runs `~/.claude/bin/release-verify.sh <slice-id>`, and stops at state `implemented`. The implementer is forbidden from declaring `verified`.

3. **Verifier session (per slice, fresh context)**. Human opens **another** fresh session — new terminal, no inherited transcript — and pastes `role-prompts/verifier.md`. The verifier reads only `spec.md`, `proof.md`, `status.json`, and live repo state. Returns `PASS` / `FAIL: <numbered violations>` / `BLOCKED: <reason>`. Verdict goes to `journal.md`.

4. **Human approval**. Verified slices wait for explicit human approval before being marked `shipped`. The release board (`index.md`) is the single source of truth for state.

### Step E — Set per-project memory expectations

Whichever AI tool you use, make sure its per-project memory or rules system knows about Release Mode. For Claude Code, the project-level `CLAUDE.md` or `AGENTS.md` should include the inline summary of Rules 6 through 11 from `AGENTS-fragment.md`, and the project memory should note the location of the harness templates and role prompts.

### Why four role prompts (planner / implementer / verifier / captain)

Each role exists in a different context window. They are not four personalities to switch between in one session — they are discrete sessions that exchange information only through files.

- **Planner** runs in chat mode with the human; output is durable artefacts. The planner does not implement, because conversational context contaminates implementation focus.
- **Implementer** runs in a fresh, artefact-loaded session; output is code + proof bundle. The implementer does not certify, because optimism contaminates self-review.
- **Verifier** runs in a fresh, artefact-only session; output is a PASS/FAIL verdict. The verifier does not implement, because helping-mindset contaminates falsification.
- **Captain** reviews the implementer's `design.md` in a fresh window (design-review, Rule 9) and routes each state transition; output is design pins + a verdict. The captain does not write specs or code — it decides what runs next and surfaces decisions to the Coach (the human-in-the-loop authority).

The cost of running these as separate sessions is one extra session per slice. On a tool with a flat-rate plan that is effectively free. On API metered usage it is still cheaper than the rework cost of an overclaimed slice discovered three sessions later.

## Adapting the rules

These rules are deliberately minimal. Common adaptations:

- **Different test framework** — swap "Playwright" / "Vitest" for your team's choice. The rule is about *integration-level testing*, not about a specific tool.
- **Non-GitHub tracker** — replace "GitHub Issues" with Linear, Jira, etc. throughout. The rule is about *anchoring sessions to a durable tracker*, not about GitHub specifically.
- **Monorepo vs polyrepo** — examples assume monorepo; rules apply equally to polyrepos with minor path adjustments.
- **Adding rules** — add new files to `baton/` with the same shape (rule + why + how to apply + provenance) and update the README's rule table. Cut a new GitHub release (the changelog is generated from commits).

## What to AVOID adapting

- Don't loosen Rule 1 (Reachability Gate) to "leaf-level tests are sufficient." That's the failure mode the rule exists to prevent.
- Don't soften Rule 2 (No Silent Deferrals) to "deferrals just need a reason." All three conditions (why + tracking + acknowledgement) are needed; cutting any one re-opens the failure mode.
- Don't downgrade Rule 3 (Capture Discipline) into a session-end-only habit. Capture must happen at *natural breakpoints during the session*, not just at the end — context can run out mid-session.

## Compatibility

These rules have been tested with:

- Claude Code (CLI + plugins)
- Cursor (`.cursorrules` and `AGENTS.md`)
- Copilot CLI

They are tool-agnostic at the rule level. The only tool-specific bits are the per-project memory seeding (Claude Code) and the file naming conventions (some tools look for `AGENTS.md`, some for `CLAUDE.md`).

## Questions / issues

If a rule misfires in your context, or you find a failure mode the rules don't cover, open an issue on the source repo or copy this package and amend locally. The rule-set is designed to evolve.

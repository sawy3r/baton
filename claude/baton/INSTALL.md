---
title: Installation — adopting Baton in your project
description: Step-by-step guide to adopting the Baton rules in a new project
---

# Installation

Adopting Baton in a new project is mostly a copy-paste exercise. The rules themselves are inert markdown; what makes them load-bearing is putting them where your agents see them.

## Quickest path (5 minutes)

1. **Copy `AGENTS-fragment.md` into your project's agent-instructions file.** This is `AGENTS.md` at the repo root for most projects, or `CLAUDE.md` / `GEMINI.md` / `.cursorrules` depending on your stack.
2. **Customise the project-specific examples in the fragment** — replace project-specific paths and team names with your own.
3. **Commit.**

That's it for Rules 1–5. The rules are now in scope for every agent session in that repo. Reference rule details by linking to this package or copying it whole into your `/docs`.

For Rules 6 and 7 (Proof Bundle + Adversarial Verification) you also need the Release Mode harness — see "Release Mode adoption" below. Without the harness, those rules are advisory rather than enforceable.

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
```

### Step 3 — Optional: user-level fallback

If you (the individual developer) want these rules to apply across all your projects regardless of whether the project has adopted them, copy `CLAUDE-md-user-level.md` content into your `~/.claude/CLAUDE.md` (Claude Code) or equivalent for your tool.

This is per-user, not per-project — your settings, your call.

### Step 4 — Seed per-project memory (Claude Code only)

If your AI tool supports per-project persistent memory (Claude Code does via `~/.claude/projects/<scope>/memory/`), seed it with the rule provenance:

```bash
# From the project root, for Claude Code:
PROJECT_MEMORY=~/.claude/projects/$(pwd | sed 's|/|-|g')/memory
mkdir -p "$PROJECT_MEMORY"

# Copy the rule files as feedback memory entries:
for rule in reachability-gate no-silent-deferrals capture-discipline commit-messages-as-capture session-discipline proof-bundle adversarial-verification; do
  cp docs/baton/$rule.md "$PROJECT_MEMORY/feedback_$(echo $rule | tr - _).md"
done

# Update the MEMORY.md index (manually — entries should be one-line descriptions)
```

After seeding, the rules are loaded into context every session via the memory index.

### Step 5 — Verify

In your next agent session, ask the agent: "What's our reachability gate rule?" If it answers with the rule's specifics, adoption worked. If it doesn't, check that AGENTS.md is actually being loaded (varies by tool).

## Release Mode adoption (Rules 6 + 7)

The Release Mode harness is what makes Rules 6 and 7 enforceable. Without it, the rules are aspirational — there's no artefact for the verifier to read and no fresh-context boundary preventing self-certification.

The harness is intentionally minimal: four artefact files per slice, three role prompts, one shell script. There is no orchestration framework.

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

### Step C — Port `release-verify.sh`

The script that ships in the source monorepo (`scripts/release-verify.sh`) is a reference implementation, not a portable artefact. It bakes in:

- The base branch name (defaults to `main`)
- Test commands relevant to the source project (Go + TypeScript)
- Dark-code marker patterns
- Glob patterns for which files are scanned

Copy the script into your repo's `scripts/` directory and adjust those defaults to your stack. Keep the structure (six checks producing a numbered first-pass verdict) — the structure is the contract, the contents are project-flavoured.

### Step D — Bind the harness to your workflow

The full loop, per release, is:

1. **Planner session (chat mode)**. Human pastes `role-prompts/planner.md` into a fresh agent session. They describe the release conversationally — screenshots, gestures, references. The planner captures everything to `docs/release/<release-name>/intake.md`, proposes a slice decomposition, writes a `spec.md` per agreed slice, and commits. No code is written in this session.

2. **Implementer session (per slice)**. Human opens a fresh session and pastes `role-prompts/implementer.md`. The implementer reads the slice's `spec.md`, makes the changes, writes `proof.md` from live repo state, runs `scripts/release-verify.sh <slice-id>`, and stops at state `implemented`. The implementer is forbidden from declaring `verified`.

3. **Verifier session (per slice, fresh context)**. Human opens **another** fresh session — new terminal, no inherited transcript — and pastes `role-prompts/verifier.md`. The verifier reads only `spec.md`, `proof.md`, `status.json`, and live repo state. Returns `PASS` / `FAIL: <numbered violations>` / `BLOCKED: <reason>`. Verdict goes to `journal.md`.

4. **Human approval**. Verified slices wait for explicit human approval before being marked `shipped`. The release board (`index.md`) is the single source of truth for state.

### Step E — Set per-project memory expectations

Whichever AI tool you use, make sure its per-project memory or rules system knows about Release Mode. For Claude Code, the project-level `CLAUDE.md` or `AGENTS.md` should include the inline summary of Rules 6 and 7 from `AGENTS-fragment.md`, and the project memory should note the location of the harness templates and role prompts.

### Why three role prompts (planner / implementer / verifier)

Each role exists in a different context window. They are not three personalities to switch between in one session — they are three discrete sessions that exchange information only through files.

- **Planner** runs in chat mode with the human; output is durable artefacts. The planner does not implement, because conversational context contaminates implementation focus.
- **Implementer** runs in a fresh, artefact-loaded session; output is code + proof bundle. The implementer does not certify, because optimism contaminates self-review.
- **Verifier** runs in a fresh, artefact-only session; output is a PASS/FAIL verdict. The verifier does not implement, because helping-mindset contaminates falsification.

The cost of running these as separate sessions is one extra session per slice. On a tool with a flat-rate plan that is effectively free. On API metered usage it is still cheaper than the rework cost of an overclaimed slice discovered three sessions later.

## Adapting the rules

These rules are deliberately minimal. Common adaptations:

- **Different test framework** — swap "Playwright" / "Vitest" for your team's choice. The rule is about *integration-level testing*, not about a specific tool.
- **Non-GitHub tracker** — replace "GitHub Issues" with Linear, Jira, etc. throughout. The rule is about *anchoring sessions to a durable tracker*, not about GitHub specifically.
- **Monorepo vs polyrepo** — examples assume monorepo; rules apply equally to polyrepos with minor path adjustments.
- **Adding rules** — add new files to `baton/` with the same shape (rule + why + how to apply + provenance) and update the README's rule table. Bump the package's CHANGELOG.

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

---

## Appendix: future Claude Code plugin packaging (not yet extracted)

This folder + the four slash commands at `.claude/commands/{plan-release,implement-slice,verify-slice,merge-release}.md` + `scripts/release-verify.sh` are intended to be extracted into a standalone Claude Code plugin repo (`baton`) so other projects can install them via `/plugin`. This appendix captures the install / lifecycle / develop instructions now so they don't need re-research at extraction time. See memory `feedback_release_worktree_not_slice_worktree` for context.

### Target plugin layout

```
baton/
├── .claude-plugin/plugin.json          # name: "baton", version: "0.1.0"
├── skills/
│   ├── plan-release/SKILL.md           # → /baton:plan-release
│   ├── implement-slice/SKILL.md        # → /baton:implement-slice
│   ├── verify-slice/SKILL.md           # → /baton:verify-slice
│   └── merge-release/SKILL.md          # → /baton:merge-release
├── bin/release-verify.sh               # Auto-PATH when plugin loads
├── docs/
│   ├── role-prompts/{planner,implementer,verifier}.md
│   └── templates/{intake,index,proof,journal,spec,status}.{md,json}
└── README.md
```

Skills reference supporting docs via `${CLAUDE_SKILL_DIR}/../../docs/role-prompts/X.md` — the one mechanical rewrite needed during extraction. Bash scripts in `bin/` are auto-on-PATH; existing `release-verify.sh` call sites work unchanged.

### Install (paste into the plugin's README at extraction time)

```shell
/plugin marketplace add sawy3r/baton
/plugin install baton@sawy3r-baton
```

Or directly from git URL (handy for forks):

```shell
/plugin marketplace add https://github.com/sawy3r/baton.git
/plugin install baton@baton
```

After install, four namespaced slash commands appear:

- `/baton:plan-release <name>` — planner role
- `/baton:implement-slice <slice-id> [<release-name>]` — implementer role
- `/baton:verify-slice <slice-id> [<release-name>]` — verifier role (run in a fresh session)
- `/baton:merge-release <release-name>` — release integrator

Update: `/plugin marketplace update sawy3r-baton`. Auto-update is off by default for third-party marketplaces.
Uninstall: `/plugin uninstall baton@sawy3r-baton`.
Plugins live at `~/.claude/plugins/` for local inspection.

### Lifecycle (one closed loop per release)

```
~/projects/<repo>
    ↓ /baton:plan-release <YYYY-MM-DD-theme>
    (planner runs in primary worktree on integration branch;
     writes docs/release/<name>/{intake,index,SNN-*/spec}.md)
    ↓ /new
    ↓ /baton:implement-slice <slice-id> <release-name>
    (first run auto-creates ~/projects/<repo>-worktrees/release-<name>/
     on branch release-wt/<name>; records path in index.md frontmatter.
     Subsequent runs auto-discover.)
    ↓ /new (fresh terminal — Rule 7 requires no inherited context)
    ↓ /baton:verify-slice <slice-id> <release-name>
    (BLOCKED / FAIL / PASS — PASS flips state to 'verified')
    ↓ repeat for every slice
    ↓ /baton:merge-release <release-name>
    (asserts every slice verified; merges release-wt/<name> → integration
     branch with --no-ff. Does NOT push, NOT delete worktree, NOT flip
     state to 'shipped'.)
    ↓ deploy integration branch to prod via existing pipeline
    ↓ slice states flip to 'shipped'
```

Terminology is locked: **verified** = verifier PASSed, **merged** = release branch joined integration, **shipped** = code in prod. Three distinct events, three distinct verbs.

### Develop locally (during plugin extraction or maintenance)

```shell
git clone git@github.com:sawy3r/baton.git ~/projects/baton
cd ~/your-project
claude --plugin-dir ~/projects/baton
```

Changes to `skills/`, `bin/`, or `docs/` are picked up on next session start.

### Extraction checklist (when you come back to this)

1. `mkdir ~/projects/baton && cd ~/projects/baton && git init`.
2. Create `.claude-plugin/plugin.json` with `name: "baton"`, `version: "0.1.0"`.
3. Move `.claude/commands/*.md` (from the source repo) → `skills/*/SKILL.md` (rename + restructure).
4. Move `apps/docs/content/docs/baton/{role-prompts,release-mode-template}/*` → `docs/{role-prompts,templates}/`.
5. Rewrite path references in skills: `apps/docs/content/docs/baton/role-prompts/X.md` → `${CLAUDE_SKILL_DIR}/../../docs/role-prompts/X.md`.
6. Move `scripts/release-verify.sh` → `bin/release-verify.sh`.
7. Drop the Install + Lifecycle + Develop sections above into `README.md`.
8. Push to `github.com/sawy3r/baton`.
9. In the source repo: delete the carved-out paths and `/plugin install` from the new repo. Update memory entries that reference old paths.

### Naming trade-off to decide at extraction time

Plugin-namespaced commands become `/baton:plan-release`, `/baton:implement-slice`, etc. The current bare `/plan-release` form will no longer exist post-extraction. Decide upfront whether the namespacing benefit (no command-name collisions, clear origin) is worth retraining muscle memory.

### Authoritative docs

- [Create plugins](https://code.claude.com/docs/en/plugins.md)
- [Custom skills](https://code.claude.com/docs/en/custom-skills.md)
- [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins.md)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference.md)

# Roadmap

Phased work, no version pinning. Each phase lands when it's ready; see
[Releases](https://github.com/sawy3r/baton/releases) for what's actually
shipped.

## Now (shipped)

- **Agent-driven install** — point your coding agent (Claude Code, Codex,
  Gemini CLI, OpenCode, Hermes, …) at the repo and it installs Baton for your
  tool and wires the rules fragment into your instructions file. See
  `baton/INSTALL.md`.
- Slash commands for Claude Code: `/plan-release`, `/replan-release`,
  `/design-review`, `/implement-slice`, `/verify-slice`, `/merge-track`,
  `/merge-release`, `/mark-shipped`.
- **Codex (CLI + Mac App) install path** via `./install-codex.sh` — the
  same eight commands are installed as Codex Skills under
  `~/.agents/skills/baton-<command>/SKILL.md`, invoked as
  `$baton-plan-release` etc. or via the `/skills` picker. The skill
  bodies are mechanically derived from the Claude Code command bodies
  at install time, with paths rewritten from `~/.claude/` to
  `~/.codex/` and a Codex-specific argument-resolution header prepended.
- Track mode — slices grouped into touchpoint-disjoint tracks for safe
  parallelism, each track in its own worktree. See
  `baton/track-mode.md`.
- Eleven rules + four role prompts (planner, implementer, verifier, captain) +
  release-mode templates installed at `~/.claude/baton/` (Claude Code) and
  `~/.codex/baton/` (Codex) via the two installers.
- **Mechanical gate suite** — Baton specifies seven gates (what each checks, that it fails closed); the open `sworn` reference implementation runs them: the trace gate (RTM + EARS + sniff-test; `sworn trace`), coverage (AC → test mapping; `sworn coverage`), design-conformance (colours + architecture rules; `sworn designaudit`), mock-boundary (undeclared mock boundaries), regression (post-merge full suite; `sworn regress`), proof-bundle verification (proof-bundle structure; `sworn verify`), and the board oracle (state-machine resolution; `sworn board`). Baton installs no binaries (ADR-0010).
- **LLM check types (6)** — `spec-ambiguity`, `design-review`, `ac-satisfaction`, `security-review`, `semantic-coverage`, `maintainability-review`. Deterministic (temp=0), structured prompts, structured JSON output, fail-closed. Run via the LLM-check gate (`sworn llm-check --check <name>`).
- **Architecture rules engine** — `architecture.json` with four check types (grep, touchpoints, diff-size, external). Canonical docs declaration. Per-release overrides via `architecture-overrides.json`. Per-slice escape hatches via `design-allowlist.json`.
- **Planner — six considerations** — requirements elicitation is the spine of the prompt, with a mandatory floor (security & privacy, compliance & legal, accessibility, performance — forget-easy, retrofit-expensive) plus applied-where-they-bear (user experience, architecture & fit). Structured discovery (users → defects → interaction detail → implementation surface → boundaries → ambiguity register). Canonical architecture consultation.
- **Fresh-context boundaries** — all four roles (planner, implementer, captain, verifier) read artefacts from disk, never from prior conversation. Spec decomposition fidelity gates (self-contained spec checklist, sniff-test, "see intake" banned).
- **Requirements traceability** — `covers_needs` field in `status.json` closes the intake→slice link. The trace gate (`sworn trace`) mechanically verifies the full RTM chain: intake need → slice → AC → test → proof.
- **JSON Schemas** — record schemas validating the emitted loop records (`board-v1`, `spec-v1`, `proof-v1`, `slice-status-v1`, `journeys-v1`, `attestations-v1`, `verifier-verdict-v1`), plus config schemas (`architecture-rules-v1`, `design-fidelity-v1`, `design-allowlist-v1`, `architecture-overrides-v1`). Hosted at `baton.sawy3r.net/schemas/`.
- **Board oracle** — Baton specifies the board record (`board.json`) and the state-resolution contract; the open `sworn` binary implements it (`sworn board` for a go/no-go verdict, `sworn top` for a live evidence surface), resolving slice state straight from `track/*` + `release-wt/*` git branches. The earlier Node oracle (`release-board-status.sh` / `release-board-ui.mjs` / `lib/release-board.mjs`) shipped in this repo; per ADR-0010 it now lives in `sworn`.

## Next — cross-tool adapters

The agent-driven install (above) already covers any tool today — your agent
places the files and wires the fragment. This pass makes it *scripted and native*:
`install-claude.sh` targets Claude Code and `install-codex.sh` targets OpenAI Codex
(CLI + Mac App, which share `~/.codex/` config); the refactor moves to a
two-layer architecture so the same content drives slash-commands / skills /
prompts across the remaining target CLIs without an agent in the loop.

- **Native slash commands per tool.** Baton's commands are markdown today (native for Claude Code, Codex `~/.codex/prompts/`, and OpenCode `~/.config/opencode/commands/`). Gemini CLI uses TOML (`~/.gemini/commands/*.toml`), so native Gemini support needs a markdown→TOML transform (`prompt`/`description` fields, `$ARGUMENTS`→`{{args}}`). Goal: the installer (or your agent) emits native commands for whichever tool you use.

### Target tools

| Tool                | Rules file              | User-level commands surface       | Format          | Status |
|---------------------|-------------------------|-----------------------------------|-----------------|--------|
| Claude Code         | `~/.claude/CLAUDE.md`   | `~/.claude/commands/*.md`         | markdown + frontmatter | shipped (`install-claude.sh`) |
| OpenAI Codex (CLI + Mac App) | `~/.codex/AGENTS.md` | `~/.agents/skills/<name>/SKILL.md` | markdown + frontmatter | shipped (`install-codex.sh`) |
| Gemini CLI          | `GEMINI.md` or AGENTS.md| `~/.gemini/commands/*.toml`       | TOML | planned |
| OpenCode (SST)      | `AGENTS.md`             | `~/.config/opencode/commands/`    | markdown | planned |
| Hermes Agent (Nous) | `AGENTS.md`             | `~/.hermes/skills/<name>/`        | skill | planned |

### Two-layer architecture

**Layer 1 — universal core (tool-agnostic):**

```
~/.baton/
├── role-prompts/{planner,implementer,verifier,captain}.md  # role contracts as plain prose
├── release-mode-template/*                            # record templates (JSON) + prose
├── schemas/*                                           # record + config JSON Schemas
└── AGENTS-fragment.md                                 # the rules fragment to splice
```

The role prompts and rule docs are already tool-agnostic prose. Layer 1
is essentially the current `baton/` directory (no binaries — Baton is
pure spec; the gates are run by the open `sworn` reference implementation),
moved to a tool-neutral home.

**Layer 2 — per-tool adapters (thin shims):**

```
adapters/
├── claude-code/   # *.md slash commands → ~/.claude/commands/
├── codex/         # *.md prompts        → ~/.codex/prompts/
├── gemini/        # *.toml commands     → ~/.gemini/commands/
├── opencode/      # *.md commands       → ~/.config/opencode/commands/
├── hermes/        # skills              → ~/.hermes/skills/<name>/
├── cursor/        # project-level only — README + template
└── aider/         # README explaining manual paste-role-prompts workflow
```

Each adapter is a *thin* wrapper: its `plan-release` command (in
whatever format that tool wants) does nothing but tell the agent "read
`~/.baton/role-prompts/planner.md` and follow it." The actual
role-prompt content lives once, in Layer 1, and is read identically by
every tool.

### Multi-tool installer

`install.sh` becomes tool-aware:

```bash
./install.sh                                 # auto-detect installed tools, install all adapters
./install.sh --tools=claude-code,codex       # explicit
./install.sh --core-only                     # install Layer 1, skip all adapters
./install.sh --list-detected-tools           # probe and report, no install
```

Detection probes:
- Claude Code: `[[ -d ~/.claude ]]`
- Codex: `command -v codex` OR `[[ -d ~/.codex ]]`
- Gemini: `command -v gemini` OR `[[ -d ~/.gemini ]]`
- OpenCode: `command -v opencode` OR `[[ -d ~/.config/opencode ]]`
- Hermes: `command -v hermes` OR `[[ -d ~/.hermes ]]`

### Migration path

Anyone who installed the Claude-Code-only release will need to either:

- (a) `rm -rf ~/.claude/baton ~/.claude/bin ~/.claude/commands/{plan,replan,implement,verify,merge}-*` then re-run the new `install-claude.sh`, OR
- (b) Just re-run the new `install-claude.sh` — it should be idempotent enough to overwrite the Claude-Code shims in place and additionally drop Layer 1 at its new `~/.baton/` home. Adapters update their reads from `$HOME/.claude/baton/...` to `$HOME/.baton/...`.

Rule content does not change across this transition — only the file
layout, install location, and per-tool adapter formats.

## Later — Claude Code plugin packaging

Wrap Layer 1 + the Claude Code adapter in a `.claude-plugin/plugin.json`
manifest so adopters can install via `/plugin marketplace add sawy3r/baton`.
Sketched in `baton/INSTALL.md`'s Appendix. Lower priority than the
cross-tool refactor — that pass already gives broader coverage; this just
gives a more ergonomic install path for the Claude subset.

## Explicitly out of scope

- IDE-only integrations (VS Code Copilot, JetBrains AI Assistant) that
  don't expose a user-level slash-command directory.
- Hosted version / SaaS wrapping.
- Custom rule authoring API. The eleven rules are deliberately fixed; if
  you want a different rule-set, fork the repo and amend.

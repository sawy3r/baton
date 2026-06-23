# Roadmap

Phased work, no version pinning. Each phase lands when it's ready; see
[Releases](https://github.com/sawy3r/baton/releases) for what's actually
shipped.

## Now (shipped)

- Slash commands for Claude Code: `/plan-release`, `/replan-release`,
  `/implement-slice`, `/verify-slice`, `/merge-track`, `/merge-release`,
  `/mark-shipped`.
- **Codex (CLI + Mac App) install path** via `./install-codex.sh` — the
  same seven commands are installed as Codex Skills under
  `~/.agents/skills/baton-<command>/SKILL.md`, invoked as
  `$baton-plan-release` etc. or via the `/skills` picker. The skill
  bodies are mechanically derived from the Claude Code command bodies
  at install time, with paths rewritten from `~/.claude/` to
  `~/.codex/` and a Codex-specific argument-resolution header prepended.
- Track mode — slices grouped into touchpoint-disjoint tracks for safe
  parallelism, each track in its own worktree. See
  `claude/baton/track-mode.md`.
- Eleven rules + role prompts + release-mode templates installed at
  `~/.claude/baton/` (Claude Code) and `~/.codex/baton/` (Codex) via
  the two installers.
- Deterministic first-pass verifier (`release-verify.sh`) at
  `~/.claude/bin/` and `~/.codex/bin/`.
- Release-board tooling at `~/.claude/bin/` and `~/.codex/bin/` —
  `release-board-status.sh` (terminal go/no-go verdict) and
  `release-board-ui.mjs` (auto-refreshing HTML dashboard), both
  resolving slice state straight from `track/*` + `release-wt/*` git
  branches via the shared `lib/release-board.mjs`.

## Next — cross-tool adapters

`install.sh` targets Claude Code; `install-codex.sh` targets OpenAI Codex
(CLI + Mac App, which share `~/.codex/` config). The next pass refactors
into a two-layer architecture so the same content drives slash-commands /
skills / prompts across the remaining target CLIs.

### Target tools

| Tool                | Rules file              | User-level commands surface       | Format          | Status |
|---------------------|-------------------------|-----------------------------------|-----------------|--------|
| Claude Code         | `~/.claude/CLAUDE.md`   | `~/.claude/commands/*.md`         | markdown + frontmatter | shipped (`install.sh`) |
| OpenAI Codex (CLI + Mac App) | `~/.codex/AGENTS.md` | `~/.agents/skills/<name>/SKILL.md` | markdown + frontmatter | shipped (`install-codex.sh`) |
| Gemini CLI          | `GEMINI.md` or AGENTS.md| `~/.gemini/commands/*.toml`       | TOML | planned |
| OpenCode (SST)      | `AGENTS.md`             | `~/.config/opencode/command/`     | markdown | planned |

### Two-layer architecture

**Layer 1 — universal core (tool-agnostic):**

```
~/.baton/
├── role-prompts/{planner,implementer,verifier}.md     # role contracts as plain prose
├── release-mode-template/*                            # artefact templates
├── bin/release-verify.sh                              # deterministic first-pass
└── AGENTS-fragment.md                                 # Rule 1-5 fragment to splice
```

The role prompts and rule docs are already tool-agnostic prose. Layer 1
is essentially the current `claude/baton/` directory plus `bin/`, moved
to a tool-neutral home.

**Layer 2 — per-tool adapters (thin shims):**

```
adapters/
├── claude-code/   # *.md slash commands → ~/.claude/commands/
├── codex/         # *.md prompts        → ~/.codex/prompts/
├── gemini/        # *.toml commands     → ~/.gemini/commands/
├── opencode/      # *.md commands       → ~/.config/opencode/command/
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

### Migration path

Anyone who installed the Claude-Code-only release will need to either:

- (a) `rm -rf ~/.claude/baton ~/.claude/bin ~/.claude/commands/{plan,replan,implement,verify,merge}-*` then re-run the new `install.sh`, OR
- (b) Just re-run the new `install.sh` — it should be idempotent enough to overwrite the Claude-Code shims in place and additionally drop Layer 1 at its new `~/.baton/` home. Adapters update their reads from `$HOME/.claude/baton/...` to `$HOME/.baton/...`.

Rule content does not change across this transition — only the file
layout, install location, and per-tool adapter formats.

## Later — Claude Code plugin packaging

Wrap Layer 1 + the Claude Code adapter in a `.claude-plugin/plugin.json`
manifest so adopters can install via `/plugin marketplace add sawy3r/baton`.
Sketched in `claude/baton/INSTALL.md`'s Appendix. Lower priority than the
cross-tool refactor — that pass already gives broader coverage; this just
gives a more ergonomic install path for the Claude subset.

## Explicitly out of scope

- IDE-only integrations (VS Code Copilot, JetBrains AI Assistant) that
  don't expose a user-level slash-command directory.
- Hosted version / SaaS wrapping.
- Custom rule authoring API. The eleven rules are deliberately fixed; if
  you want a different rule-set, fork the repo and amend.

# baton

> A protocol for agent work that survives session boundaries — plan, implement, and verify in sealed contexts, with proof bundles as the only currency between them.

**The baton is the proof bundle.** Agent sessions hand off durable artefacts (specs, proofs, verdicts) like batons in a relay. Each role runs in its own context window — planner, implementer, verifier — and the artefacts on disk are the only thing that crosses between them. Adversarial verification (Rule 7) is the load-bearing piece: the verifier session has no prior context from the implementer, only the artefacts, and can return PASS / FAIL / BLOCKED.

**Status:** v0.1.0 — Claude Code only. Cross-tool adapters for OpenAI Codex CLI, Gemini CLI, and OpenCode are planned for v0.2.0 (see Roadmap section below).

**License:** [MIT](LICENSE) — permissive, attribution-only. Use it in any project, commercial or otherwise.

---

## What this is

A portable, project-agnostic harness. Installs the four release-mode slash
commands, the rule docs, the role prompts, the release-mode templates, and
the deterministic `release-verify.sh` first-pass script into `~/.claude/`
on the target machine, so the harness is available across every project on
that machine without per-repo vendoring.

## Quick install

```bash
git clone https://github.com/sawy3r/baton.git ~/projects/baton
cd ~/projects/baton
./install.sh
```

Or, if you'd prefer to preview first:

```bash
./install.sh --dry-run   # show what would be installed without copying
./install.sh --help      # full options
```

Set `CLAUDE_HOME=/custom/path` before running `install.sh` to install
under a non-default location (default: `$HOME/.claude`).

Updating later is a `git pull && ./install.sh` from the same directory.

## What lands where

| Source in repo                         | Installed to                                  | Purpose                                              |
| -------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `claude/commands/*.md`                 | `~/.claude/commands/`                         | User-level slash commands, available in every repo  |
| `claude/baton/`                        | `~/.claude/baton/`                            | Rule docs, role prompts, release-mode templates     |
| `bin/release-verify.sh`                | `~/.claude/bin/release-verify.sh`             | Deterministic first-pass verifier, invoked by abs path |

Nothing under `~/.claude/CLAUDE.md` is touched. Wiring the AGENTS-fragment
rules into your global instructions is a deliberate manual step — see the
post-install message printed by `install.sh`.

## Path tokens used in the commands

The slash commands are written against two runtime tokens that the agent
substitutes from the current repo:

- **`<REPO_ROOT>`** — output of `git rev-parse --show-toplevel` from the
  project's primary checkout.
- **`<REPO_BASENAME>`** — `basename "<REPO_ROOT>"`, used to namespace the
  release worktrees folder (`$HOME/projects/<REPO_BASENAME>-worktrees/`)
  so multiple projects on the same machine don't collide.

Inside each running command, the agent should resolve these to concrete
paths in its first Bash call (`REPO_ROOT=$(git rev-parse --show-toplevel)`).

## Per-project setup (before first `/plan-release`)

Each repo on this machine that wants to use Release Mode needs:

1. A `docs/release/` directory at the repo root (the commands create
   sub-folders here per release). If the project's docs site renders content
   from a different location (e.g. Fumadocs at `apps/docs/content/docs/`),
   create a symlink: `ln -s apps/docs/content/docs docs`.
2. The Rule 1–5 fragment from `~/.claude/baton/AGENTS-fragment.md`
   either appended to the project's `AGENTS.md` / `CLAUDE.md`, OR appended
   to `~/.claude/CLAUDE.md` once for all projects.

That's it. `/plan-release <YYYY-MM-DD-theme>` from a fresh session
bootstraps the release folder from the templates.

## Caveats and known limitations

- **Per-project memory** (optional): if your tool maintains per-project
  persistent memory (Claude Code stores it under
  `~/.claude/projects/<encoded-cwd>/memory/MEMORY.md`), the planner reads
  the index at session start. On a clean install on a new machine no such
  store exists; the step skips silently.
- **Claude-Code-shaped only in v0.1.0**: the four slash commands and the
  install layout target Claude Code's directives ecosystem
  (`~/.claude/commands/`, `~/.claude/baton/`). Codex, Gemini CLI, OpenCode,
  Cursor, and Aider are out of scope for v0.1.0 but in scope for v0.2.0 —
  see Roadmap below.
- **No Claude Code plugin install yet**: this is an `install.sh`
  distribution, not a plugin. The eventual plugin layout (with
  `.claude-plugin/plugin.json` and `/plugin marketplace add sawy3r/baton`)
  is sketched in `claude/baton/INSTALL.md`'s Appendix and is targeted for
  v0.3.0.

## Roadmap — cross-tool adapters (v0.2.0)

v0.1.0 is Claude-Code-shaped throughout. v0.2.0 refactors into a
two-layer architecture so the same content drives slash-commands across
Claude Code, OpenAI Codex CLI, Gemini CLI, and OpenCode (SST). Target
tool table:

| Tool                | Rules file              | User-level commands dir       | Format          |
|---------------------|-------------------------|-------------------------------|-----------------|
| Claude Code         | `~/.claude/CLAUDE.md`   | `~/.claude/commands/*.md`     | markdown + frontmatter |
| OpenAI Codex CLI    | `AGENTS.md` (canonical) | `~/.codex/prompts/*.md`       | markdown |
| Gemini CLI          | `GEMINI.md` or AGENTS.md| `~/.gemini/commands/*.toml`   | TOML |
| OpenCode (SST)      | `AGENTS.md`             | `~/.config/opencode/command/` | markdown |

### Two-layer architecture (refactor target)

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

Each adapter is a *thin* wrapper: its `plan-release` command (in whatever
format that tool wants) does nothing but tell the agent "read
`~/.baton/role-prompts/planner.md` and follow it." The actual
role-prompt content lives once, in Layer 1, and is read identically by
every tool.

### install.sh — multi-tool installer

The current `install.sh` becomes tool-aware:

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

### Migration from v0.1.0 (this bundle) to v0.2.0

Anyone who installed v0.1.0 (Claude-Code-only) onto a machine will need
to either:
(a) `rm -rf ~/.claude/baton ~/.claude/bin ~/.claude/commands/{plan,implement,verify,merge}-*` then re-run v0.2.0's `install.sh`, OR
(b) Just re-run v0.2.0's `install.sh` — it should be idempotent enough to
overwrite the Claude-Code shims in place and additionally drop Layer 1 at
its new `~/.baton/` home. Adapters update their reads from
`$HOME/.claude/baton/...` to `$HOME/.baton/...`.

The role prompts and rule docs themselves do not change between v0.1.0 and
v0.2.0 — only the file layout, install location, and per-tool adapter
formats change. v0.1.0 users keep working; they just don't get the cross-
tool support until they re-install.

### Out of scope for v0.2.0

- Claude Code *plugin* packaging (`.claude-plugin/plugin.json` + `/plugin install`). That's a third layer — a plugin manifest that wraps Layer 1 + the Claude Code adapter for the marketplace install path. Treat as v0.3.0.
- IDE-only integrations (VS Code Copilot, JetBrains AI Assistant) that don't expose a user-level slash-command directory.

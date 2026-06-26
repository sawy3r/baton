#!/usr/bin/env bash
#
# install-codex.sh — install baton for OpenAI Codex (CLI and Mac App).
#
# Codex doesn't have a custom slash-command directory the way Claude
# Code does (~/.claude/commands/). Its equivalent is **Skills** —
# directories under ~/.agents/skills/<name>/ with a SKILL.md manifest,
# invoked as `$<skill-name>` or via the `/skills` picker. This script
# packages each of baton's seven commands as a Codex skill, installs
# the rule docs + record schemas under ~/.codex/, and prints the manual
# wiring step for ~/.codex/AGENTS.md.
#
# Codex Mac App + Codex CLI share the same on-disk config, so a single
# install serves both.
#
# Idempotent: re-running overwrites the seven skills, the baton docs
# package and record schemas. It does NOT touch ~/.codex/AGENTS.md
# or any other user config — wiring the AGENTS rules fragment is a
# manual step printed at the end.

set -euo pipefail

usage() {
  cat <<EOF
baton installer for OpenAI Codex (CLI + Mac App)

Usage: ./install-codex.sh [--dry-run] [-y|--yes] [--help]

Options:
  --dry-run   Print what would be copied, don't actually copy.
  -y, --yes   Skip the interactive confirmation prompt.
  -h, --help  Show this message and exit.

Environment:
  CODEX_HOME    Override Codex config dir         (default: \$HOME/.codex).
  AGENTS_HOME   Override skills install root      (default: \$HOME/.agents).

Installs:
  ~/.agents/skills/baton-plan-release/SKILL.md             (and 6 more — one per baton command)
  ~/.codex/baton/                                          (rule docs, role prompts, templates)
  ~/.codex/baton/schemas/                                  (record schemas)

Does NOT install:
  any binary. Gates are run by the open \`sworn\` binary (reference implementation).

Does NOT modify:
  ~/.codex/AGENTS.md                                       (wire AGENTS-fragment.md in manually)
  any existing skills other than the seven named above

Invocation in Codex:
  Type \$baton-plan-release (or /skills to pick from the menu) in any
  Codex session — CLI or Mac App. The skill body is the same prompt
  body Claude Code reads from /plan-release etc.
EOF
}

DRY_RUN=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -h|--help)    usage; exit 0 ;;
    --dry-run)    DRY_RUN=1 ;;
    -y|--yes)     ASSUME_YES=1 ;;
    *)            echo "install-codex.sh: unknown argument '$arg'" >&2; usage >&2; exit 2 ;;
  esac
done

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"
SKILLS_DIR="$AGENTS_HOME/skills"

echo "baton installer (Codex)"
echo "  bundle:       $BUNDLE_DIR"
echo "  codex home:   $CODEX_HOME"
echo "  skills root:  $SKILLS_DIR"
[[ "$DRY_RUN" -eq 1 ]] && echo "  mode:         DRY RUN (no files will be copied)"
echo

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  would: $*"
  else
    "$@"
  fi
}

# Plan + confirmation gate (mirrors install.sh behaviour). Non-interactive
# shells proceed silently; --dry-run previews; -y skips the prompt.
cat <<EOF
About to install baton for Codex:
  $SKILLS_DIR/baton-*/      seven Codex skills, one per baton command  (overwritten)
  $CODEX_HOME/baton/        rule docs, role prompts, templates          (overwritten)
  $CODEX_HOME/baton/schemas/ record schemas                             (overwritten)

No binaries installed. Not touched: your shell rc, $CODEX_HOME/AGENTS.md.
EOF

if [[ "$DRY_RUN" -eq 0 && "$ASSUME_YES" -eq 0 ]]; then
  if [[ -t 0 ]]; then
    printf '\nProceed? [y/N] '
    read -r reply || reply=''
    case "$reply" in
      [yY]|[yY][eE][sS]) ;;
      *) echo "Aborted — nothing was installed."; exit 0 ;;
    esac
  else
    echo
    echo "Non-interactive shell — proceeding. (--dry-run to preview, --help for options.)"
  fi
fi
echo

run mkdir -p "$SKILLS_DIR" "$CODEX_HOME/baton"

# Docs package: rules, role-prompts/, release-mode-template/. Installed FIRST
# so the skill bodies that reference $CODEX_HOME/baton/... resolve immediately
# after install completes.
run cp -rv "$BUNDLE_DIR"/claude/baton/. "$CODEX_HOME/baton/"

# Rewrite every $HOME/.claude/baton/ reference inside the docs package to
# $HOME/.codex/baton/ — the role prompts and templates were authored for
# Claude Code's install root and need to point at Codex's instead.
if [[ "$DRY_RUN" -eq 0 ]]; then
  find "$CODEX_HOME/baton" -type f \( -name '*.md' -o -name '*.json' \) -print0 \
    | xargs -0 sed -i.bak \
        -e 's|\$HOME/\.claude/baton/|$HOME/.codex/baton/|g' \
        -e 's|~/\.claude/baton/|~/.codex/baton/|g'
  find "$CODEX_HOME/baton" -type f -name '*.bak' -delete
fi

# Skills: wrap each claude/commands/*.md body in SKILL.md format. Codex skills
# require a `name:` and `description:` in YAML frontmatter; the existing
# command files already have `description:` and `argument-hint:`, so we add
# `name:` and preserve the rest. The command body becomes the SKILL.md body
# Codex loads on `$<skill-name>` invocation.
echo
for src in "$BUNDLE_DIR"/claude/commands/*.md; do
  cmd_name="$(basename "$src" .md)"               # e.g. plan-release
  skill_name="baton-${cmd_name}"                  # e.g. baton-plan-release
  skill_dir="$SKILLS_DIR/$skill_name"
  skill_md="$skill_dir/SKILL.md"

  run mkdir -p "$skill_dir"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  would: install skill $skill_name -> $skill_md"
    continue
  fi

  # Extract existing description from the source command's frontmatter.
  # Falls back to a generic line if absent.
  existing_desc="$(awk '/^description:/{sub(/^description: */, ""); print; exit}' "$src")"
  [[ -z "$existing_desc" ]] && existing_desc="baton ${cmd_name} command"

  # Strip the source frontmatter block; we rebuild it with the skill `name:`.
  body_after_frontmatter="$(awk '
    BEGIN { in_fm = 0; seen = 0 }
    /^---$/ {
      if (!seen) { in_fm = 1; seen = 1; next }
      else if (in_fm) { in_fm = 0; next }
    }
    !in_fm && seen { print }
    !seen { print }     # no frontmatter — emit verbatim
  ' "$src")"

  # Path rewrite: $HOME/.claude/{baton,bin}/ -> $HOME/.codex/{baton,bin}/.
  # $1 / $2 are kept verbatim — Codex passes args as free-form prompt text,
  # not positional substitution, so the agent reads the rule at the top of
  # the skill (added below) explaining that $1 / $2 reference the first and
  # second whitespace-separated tokens of the user's invocation message.
  rewritten_body="$(printf '%s\n' "$body_after_frontmatter" \
    | sed -e 's|\$HOME/\.claude/baton/|$HOME/.codex/baton/|g' \
          -e 's|~/\.claude/baton/|~/.codex/baton/|g')"

  cat > "$skill_md" <<SKILL_EOF
---
name: $skill_name
description: $existing_desc
---

> **Codex argument resolution.** This skill was generated by baton's install-codex.sh from the Claude Code slash-command body, which uses positional substitution (\`\$1\`, \`\$2\`). Codex skills receive arguments as free-form prompt text instead, so before reading the body below, **resolve \`\$1\` and \`\$2\` yourself** from the user's invocation message — they are the first and second whitespace-separated tokens after \`\$$skill_name\`. By shape: a token matching \`^S[0-9]+-\` is a slice-id; a token matching \`^[0-9]{4}-[0-9]{2}-[0-9]{2}-\` is a release-name. If the tokens are swapped, trust the shape and reassign. Wherever the body below shows \`\$1\` / \`\$2\`, substitute your resolved values.

$rewritten_body
SKILL_EOF

  echo "  installed: $skill_name -> $skill_md"
done

# Record schemas — the JSON-record contracts the roles emit against. Hosted at
# baton.sawy3r.net/schemas/; installed locally for offline use.
run mkdir -p "$CODEX_HOME/baton/schemas"
run cp -v "$BUNDLE_DIR"/schemas/*.json "$CODEX_HOME/baton/schemas/"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "DRY RUN complete. Re-run without --dry-run to install."
  exit 0
fi

cat <<EOF

----------------------------------------------------------------------
Install complete.

Codex skills available in every Codex session on this machine
(CLI + Mac App — both read the same ~/.agents/skills/ root):

  \$baton-plan-release         (plan a new release, conversational)
  \$baton-replan-release       (revise a release already in flight)
  \$baton-implement-slice      (implementer role, per slice)
  \$baton-verify-slice         (verifier role — start in a FRESH session, Rule 7)
  \$baton-merge-track          (track -> release-wt, gated on every slice verified)
  \$baton-merge-release        (release-wt -> integration branch)
  \$baton-mark-shipped         (verified -> shipped, after deploy)

Invocation forms in Codex:
  - Type \$<skill-name> followed by your arguments, e.g.
      \$baton-plan-release 2026-06-10-multi-currency
      \$baton-implement-slice S03-portfolio-add-flow 2026-06-10-multi-currency
  - Or use /skills to pick from the menu.

Running the gates (optional):
  Baton ships no binaries. The skill bodies reference each gate by name with a
  pointer to the open \`sworn\` binary (e.g. \`sworn trace\`, \`sworn verify\`).
  Install \`sworn\` to automate the gates; the by-hand loop needs only these files.

Remaining manual step — wire the Rule 1-5 fragment into your Codex agent
instructions. The fragment ships at:
  $CODEX_HOME/baton/AGENTS-fragment.md

Two ways to wire it (mirror install.sh):
  (a) Per-project: copy AGENTS-fragment.md content into the project's
      AGENTS.md. Each project that opts in gets the rules.
  (b) User-level: append the content to $CODEX_HOME/AGENTS.md so it
      applies to every Codex session on this machine. Highest leverage.
      (Codex's AGENTS.md discovery order: ~/.codex/AGENTS.md global,
       then project-root AGENTS.md, then walking down to cwd.)

Project setup before first \$baton-plan-release:
  1. cd into the target repo.
  2. mkdir -p docs/release    (or symlink docs/ to your docs site root if
                                your project uses Fumadocs / similar).
  3. Run \$baton-plan-release <YYYY-MM-DD-theme> from a fresh Codex session.

See $CODEX_HOME/baton/README.md for the rule rationale and
$CODEX_HOME/baton/INSTALL.md for deeper integration notes.

NOTE on cross-tool parity: baton was authored for Claude Code first.
The skill bodies are mechanically derived from the Claude Code slash-
command files at install time. A few rough edges to expect on Codex:

  - Codex passes arguments as free-form prompt text, so the skill body's
    references to positional \$1 / \$2 are rewritten to descriptive
    placeholders the agent resolves from the user's invocation message.
  - Some references to Claude Code-specific UI affordances (e.g.
    AskUserQuestion) read fine as "prompt the human" in Codex, but
    won't render as a Codex-native picker. Behaviour is preserved;
    presentation differs.

File issues at https://github.com/sawy3r/baton/issues if any skill
misbehaves in a Codex session.
EOF


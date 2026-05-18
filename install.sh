#!/usr/bin/env bash
#
# install.sh — install baton at the user level (~/.claude/).
#
# Idempotent: re-running overwrites the four slash commands, the
# baton docs package, and the release-verify.sh script. It does NOT
# touch ~/.claude/CLAUDE.md or any other user config — wiring the AGENTS rules
# fragment into your CLAUDE.md is a manual step printed at the end.

set -euo pipefail

usage() {
  cat <<EOF
baton installer

Usage: ./install.sh [--dry-run] [--help]

Options:
  --dry-run   Print what would be copied, don't actually copy.
  -h, --help  Show this message and exit.

Environment:
  CLAUDE_HOME   Override install target (default: \$HOME/.claude).

Installs:
  ~/.claude/commands/{plan-release,implement-slice,verify-slice,merge-release}.md
  ~/.claude/baton/                  (rule docs, role prompts, templates)
  ~/.claude/bin/release-verify.sh              (first-pass verifier script)

Does NOT modify:
  ~/.claude/CLAUDE.md                          (wire AGENTS-fragment.md in manually)
  any existing pre-installed slash commands other than the four named above
EOF
}

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    -h|--help)    usage; exit 0 ;;
    --dry-run)    DRY_RUN=1 ;;
    *)            echo "install.sh: unknown argument '$arg'" >&2; usage >&2; exit 2 ;;
  esac
done

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"

echo "baton installer"
echo "  bundle:      $BUNDLE_DIR"
echo "  install to:  $CLAUDE_HOME"
[[ "$DRY_RUN" -eq 1 ]] && echo "  mode:        DRY RUN (no files will be copied)"
echo

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  would: $*"
  else
    "$@"
  fi
}

run mkdir -p "$CLAUDE_HOME/commands" "$CLAUDE_HOME/baton" "$CLAUDE_HOME/bin"

# Slash commands (user-level, available in every project on this machine)
for f in "$BUNDLE_DIR"/claude/commands/*.md; do
  run cp -v "$f" "$CLAUDE_HOME/commands/"
done

# Docs package: rules, role-prompts/, release-mode-template/
run cp -rv "$BUNDLE_DIR"/claude/baton/. "$CLAUDE_HOME/baton/"

# release-verify.sh
run cp -v "$BUNDLE_DIR"/bin/release-verify.sh "$CLAUDE_HOME/bin/release-verify.sh"
run chmod +x "$CLAUDE_HOME/bin/release-verify.sh"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "DRY RUN complete. Re-run without --dry-run to install."
  exit 0
fi

cat <<EOF

----------------------------------------------------------------------
Install complete.

Slash commands available in every project on this machine:
  /plan-release <YYYY-MM-DD-theme>
  /implement-slice <slice-id> [<release-name>]
  /verify-slice <slice-id> [<release-name>]      (run in a FRESH terminal — Rule 7)
  /merge-release <release-name>

Verify script lives at:  $CLAUDE_HOME/bin/release-verify.sh
  (the slash commands invoke it by absolute path; you can also call it
   directly from any repo as \$HOME/.claude/bin/release-verify.sh)

Remaining manual step — wire the Rule 1–5 fragment into your global
agent instructions if you haven't already. The fragment ships at:
  $CLAUDE_HOME/baton/AGENTS-fragment.md

Two ways to wire it:
  (a) Per-project: copy AGENTS-fragment.md content into the project's
      AGENTS.md or CLAUDE.md. Each project that opts in gets the rules.
  (b) User-level: append the content to $CLAUDE_HOME/CLAUDE.md so it
      applies to every project on this machine. Highest leverage.

Project setup before first /plan-release:
  1. cd into the target repo.
  2. mkdir -p docs/release    (or symlink docs/ to your docs site root if
                                your project uses Fumadocs / similar).
  3. Run /plan-release <YYYY-MM-DD-theme> from a fresh Claude Code session.

See $CLAUDE_HOME/baton/README.md for the rule rationale and
$CLAUDE_HOME/baton/INSTALL.md for deeper integration notes.
EOF

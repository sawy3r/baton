#!/usr/bin/env bash
#
# install.sh — install baton at the user level (~/.claude/).
#
# Idempotent: re-running overwrites the seven slash commands, the
# baton docs package, and the bin/ scripts (release-verify.sh + the
# release-board tooling). It does NOT touch ~/.claude/CLAUDE.md or any other
# user config — wiring the AGENTS rules fragment into your CLAUDE.md is a
# manual step printed at the end.

set -euo pipefail

usage() {
  cat <<EOF
baton installer

Usage: ./install.sh [--dry-run] [-y|--yes] [--help]

Options:
  --dry-run   Print what would be copied, don't actually copy.
  -y, --yes   Skip the interactive confirmation prompt.
  -h, --help  Show this message and exit.

Environment:
  CLAUDE_HOME   Override install target (default: \$HOME/.claude).

Installs:
  ~/.claude/commands/{plan-release,replan-release,implement-slice,verify-slice,merge-track,merge-release,mark-shipped}.md
  ~/.claude/baton/                  (rule docs, role prompts, templates)
  ~/.claude/bin/release-verify.sh              (first-pass verifier script)
  ~/.claude/bin/release-board-status.sh        (release board — terminal verdict)
  ~/.claude/bin/release-board-ui.mjs           (release board — HTML dashboard)
  ~/.claude/bin/lib/release-board.mjs          (shared branch-aware board reader)

Does NOT modify:
  ~/.claude/CLAUDE.md                          (wire AGENTS-fragment.md in manually)
  any existing pre-installed slash commands other than the seven named above
EOF
}

DRY_RUN=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -h|--help)    usage; exit 0 ;;
    --dry-run)    DRY_RUN=1 ;;
    -y|--yes)     ASSUME_YES=1 ;;
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

# Show the plan, then — at an interactive terminal — gate on confirmation so the
# install never runs by surprise. A non-interactive run (pipe, CI, another tool)
# has no one to answer a prompt, so it proceeds — but it still prints this plan,
# so the run is never silent. --dry-run previews in full; -y/--yes skips the
# prompt. This script writes only inside $CLAUDE_HOME and touches no shell rc.
cat <<EOF
About to install baton into $CLAUDE_HOME:
  commands/   baton slash commands               (existing baton ones overwritten)
  baton/      rule docs, role prompts, templates  (overwritten)
  bin/        release-verify.sh + release-board tooling  (overwritten)

Not touched: your shell rc, $CLAUDE_HOME/CLAUDE.md, any other config.
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

run mkdir -p "$CLAUDE_HOME/commands" "$CLAUDE_HOME/baton" "$CLAUDE_HOME/bin"

# Slash commands (user-level, available in every project on this machine)
for f in "$BUNDLE_DIR"/claude/commands/*.md; do
  run cp -v "$f" "$CLAUDE_HOME/commands/"
done

# Docs package: rules, role-prompts/, release-mode-template/
run cp -rv "$BUNDLE_DIR"/claude/baton/. "$CLAUDE_HOME/baton/"

# bin/: release-verify.sh + the release-board tooling (status CLI, HTML
# dashboard, and the shared reader under bin/lib/).
# Deliberate allowlist — never a blanket copy of bin/. — so a stray file in
# the bundle's bin/ can't silently land in the user's ~/.claude/bin.
for f in release-verify.sh release-board-status.sh release-board-ui.mjs; do
  run cp -v "$BUNDLE_DIR/bin/$f" "$CLAUDE_HOME/bin/"
done
run mkdir -p "$CLAUDE_HOME/bin/lib"
run cp -rv "$BUNDLE_DIR"/bin/lib/. "$CLAUDE_HOME/bin/lib/"
run chmod +x "$CLAUDE_HOME/bin/release-verify.sh" \
             "$CLAUDE_HOME/bin/release-board-status.sh" \
             "$CLAUDE_HOME/bin/release-board-ui.mjs"

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
  /replan-release <release-name>                 (revise a release already in flight)
  /implement-slice <slice-id> [<release-name>]
  /verify-slice <slice-id> [<release-name>]      (run in a FRESH terminal — Rule 7)
  /merge-track <track-id> [<release-name>]       (track → release-wt)
  /merge-release <release-name>                  (release-wt → integration branch)
  /mark-shipped <release-name>                   (verified → shipped, after deploy)

Verify script lives at:  $CLAUDE_HOME/bin/release-verify.sh
  (the slash commands invoke it by absolute path; you can also call it
   directly from any repo as \$HOME/.claude/bin/release-verify.sh)

Release-board tooling, also at $CLAUDE_HOME/bin/ — run from inside any repo:
  release-board-status.sh [--verbose]    terminal go/no-go verdict (exit 0/1)
  release-board-ui.mjs [--port N]        auto-refreshing HTML dashboard
  Both resolve slice state from track/* + release-wt/* git branches. The
  release-docs root defaults to docs/release/; set BATON_RELEASE_DIR to
  override (e.g. docs/release for a Fumadocs layout).

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

# PATH guidance — surfaced, never auto-applied (this script edits no shell rc).
# Shown only when the bin dir is genuinely missing from PATH.
case ":${PATH}:" in
  *":$CLAUDE_HOME/bin:"*) : ;;  # already on PATH — nothing to surface
  *)
    cat <<EOF

Optional — add baton's bin/ to your PATH so the release-board scripts run by
bare name (release-board-status.sh / release-board-ui.mjs), the way their own
output refers to them. Add to your shell rc (~/.zshrc, ~/.bashrc, …):

  export PATH="\$HOME/.claude/bin:\$PATH"
EOF
    ;;
esac

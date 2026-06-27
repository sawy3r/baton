#!/usr/bin/env bash
#
# install-claude.sh — install baton (the spec) at the user level (~/.claude/).
#
# Baton is pure specification: slash commands, rule docs, role prompts, record
# schemas, and templates. It installs NO binaries. The mechanical gates are
# provided by the open `sworn` binary — the reference implementation. Install
# that separately if you want the gates automated; the by-hand loop needs nothing
# but these files and your LLM.
#
# Idempotent: re-running overwrites the slash commands and the baton docs
# package (rules, role prompts, schemas, templates). It does NOT touch
# ~/.claude/CLAUDE.md — wiring the AGENTS rules fragment in is a manual step
# printed at the end.

set -euo pipefail

usage() {
  cat <<EOF
baton installer (pure spec — no binaries)

Usage: ./install-claude.sh [--dry-run] [-y|--yes] [--help]

Options:
  --dry-run   Print what would be copied, don't actually copy.
  -y, --yes   Skip the interactive confirmation prompt.
  -h, --help  Show this message and exit.

Environment:
  CLAUDE_HOME   Override install target (default: \$HOME/.claude).

Installs:
  ~/.claude/commands/{plan-release,replan-release,implement-slice,verify-slice,merge-track,merge-release,mark-shipped}.md
  ~/.claude/baton/                  (rule docs, role prompts, templates)
  ~/.claude/baton/schemas/          (record schemas: board / spec / proof / status / journeys / attestations)

Does NOT install:
  any binary. Gates are run by the open \`sworn\` binary (reference implementation).

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
    *)            echo "install-claude.sh: unknown argument '$arg'" >&2; usage >&2; exit 2 ;;
  esac
done

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"

echo "baton installer (pure spec)"
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
  commands/        baton slash commands                 (existing baton ones overwritten)
  baton/           rule docs, role prompts, templates    (overwritten)
  baton/schemas/   record schemas                        (overwritten)

No binaries are installed. Not touched: your shell rc, $CLAUDE_HOME/CLAUDE.md.
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

run mkdir -p "$CLAUDE_HOME/commands" "$CLAUDE_HOME/baton"

# Slash commands (user-level, available in every project on this machine)
for f in "$BUNDLE_DIR"/commands/*.md; do
  run cp -v "$f" "$CLAUDE_HOME/commands/"
done

# Docs package: rules, role-prompts/, release-mode-template/
run cp -rv "$BUNDLE_DIR"/baton/. "$CLAUDE_HOME/baton/"

# Record schemas — the JSON-record contracts the roles emit against. Hosted
# canonically at baton.sawy3r.net/schemas/; installed locally for offline use.
run mkdir -p "$CLAUDE_HOME/baton/schemas"
run cp -v "$BUNDLE_DIR"/schemas/*.json "$CLAUDE_HOME/baton/schemas/"

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

Running the gates (optional):
  Baton ships no binaries. The role prompts reference each gate by name with a
  reference-implementation pointer to the open \`sworn\` binary (e.g. the trace
  gate is \`sworn trace\`, proof-bundle verification is \`sworn verify\`). Install
  \`sworn\` to automate the gates; the by-hand loop (paste prompts, the LLM emits
  the JSON records, you review them) needs nothing more than these files.

Remaining manual step — wire the Rule 1–5 fragment into your global
agent instructions if you haven't already. The fragment ships at:
  $CLAUDE_HOME/baton/AGENTS-fragment.md

Two ways to wire it:
  (a) Per-project: copy AGENTS-fragment.md content into the project's
      AGENTS.md (and vendor the rules into docs/baton/). REQUIRED for any
      repo with collaborators or public visibility: their agents read the
      repo's AGENTS.md, never your machine's CLAUDE.md.
  (b) User-level: append the content to $CLAUDE_HOME/CLAUDE.md so it
      applies to every project on THIS machine. Convenient for your solo
      work — but it is invisible to anyone else and to CI.

  NOTE: (b) does NOT substitute for (a). Do (a) for every repo that others
  (or CI) touch; (b) is an additional personal fallback, not a replacement.

Project setup before first /plan-release:
  1. cd into the target repo.
  2. mkdir -p docs/release    (or symlink docs/ to your docs site root if
                                your project uses Fumadocs / similar).
  3. Run /plan-release <YYYY-MM-DD-theme> from a fresh Claude Code session.

See $CLAUDE_HOME/baton/README.md for the rule rationale and
$CLAUDE_HOME/baton/INSTALL.md for deeper integration notes.
EOF

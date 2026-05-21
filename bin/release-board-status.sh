#!/usr/bin/env bash
#
# release-board-status.sh — release board countdown, terminal verdict.
#
# Resolves every slice's authoritative status.json from git refs
# (track/* + release-wt/* branches) via lib/release-board.mjs — the same
# branch-aware reader the release-board-ui.mjs dashboard uses — and prints a
# per-release + aggregate summary.
#
# Exit 0 if all slices are in a terminal state (verified / shipped /
# deferred); exit 1 otherwise; exit 2 if the board reader fails.
#
# Run from anywhere inside the target repo. The release-docs root defaults to
# docs/release/; override with the BATON_RELEASE_DIR environment variable.
#
# Usage: release-board-status.sh [--verbose]
#   --verbose  list every non-terminal slice beneath its release

set -euo pipefail

VERBOSE=false
for arg in "$@"; do
  [[ "$arg" == "--verbose" ]] && VERBOSE=true
done

# Repo we report on: the git toplevel of wherever we're invoked from.
if ! REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "release-board-status: not inside a git repository" >&2
  exit 2
fi
cd "$REPO_ROOT"

# The board reader lives next to this script (bin/lib/), regardless of where
# this script itself is installed.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOARD_READER="$SCRIPT_DIR/lib/release-board.mjs"

# ---------------------------------------------------------------------------
# dependency checks
# ---------------------------------------------------------------------------
for dep in node jq; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    echo "release-board-status: '$dep' is required but not on PATH" >&2
    exit 2
  fi
done

# ---------------------------------------------------------------------------
# colours
# ---------------------------------------------------------------------------
green()  { printf '\033[32m%s\033[0m' "$*"; }
red()    { printf '\033[31m%s\033[0m' "$*"; }
yellow() { printf '\033[33m%s\033[0m' "$*"; }
gray()   { printf '\033[90m%s\033[0m' "$*"; }
bold()   { printf '\033[1m%s\033[0m'  "$*"; }
reset()  { printf '\033[0m'; }

# ---------------------------------------------------------------------------
# terminal states — slices in these states don't block go-live
# ---------------------------------------------------------------------------
is_terminal() {
  case "$1" in
    verified|shipped|deferred) return 0 ;;
    *) return 1 ;;
  esac
}

state_label() {
  case "$1" in
    verified)            green "verified" ;;
    shipped)             green "shipped" ;;
    deferred)            gray  "deferred" ;;
    implemented)         yellow "implemented (needs verify)" ;;
    in_progress)         yellow "in_progress" ;;
    planned)             red    "planned" ;;
    failed_verification) red    "failed_verification" ;;
    *)                   red    "$1" ;;
  esac
}

track_state_label() {
  case "$1" in
    merged)      green  "merged" ;;
    in_progress) yellow "in_progress" ;;
    planned)     gray   "planned" ;;
    *)           gray   "${1:-unknown}" ;;
  esac
}

# The slash command that advances a slice in a given state ('' = terminal).
next_command() {
  case "$1" in
    planned|in_progress|failed_verification) echo "/implement-slice" ;;
    implemented)                             echo "/verify-slice" ;;
    *)                                       echo "" ;;
  esac
}

# ---------------------------------------------------------------------------
# collect data — via the shared branch-aware reader
# ---------------------------------------------------------------------------
# lib/release-board.mjs resolves every slice's authoritative status.json from
# git refs (track/<release>/* then release-wt/<release>, working tree last) and
# emits the whole board as one JSON blob. This is the same reader
# release-board-ui.mjs renders — one source of truth, so the CLI verdict and
# the HTML dashboard can never disagree.

if ! board_json="$(node "$BOARD_READER")"; then
  red "release-board-status: failed to read the release board"; echo
  echo "  $BOARD_READER exited non-zero"
  exit 2
fi

declare -A release_total
declare -A release_terminal

total_all=0
terminal_all=0

while IFS=$'\t' read -r release state; do
  [[ -z "$release" ]] && continue
  release_total["$release"]=$(( ${release_total["$release"]:-0} + 1 ))
  total_all=$(( total_all + 1 ))
  if is_terminal "$state"; then
    release_terminal["$release"]=$(( ${release_terminal["$release"]:-0} + 1 ))
    terminal_all=$(( terminal_all + 1 ))
  fi
done < <(jq -r '.releases | to_entries[] | .key as $r | .value.slices[] | "\($r)\t\(.state)"' <<< "$board_json")

remaining_all=$(( total_all - terminal_all ))

# ---------------------------------------------------------------------------
# header
# ---------------------------------------------------------------------------

echo
bold "RELEASE BOARD — $(basename "$REPO_ROOT")"
echo
gray "$(date '+%A %-d %B %Y')"
echo

# ---------------------------------------------------------------------------
# per-release table
# ---------------------------------------------------------------------------

HR="────────────────────────────────────────────────────────────────────────"

printf "%-52s  %-12s  %s\n" "Release" "Verified" "Verdict"
echo "$HR"

# Track-grouped detail for one release (--verbose). Renders each track with
# its non-terminal slices; the actionable slice and a merge-ready track are
# annotated with the slash command to run next. release-board.mjs derives the
# actionable / blockedBy / readyToMerge facts — this only renders them.
print_verbose_detail() {
  local release="$1"
  local kind f2 f3 f4 f5 f6 f7 verb
  while IFS=$'\t' read -r kind f2 f3 f4 f5 f6 f7; do
    case "$kind" in
      T)  # f2=id f3=state f4=verified f5=total f6=blockedBy(csv) f7=readyToMerge
        printf "  "; bold "$f2"; printf "  "
        track_state_label "$f3"
        printf "  %s/%s" "$f4" "$f5"
        [[ "$f6" != "-" ]] && { printf "  "; yellow "needs ${f6//,/, }"; }
        [[ "$f7" == "1" ]] && { printf "  "; green "-> /merge-track $f2 $release"; }
        echo
        ;;
      S)  # f2=id f3=state f4=actionable(0/1)
        printf "    %-46s " "$f2"
        state_label "$f3"
        if [[ "$f4" == "1" ]]; then
          verb="$(next_command "$f3")"
          [[ -n "$verb" ]] && { printf "  "; green "-> $verb $f2 $release"; }
        fi
        echo
        ;;
    esac
  done < <(jq -r --arg r "$release" '
    .releases[$r] as $rel
    | ($rel.tracks // []) as $tracks
    | ($rel.slices | map({key: .id, value: .}) | from_entries) as $byId
    | if ($tracks | length) > 0
      then
        $tracks[] | . as $tr
        | ([ $tr.slices[]? | $byId[.] | select(. != null) ]) as $own
        | ([ $own[] | select(.state | IN("verified","shipped","deferred")) ] | length) as $term
        | ([ $own[] | select((.state | IN("verified","shipped","deferred")) | not) ]) as $pending
        | select(($pending | length) > 0 or ($tr.state != "merged"))
        | (
            "T\t\($tr.id)\t\($tr.state)\t\($term)\t\($own | length)\t\(if (($tr.blockedBy // []) | length) > 0 then ($tr.blockedBy | join(",")) else "-" end)\t\(if $tr.readyToMerge then "1" else "0" end)"
          ),
          ( $pending[] | "S\t\(.id)\t\(.state)\t\(if .actionable then "1" else "0" end)" )
      else
        $rel.slices[]
        | select((.state | IN("verified","shipped","deferred")) | not)
        | "S\t\(.id)\t\(.state)\t\(if .actionable then "1" else "0" end)"
      end
  ' <<< "$board_json")
}

for release in $(echo "${!release_total[@]}" | tr ' ' '\n' | sort); do
  total=${release_total["$release"]}
  terminal=${release_terminal["$release"]:-0}
  remaining=$(( total - terminal ))

  # Strip a leading YYYY-MM-DD- date prefix for a compact label.
  if [[ "$release" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-(.+)$ ]]; then
    short="${BASH_REMATCH[1]}"
  else
    short="$release"
  fi

  printf "%-52s  %3d / %-4d  " "$short" "$terminal" "$total"

  if [[ "$remaining" -eq 0 ]]; then
    green "✓ CLEAR"
  else
    red "✗ BLOCKED ($remaining remaining)"
  fi
  echo

  if $VERBOSE && [[ "$remaining" -gt 0 ]]; then
    print_verbose_detail "$release"
  fi
done

echo "$HR"
printf "%-52s  %3d / %-4d\n" "TOTAL" "$terminal_all" "$total_all"
echo

# ---------------------------------------------------------------------------
# planning-record integrity check
# ---------------------------------------------------------------------------
# release-board.mjs walks each release's index.md `## Slices` table and flags
# rows that committed branch state can't back:
#
#   (a) ghost slice: an index.md row names a slice ID, but no status.json
#       exists for it on any track/* or release-wt/* branch (nor on disk) —
#       the countdown can't see it, so it silently undercounts.
#
#   (b) pending spec: a row exists for a live slice, but the spec column is
#       "(pending)" / "—" / "-" / empty AND no spec.md is on any branch —
#       anchored in the plan, unimplementable as-is.
#
# Track-table rows are excluded: `T1-projection` matches a slice-ID regex but
# is not a slice. These are warnings only — they do not affect the exit code.

mapfile -t ghost_slices  < <(jq -r '.ghostSlices[]'  <<< "$board_json")
mapfile -t pending_specs < <(jq -r '.pendingSpecs[]' <<< "$board_json")

if (( ${#ghost_slices[@]} > 0 || ${#pending_specs[@]} > 0 )); then
  yellow "PLANNING-RECORD WARNINGS"; echo
  echo
  if (( ${#ghost_slices[@]} > 0 )); then
    echo "Index.md rows naming slices with no status.json on any branch (countdown can't see them):"
    for entry in "${ghost_slices[@]}"; do
      echo "  - $entry"
    done
    echo
  fi
  if (( ${#pending_specs[@]} > 0 )); then
    echo "Slices named in index.md with no spec.md on any branch (unimplementable as-is):"
    for entry in "${pending_specs[@]}"; do
      echo "  - $entry"
    done
    echo
  fi
fi

# ---------------------------------------------------------------------------
# verdict
# ---------------------------------------------------------------------------

if [[ "$remaining_all" -eq 0 ]]; then
  green "READY TO SHIP"; echo
  echo "All $total_all slices are in a terminal state."
  echo
  exit 0
else
  red "NOT READY"; echo
  echo "$remaining_all slice(s) remaining before go-live."
  echo
  if ! $VERBOSE; then
    gray "Run with --verbose for the track-grouped breakdown + next commands."
    echo
  fi
  exit 1
fi

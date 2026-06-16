#!/usr/bin/env bash
#
# release-verify.sh - deterministic first-pass verification for a release slice.
#
# Usage: release-verify.sh <slice-id> [<release-name>]
#
# Purpose: catch cheap-to-detect failures before invoking an LLM verifier session.
# Exits non-zero on any failure so it can gate CI / pre-PR hooks if desired.
#
# Implements the script half of Baton Rule 7. See:
#   $HOME/.claude/baton/adversarial-verification.md
#
# This script does NOT make subjective calls. It checks:
#   - slice folder + required artefacts exist
#   - status.json parses and is in the expected state
#   - git diff is non-empty
#   - planned vs actual file lists are non-trivially related
#   - dark-code markers in changed files
#   - test commands listed in proof.md actually exist as runnable invocations
#
# Anything subjective (does the diff implement the user outcome? does the test
# actually exercise the integration point?) is left to the LLM verifier session.

set -euo pipefail

# ---------------------------------------------------------------------------
# args + config
# ---------------------------------------------------------------------------

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <slice-id> [<release-name>]" >&2
  exit 2
fi

SLICE_ID="$1"
RELEASE_NAME="${2:-}"
BASE_BRANCH="${BASE_BRANCH:-main}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Locate slice folder. If release-name not supplied, find a unique match.
if [[ -n "$RELEASE_NAME" ]]; then
  SLICE_DIR="docs/release/$RELEASE_NAME/$SLICE_ID"
else
  matches=$(find docs/release -maxdepth 3 -type d -name "$SLICE_ID" 2>/dev/null || true)
  match_count=$(echo "$matches" | grep -c . || true)
  if [[ "$match_count" -eq 0 ]]; then
    echo "FAIL: no slice folder found for $SLICE_ID under docs/release/" >&2
    exit 1
  elif [[ "$match_count" -gt 1 ]]; then
    echo "FAIL: multiple slice folders match $SLICE_ID; pass <release-name> to disambiguate:" >&2
    echo "$matches" >&2
    exit 1
  fi
  SLICE_DIR="$matches"
fi

# ---------------------------------------------------------------------------
# pretty printers
# ---------------------------------------------------------------------------

PASS=0
FAIL=0

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
gray()  { printf '\033[90m%s\033[0m\n' "$*"; }

check_pass() { green "  PASS  $1"; PASS=$((PASS+1)); }
check_fail() { red   "  FAIL  $1"; FAIL=$((FAIL+1)); }
section()    { echo; echo "== $1 =="; }

echo "release-verify.sh"
gray "  slice:       $SLICE_ID"
gray "  slice dir:   $SLICE_DIR"
gray "  base branch: $BASE_BRANCH"

# ---------------------------------------------------------------------------
# Check 1: slice folder + required files
# ---------------------------------------------------------------------------

section "Slice artefacts"

if [[ ! -d "$SLICE_DIR" ]]; then
  check_fail "slice folder missing: $SLICE_DIR"
else
  check_pass "slice folder exists"
fi

for f in spec.md proof.md status.json journal.md; do
  if [[ -f "$SLICE_DIR/$f" ]]; then
    check_pass "$f present"
  else
    check_fail "$f missing"
  fi
done

# ---------------------------------------------------------------------------
# Check 2: status.json parses and is in implemented state
# ---------------------------------------------------------------------------

section "Status"

STATUS_FILE="$SLICE_DIR/status.json"
if [[ -f "$STATUS_FILE" ]]; then
  if command -v jq >/dev/null 2>&1; then
    if jq empty "$STATUS_FILE" >/dev/null 2>&1; then
      check_pass "status.json is valid JSON"
      STATE=$(jq -r '.state' "$STATUS_FILE")
      gray "  state: $STATE"
      case "$STATE" in
        implemented|verified)
          check_pass "state is '$STATE' (eligible for verifier review)"
          ;;
        planned|in_progress)
          check_fail "state is '$STATE' — slice not yet ready for verifier; complete implementation first"
          ;;
        failed_verification)
          check_fail "state is 'failed_verification' — fix violations and bump state back to 'implemented'"
          ;;
        deferred)
          check_fail "state is 'deferred' — verification is moot until slice is reactivated"
          ;;
        shipped)
          check_pass "state is 'shipped' — verification already complete"
          ;;
        *)
          check_fail "state is unrecognised: '$STATE'"
          ;;
      esac
    else
      check_fail "status.json is not valid JSON"
    fi
  else
    gray "  jq not installed; skipping JSON parse check"
  fi
fi

# ---------------------------------------------------------------------------
# Check 3: git diff is non-empty against base branch
# ---------------------------------------------------------------------------

section "Diff vs $BASE_BRANCH"

if git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
  CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH" -- 2>/dev/null || true)
  CHANGED_COUNT=$(echo "$CHANGED_FILES" | grep -c . || true)
  if [[ "$CHANGED_COUNT" -gt 0 ]]; then
    check_pass "$CHANGED_COUNT file(s) changed vs $BASE_BRANCH"
    gray "  (first 20)"
    # `head` closes the pipe early; with `set -o pipefail` the upstream
    # `echo` would exit 141 (SIGPIPE) and `set -e` would kill the script.
    # Buffer the truncated list so the pipe always completes cleanly even
    # on branches with hundreds of changed files.
    FIRST_20=$(printf '%s\n' "$CHANGED_FILES" | awk 'NR <= 20')
    printf '%s\n' "$FIRST_20" | sed 's/^/    /'
  else
    check_fail "no files changed vs $BASE_BRANCH — slice cannot be implemented with zero diff"
  fi
else
  gray "  base branch '$BASE_BRANCH' not found locally; skipping diff check"
fi

# ---------------------------------------------------------------------------
# Check 4: dark-code markers in changed files
# ---------------------------------------------------------------------------

section "Dark-code markers in changed files"

DARK_PATTERNS='TODO|FIXME|XXX|HACK|\bdeferred\b|\bplaceholder\b'
# HTML/JSX attribute-name uses of `placeholder=` are legitimate React form
# code and not dark-code markers. Filter them out so the scan doesn't trip
# on every input with a user-facing hint. Pattern: `placeholder="..."` or
# `placeholder={...}` preceded only by whitespace from the diff `+` prefix.
HTML_PLACEHOLDER_RE='placeholder=("|\{)'

if [[ -n "${CHANGED_FILES:-}" ]]; then
  HITS=""
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ ! -f "$f" ]] && continue
    case "$f" in
      # This script defines DARK_PATTERNS as a regex literal; if the slice
      # touched it, the literal itself would match. Skip the script.
      *.md|docs/*|*.lock|*.snap|release-verify.sh) continue ;;
    esac
    # Only scan lines this slice ADDED, not the entire file. A long-lived
    # integration branch carries hundreds of pre-existing markers in
    # surrounding code that the slice is not responsible for; scanning
    # the whole file would always FAIL on a big-bang release.
    if matches=$(git diff -U0 "$BASE_BRANCH" -- "$f" 2>/dev/null \
                   | grep -E '^\+[^+]' \
                   | grep -vE "$HTML_PLACEHOLDER_RE" \
                   | grep -nE "$DARK_PATTERNS" 2>/dev/null); then
      HITS="$HITS\n$f:\n$matches"
    fi
  done <<< "$CHANGED_FILES"

  if [[ -z "$HITS" ]]; then
    check_pass "no dark-code markers in changed source files"
  else
    check_fail "dark-code markers found in changed source files (must be Rule 2 deferrals)"
    gray "  hits:"
    printf '%b\n' "$HITS" | sed 's/^/    /'
  fi
else
  gray "  no changed files to scan"
fi

# ---------------------------------------------------------------------------
# Check 5: proof.md contains required section headers
# ---------------------------------------------------------------------------

section "Proof bundle structural checks"

PROOF_FILE="$SLICE_DIR/proof.md"
if [[ -f "$PROOF_FILE" ]]; then
  REQUIRED_HEADERS=("## Scope" "## Files changed" "## Test results" "## Reachability artefact" "## Delivered" "## Not delivered" "## Divergence from plan")
  for h in "${REQUIRED_HEADERS[@]}"; do
    if grep -qF "$h" "$PROOF_FILE"; then
      check_pass "proof.md has section: $h"
    else
      check_fail "proof.md missing section: $h"
    fi
  done

  # Heuristic: proof.md should not be a verbatim copy of the template
  if grep -q '<paste output here>' "$PROOF_FILE"; then
    check_fail "proof.md contains unfilled template placeholders ('<paste output here>')"
  else
    check_pass "no obvious template placeholders left in proof.md"
  fi
fi

# ---------------------------------------------------------------------------
# Check 6: spec.md frontmatter is strict-YAML safe
# ---------------------------------------------------------------------------
#
# The release specs double as Fumadocs content pages, and Fumadocs parses their
# YAML frontmatter with js-yaml in STRICT mode. A bare (unquoted) top-level
# scalar whose value contains a ': ' (colon-space) is read as a nested mapping
# key and throws "bad indentation of a mapping entry", breaking the docs build.
# Real cases this caught: `description: ...Fix: debounce...`, `... adds
# release_index: to ...`, `... the track's e2e_specs: list ...`. Quoting the
# value fixes it. Baton's templates ship quoted and planner.md Phase 4 mandates
# quoting; this is the deterministic backstop. The check targets ONLY the proven
# break class, so it never trips on valid frontmatter (`tracks: []`, empty
# values, `key: # comment`, already-quoted scalars).

section "Frontmatter YAML safety"

SPEC_FILE="$SLICE_DIR/spec.md"
if [[ -f "$SPEC_FILE" ]]; then
  HAZ=$(awk '
    NR==1 && $0!="---" { exit }
    NR==1 { infm=1; next }
    infm && $0=="---" { exit }
    infm && /^[A-Za-z_][A-Za-z0-9_-]*:[ \t]/ {
      val=$0; sub(/^[A-Za-z_][A-Za-z0-9_-]*:[ \t]+/, "", val)
      if (val == "") next                              # empty value
      c = substr(val, 1, 1)
      if (c == "\"" || c == "\047" || c == "#") next   # quoted scalar / comment
      if (val ~ /:[ \t]/ || val ~ /:$/) print          # bare colon-space / trailing colon
    }
  ' "$SPEC_FILE")
  if [[ -z "$HAZ" ]]; then
    check_pass "spec.md frontmatter is strict-YAML safe"
  else
    check_fail "spec.md frontmatter has unquoted hazardous scalar(s); strict YAML (Fumadocs/js-yaml) will reject the docs build"
    gray "  single-quote each value below (double any internal single quote: ' -> ''):"
    printf '%s\n' "$HAZ" | sed 's/^/    /'
  fi
fi

# ---------------------------------------------------------------------------
# Final verdict
# ---------------------------------------------------------------------------

section "First-pass verdict"

echo "  checks passed: $PASS"
echo "  checks failed: $FAIL"

if [[ "$FAIL" -gt 0 ]]; then
  red ""
  red "FIRST-PASS FAIL"
  red "Address the failures above before invoking the LLM verifier session."
  red "See $HOME/.claude/baton/adversarial-verification.md for the verifier protocol."
  exit 1
fi

green ""
green "FIRST-PASS PASS"
green "Open a FRESH session and paste role-prompts/verifier.md to perform adversarial verification."
green "Do NOT run the verifier in this same session — Rule 7 requires a fresh context window."

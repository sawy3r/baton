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

# Spec completeness: catch missing Required tests section early — the
# implementer's Gate 0 should prevent this, but belt-and-suspenders.
if [[ -f "$SLICE_DIR/spec.md" ]]; then
  if grep -q '^## Required tests' "$SLICE_DIR/spec.md" 2>/dev/null; then
    check_pass "spec.md has Required tests section"
  else
    check_fail "spec.md is missing ## Required tests section — add it before invoking the verifier"
    gray "  Every spec must declare Required tests so the verifier knows what to check."
  fi

  # If any AC mentions Playwright, screenshot, or e2e, the Required tests
  # section must carry the playwright-screenshot opt-in. This is the same
  # check that Check 6 applies to proof.md — checking it here at artefact-
  # inspection time catches the omission before the verifier sees it.
  if grep -qiE 'playwright|e2e|screenshot' "$SLICE_DIR/spec.md" 2>/dev/null; then
    REQUIRED_TESTS_SECTION=$(sed -n '/^## Required tests/,/^## /p' "$SLICE_DIR/spec.md" 2>/dev/null || true)
    if printf '%s\n' "$REQUIRED_TESTS_SECTION" | grep -qE 'playwright-screenshot' 2>/dev/null; then
      check_pass "Playwright/e2e mentioned in ACs and playwright-screenshot declared in Required tests"
    elif printf '%s\n' "$REQUIRED_TESTS_SECTION" | grep -qiE 'playwright' 2>/dev/null && \
         printf '%s\n' "$REQUIRED_TESTS_SECTION" | grep -qiE 'screenshot' 2>/dev/null; then
      check_pass "Playwright/e2e mentioned in ACs and Playwright+screenshot declared in Required tests"
    else
      check_fail "spec.md mentions Playwright/e2e/screenshot in ACs but Required tests section does not declare playwright-screenshot opt-in"
      gray "  Add '- **playwright-screenshot** \`tests/e2e/...\` — <description>. Covers AC<n>.' to ## Required tests."
    fi
  fi
fi

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
# Check 2.1: BLOCKED verdict must have non-empty violations (S38)
#
# A verifier BLOCKED verdict that leaves verification.violations empty is
# malformed — the planner has nothing machine-readable to act on. This gate
# fails closed on result:blocked + violations empty so a malformed BLOCKED
# can never be handed off.
# ---------------------------------------------------------------------------

if [[ -f "$STATUS_FILE" ]] && command -v jq >/dev/null 2>&1; then
  RESULT=$(jq -r '.verification.result // ""' "$STATUS_FILE")
  if [[ "$RESULT" == "blocked" ]]; then
    VIOLATIONS_LEN=$(jq '.verification.violations | length' "$STATUS_FILE")
    if [[ "$VIOLATIONS_LEN" -eq 0 ]]; then
      check_fail "BLOCKED verdict with empty violations — must record concrete defect in verification.violations"
      gray "  The loop reads violations for the planner page; a blank reason is unactionable."
    else
      check_pass "BLOCKED verdict has $VIOLATIONS_LEN violation(s) recorded"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Check 2.5: integration branch drift#
# If the worktree branch is behind the integration branch (release/vX.Y.Z),
# test infrastructure files (scenario fixtures, playwright config, etc.) may
# have been updated upstream and the worktree hasn't absorbed them yet.
# That causes test failures that look like engine regressions but are
# actually stale fixture / stale config problems.
#
# Hard-fails when test-infra files have drifted (false test failures likely).
# Soft-warns for other drift (no test-infra overlap).
# ---------------------------------------------------------------------------

section "Integration branch drift"

# Derive release name from SLICE_DIR: docs/release/<release-name>/<slice-id>
RELEASE_NAME_DERIVED=""
if [[ -n "$RELEASE_NAME" ]]; then
  RELEASE_NAME_DERIVED="$RELEASE_NAME"
else
  RELEASE_NAME_DERIVED=$(printf '%s' "$SLICE_DIR" | sed 's|docs/release/||' | cut -d'/' -f1)
fi

INTEGRATION_BRANCH=""
INDEX_MD="docs/release/$RELEASE_NAME_DERIVED/index.md"
if [[ -f "$INDEX_MD" ]]; then
  # Match the integration branch line: "Target version / integration branch: release/vX.Y.Z"
  INTEGRATION_BRANCH=$(grep -oE 'release/v[a-zA-Z0-9._-]+' "$INDEX_MD" | head -1 || true)
fi

if [[ -z "$INTEGRATION_BRANCH" ]]; then
  gray "  could not determine integration branch from $INDEX_MD; skipping drift check"
else
  gray "  integration branch: $INTEGRATION_BRANCH"
  if ! git rev-parse --verify "$INTEGRATION_BRANCH" >/dev/null 2>&1; then
    gray "  $INTEGRATION_BRANCH not found locally — run 'git fetch' then re-verify for accurate drift check"
  else
    DRIFT_COUNT=$(git rev-list --count HEAD.."$INTEGRATION_BRANCH" 2>/dev/null || echo "0")
    if [[ "$DRIFT_COUNT" -eq 0 ]]; then
      check_pass "worktree branch is current with $INTEGRATION_BRANCH (no drift)"
    else
      # Identify which files the drift commits touch
      DRIFT_FILES=$(git log --name-only --format= HEAD.."$INTEGRATION_BRANCH" 2>/dev/null \
                    | grep -v '^$' | sort -u || true)
      TEST_INFRA_DRIFT=$(printf '%s\n' "$DRIFT_FILES" \
                         | grep -E '(assets/test-scenarios|playwright\.config|scenarios\.test\.|\.baton/)' \
                         || true)

      DRIFT_COMMITS=$(git log --oneline HEAD.."$INTEGRATION_BRANCH" 2>/dev/null || true)

      if [[ -n "$TEST_INFRA_DRIFT" ]]; then
        check_fail "worktree is $DRIFT_COUNT commit(s) behind $INTEGRATION_BRANCH and test-infrastructure files have drifted — test failures may be false positives, not engine regressions"
        gray "  drifted test-infra files:"
        printf '%s\n' "$TEST_INFRA_DRIFT" | sed 's/^/    /'
        gray "  fix before re-verifying:"
        gray "    git merge $INTEGRATION_BRANCH --no-ff \\"
        gray "      -m 'chore: forward-merge $INTEGRATION_BRANCH before verification'"
      else
        gray "  WARNING: worktree is $DRIFT_COUNT commit(s) behind $INTEGRATION_BRANCH (no test-infra overlap)"
        gray "  upstream commits not yet absorbed:"
        printf '%s\n' "$DRIFT_COMMITS" | sed 's/^/    /'
        check_pass "integration branch drift present but does not affect test infrastructure"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Check 3: git diff is non-empty against start_commit + proof.md consistency
# ---------------------------------------------------------------------------
#
# The verifier diffs against status.json start_commit, NOT against main.
# Forward-merges from release-wt between start_commit and HEAD introduce
# harness/planner files that appear in the verifier's diff but NOT in a
# main-based diff — guaranteed Gate 2 mismatch (recurring S21-books pattern).
#
# This check:
# a) reads start_commit from status.json
# b) diffs HEAD against start_commit (the verifier's actual base)
# c) warns if proof.md "Files changed" section looks like it was generated
#    against a different base (file-count mismatch >= 5)

section "Diff vs start_commit (verifier base)"

START_COMMIT=""
if [[ -f "$STATUS_FILE" ]] && command -v jq >/dev/null 2>&1; then
  START_COMMIT=$(jq -r '.start_commit // empty' "$STATUS_FILE" 2>/dev/null || true)
fi

DIFF_BASE="$BASE_BRANCH"
if [[ -z "$START_COMMIT" ]]; then
  gray "  start_commit not set in status.json — using $BASE_BRANCH as fallback"
elif ! git rev-parse --verify "$START_COMMIT" >/dev/null 2>&1; then
  gray "  start_commit $START_COMMIT not found locally; falling back to $BASE_BRANCH"
else
  DIFF_BASE="$START_COMMIT"
  gray "  diff base: start_commit $START_COMMIT"
fi

if git rev-parse --verify "$DIFF_BASE" >/dev/null 2>&1; then
  CHANGED_FILES=$(git diff --name-only "$DIFF_BASE" -- 2>/dev/null || true)
  CHANGED_COUNT=$(printf '%s\n' "$CHANGED_FILES" | grep -c . || true)
  if [[ "$CHANGED_COUNT" -gt 0 ]]; then
    check_pass "$CHANGED_COUNT file(s) changed vs diff base"
    gray "  (first 20)"
    # `head` closes the pipe early; with `set -o pipefail` the upstream
    # `echo` would exit 141 (SIGPIPE) and `set -e` would kill the script.
    # Buffer the truncated list so the pipe always completes cleanly even
    # on branches with hundreds of changed files.
    FIRST_20=$(printf '%s\n' "$CHANGED_FILES" | awk 'NR <= 20')
    printf '%s\n' "$FIRST_20" | sed 's/^/    /'
  else
    check_fail "no files changed vs diff base — slice cannot be implemented with zero diff"
  fi
else
  gray "  diff base '$DIFF_BASE' not found locally; skipping diff check"
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
      # status.json files legitimately contain words like "deferred" as state
      # values; they are governance files, not source code dark-code markers.
      *.md|docs/*|*.lock|*.snap|release-verify.sh|*/status.json) continue ;;
    esac
    # Only scan lines this slice ADDED, not the entire file. A long-lived
    # integration branch carries hundreds of pre-existing markers in
    # surrounding code that the slice is not responsible for; scanning
    # the whole file would always FAIL on a big-bang release.
    if matches=$(git diff -U0 "$DIFF_BASE" -- "$f" 2>/dev/null \
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

  # Rule 2 (No Silent Deferrals): a "Not delivered" entry must carry a REAL
  # tracking reference — a filed issue #<number>, a release/punch-list id — not
  # a placeholder. An un-filed `#TBD` is the single most common Gate-5 verifier
  # rejection (2026-06-12: S04-monthend-mtm-cron burned a full fresh-context
  # verifier round on `#TBD (issue to be filed)`). Catching it in this cheap
  # first pass bounces it back to the implementer — which can `gh issue create`
  # and cite the real number — before the expensive verifier ever runs.
  # Section-scoped (same approach as the Test-results scan below) so a deferral
  # that legitimately quotes the word elsewhere can't false-positive.
  NOT_DELIVERED_SECTION=$(sed -n '/^## Not delivered/,/^## /p' "$PROOF_FILE" 2>/dev/null || true)
  PLACEHOLDER_TRACKING_RE='#TBD|#NNN+|#XXX|#TODO|#<|\bto be filed\b|\bissue to be\b|\bto be created\b|tracking:[[:space:]]*(TBD|TODO|pending|none|n/?a)'
  if [[ -n "$NOT_DELIVERED_SECTION" ]] && printf '%s\n' "$NOT_DELIVERED_SECTION" | grep -qiE "$PLACEHOLDER_TRACKING_RE" 2>/dev/null; then
    check_fail "proof.md 'Not delivered' uses a placeholder tracking ref (Rule 2 needs a real issue link — file it with 'gh issue create' and cite #<number>)"
    printf '%s\n' "$NOT_DELIVERED_SECTION" | grep -inE "$PLACEHOLDER_TRACKING_RE" 2>/dev/null | head -3 | while IFS= read -r _l; do gray "      ↳ $_l"; done
  else
    check_pass "proof.md 'Not delivered' deferrals carry non-placeholder tracking refs"
  fi

  # Files-changed diff-base cross-check.
  # The verifier diffs against status.json start_commit — NOT main, NOT the
  # version branch. Using main as the base (as the old template said) inflates
  # the diff with the whole project history; using release/vX.Y.Z inflates it
  # with every prior track. Only start_commit gives the correct per-slice scope.
  # Forward-merge commits from release-wt between start_commit and HEAD will
  # add harness/planner files to the diff — they MUST appear in proof.md
  # "Files changed" and each needs a brief "Divergence" entry.
  # A count mismatch of >= 5 is a strong signal proof.md used the wrong base.
  if [[ -n "$START_COMMIT" ]] && git rev-parse --verify "$START_COMMIT" >/dev/null 2>&1; then
    FILES_CHANGED_SECTION=$(sed -n '/^## Files changed/,/^## /p' "$PROOF_FILE" 2>/dev/null || true)
    PROOF_FILE_COUNT=$(printf '%s\n' "$FILES_CHANGED_SECTION" \
      | grep -cE '^[a-zA-Z_./][a-zA-Z0-9_./-]+$' 2>/dev/null || true)
    ACTUAL_DIFF_COUNT=$(git diff --name-only "$START_COMMIT" -- 2>/dev/null | grep -c . || true)
    COUNT_DELTA=$(( ACTUAL_DIFF_COUNT - PROOF_FILE_COUNT ))
    if [[ "$COUNT_DELTA" -lt 0 ]]; then COUNT_DELTA=$(( -COUNT_DELTA )); fi
    if [[ "$PROOF_FILE_COUNT" -gt 0 && "$COUNT_DELTA" -ge 5 ]]; then
      check_fail "proof.md 'Files changed' lists ~$PROOF_FILE_COUNT files but 'git diff --name-only $START_COMMIT' has $ACTUAL_DIFF_COUNT — wrong diff base (probably 'main' or manual filter). Re-run: git diff --name-only $START_COMMIT and paste verbatim; document forward-merge artifacts in Divergence from plan"
    elif [[ "$PROOF_FILE_COUNT" -gt 0 ]]; then
      check_pass "proof.md 'Files changed' count (~$PROOF_FILE_COUNT) consistent with diff vs start_commit ($ACTUAL_DIFF_COUNT)"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Check 5.5: spec.md frontmatter is strict-YAML safe
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
# Check 6: proof.md Test results section — Jest/Vitest only, no Playwright
# ---------------------------------------------------------------------------
#
# Slice-level verification uses Jest/Vitest scoped to the slice's touchpoints.
# Playwright runs only when the slice opts in via `playwright-screenshot`
# (or an equivalent Required tests declaration naming both Playwright and
# screenshots) in spec.md. If the Test results section of proof.md contains
# Playwright runner output AND the spec does NOT declare the opt-in, this is
# a discipline violation — the verifier ran an out-of-scope tool.
#
# This check uses section-scoped extraction to avoid false-positives from
# proof.md sections that quote a prior Playwright run verbatim (e.g. a
# "Not delivered" entry that shows old output). Only the "## Test results"
# section is scanned.

section "Test results section scope"

PLAYWRIGHT_MARKERS='Running [0-9]+ test[s]? using|npx playwright|@playwright/test|playwright\.config\.'

if [[ -f "$PROOF_FILE" ]]; then
  # Extract only the "## Test results" section (up to the next ## heading).
  TEST_RESULTS_SECTION=$(sed -n '/^## Test results/,/^## /p' "$PROOF_FILE" 2>/dev/null || true)

  if [[ -z "$TEST_RESULTS_SECTION" ]]; then
    check_fail "proof.md has no '## Test results' section content (section missing or empty)"
  else
    # Check for Playwright opt-in in spec.md. Supports the canonical keyword
    # `playwright-screenshot` or a Required-tests declaration that names both
    # Playwright and screenshot reachability (e.g. "Playwright spec + screenshots").
    PLAYWRIGHT_OPTIN=false
    if [[ -f "$SLICE_DIR/spec.md" ]]; then
      REQUIRED_TESTS_SECTION=$(sed -n '/^## Required tests/,/^## /p' "$SLICE_DIR/spec.md" 2>/dev/null || true)
      if printf '%s\n' "$REQUIRED_TESTS_SECTION" | grep -qE 'playwright-screenshot' 2>/dev/null; then
        PLAYWRIGHT_OPTIN=true
      elif printf '%s\n' "$REQUIRED_TESTS_SECTION" | grep -qiE 'playwright' 2>/dev/null && \
           printf '%s\n' "$REQUIRED_TESTS_SECTION" | grep -qiE 'screenshot' 2>/dev/null; then
        PLAYWRIGHT_OPTIN=true
      fi
    fi

    if printf '%s\n' "$TEST_RESULTS_SECTION" | grep -qE "$PLAYWRIGHT_MARKERS" 2>/dev/null; then
      if [[ "$PLAYWRIGHT_OPTIN" == "true" ]]; then
        check_pass "Test results section contains Playwright output (playwright-screenshot opt-in declared in spec.md)"
      else
        check_fail "Test results section contains Playwright runner output but spec.md does not declare a Playwright-screenshot opt-in — slice-level verification must use Jest/Vitest only"
        gray "  (Playwright output found in '## Test results' section of proof.md)"
        gray "  To use Playwright at slice level, add 'playwright-screenshot' (or a Required tests declaration with both 'Playwright' and 'screenshot') to spec.md 'Required tests' section."
      fi
    else
      check_pass "Test results section contains no Playwright runner output (Jest/Vitest scope confirmed)"
    fi
  fi
else
  gray "  proof.md not found; skipping Test results scope check"
fi

# ---------------------------------------------------------------------------
# Check 7: E2E spec assertions (playwright-screenshot opt-in slices only)
# ---------------------------------------------------------------------------
#
# When a slice opts in to Playwright, the spec file must contain:
#   (a) at least one expect() call — zero assertions = test exercises UI, proves nothing
#   (b) at least one output-checking matcher beyond toHaveValue — specs that only
#       assert form-field state ("input has value 42") are not proof of rendered output
#
# Spec file discovery: look in planned_files and actual_files for
# tests/e2e/**/*.spec.ts; if none declared, fall back to on-disk specs whose
# name starts with the lower-cased slice number prefix in either
# tests/e2e/ or tests/e2e/release/ (e.g. S15-* -> s15*.spec.ts).

if [[ "$PLAYWRIGHT_OPTIN" == "true" ]]; then
  section "E2E spec assertions"

  # Derive slice number prefix: S15-lifestage-... -> s15
  SLICE_PREFIX=$(printf '%s' "$SLICE_ID" | sed 's/^\([Ss][0-9]*\).*/\1/' | tr '[:upper:]' '[:lower:]')

  # Collect candidate spec files: declared files first, then fallback by prefix.
  E2E_SPECS=()
  if [[ -f "$STATUS_FILE" ]]; then
    while IFS= read -r pf; do
      [[ "$pf" == tests/e2e/*.spec.ts ]] || [[ "$pf" == tests/e2e/**/*.spec.ts ]] && \
        [[ -f "$pf" ]] && E2E_SPECS+=("$pf")
    done < <(jq -r '.planned_files[]?, .actual_files[]?' "$STATUS_FILE" 2>/dev/null)
  fi
  if [[ ${#E2E_SPECS[@]} -eq 0 ]]; then
    while IFS= read -r f; do
      [[ -n "$f" ]] && E2E_SPECS+=("$f")
    done < <(find tests/e2e -maxdepth 1 -name "${SLICE_PREFIX}*.spec.ts" 2>/dev/null)
    while IFS= read -r f; do
      [[ -n "$f" ]] && E2E_SPECS+=("$f")
    done < <(find tests/e2e/release -maxdepth 1 -name "${SLICE_PREFIX}*.spec.ts" 2>/dev/null)
  fi

  # Deduplicate in case a spec is listed in both planned_files and actual_files.
  if [[ ${#E2E_SPECS[@]} -gt 0 ]]; then
    mapfile -t E2E_SPECS < <(printf '%s\n' "${E2E_SPECS[@]}" | grep -v '^$' | sort -u)
  fi
  if [[ ${#E2E_SPECS[@]} -eq 0 && -d "tests/e2e/release" ]]; then
    while IFS= read -r f; do
      E2E_SPECS+=("$f")
    done < <(find tests/e2e/release -maxdepth 1 -name "${SLICE_PREFIX}*.spec.ts" 2>/dev/null)
  fi

  if [[ ${#E2E_SPECS[@]} -eq 0 ]]; then
    check_fail "playwright-screenshot opted in but no E2E spec file found (not in planned_files and no tests/e2e/release/${SLICE_PREFIX}*.spec.ts on disk)"
    gray "  Declare the spec file in status.json planned_files or create tests/e2e/release/${SLICE_PREFIX}-<name>.spec.ts"
  else
    for spec_file in "${E2E_SPECS[@]}"; do
      gray "  checking: $spec_file"

      # (a) At least one expect() call.
      expect_count=$(grep -c 'expect(' "$spec_file" 2>/dev/null || echo 0)
      if [[ "$expect_count" -eq 0 ]]; then
        check_fail "$spec_file: no expect() calls — spec exercises the UI but asserts nothing"
        gray "  Add at least one expect() on a rendered output element (FIRE age, net worth, projection text)"
      else
        check_pass "$spec_file: ${expect_count} expect() call(s) present"

        # (b) At least one output-checking matcher (not only toHaveValue form assertions).
        OUTPUT_MATCHERS='toBeVisible|toContainText|toHaveText|toMatch|toBeGreaterThan|toEqual|toHaveCount|toHaveURL'
        output_count=$(grep -cE "$OUTPUT_MATCHERS" "$spec_file" 2>/dev/null || echo 0)
        if [[ "$output_count" -eq 0 ]]; then
          check_fail "$spec_file: all expect() calls use form-state matchers (toHaveValue/toBeChecked) — none assert rendered output"
          gray "  At least one assertion must target a rendered output element, e.g.:"
          gray "    expect(page.getByTestId('fire-age')).toContainText('52')"
          gray "    expect(page.locator('.net-worth')).toBeVisible()"
        else
          check_pass "$spec_file: ${output_count} output-checking matcher(s) (${OUTPUT_MATCHERS//|/, })"
        fi
      fi
    done
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

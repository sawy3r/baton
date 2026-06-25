#!/usr/bin/env bash
#
# release-regression.sh — post-merge regression gate.
#
# After all tracks have merged into release-wt, run the full test suite
# against the merged worktree. Catches semantic regressions where two
# independently-verified tracks break when combined.
#
# Usage: release-regression.sh --release <name> [--worktree <path>] [--suite all|go|ts]
#   Exits 0 when all tests pass.
#   Exits 1 when any test fails or golden fixtures diverge.

set -euo pipefail

RELEASE_NAME=""
WORKTREE=""
SUITE="all"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) RELEASE_NAME="${2:-}"; shift 2 ;;
    --worktree) WORKTREE="${2:-}"; shift 2 ;;
    --suite)    SUITE="${2:-all}"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$RELEASE_NAME" ]]; then
  echo "usage: release-regression.sh --release <name> [--worktree <path>] [--suite all|go|ts]" >&2
  exit 2
fi

GIT_CMD="git"
[[ -n "$WORKTREE" ]] && GIT_CMD="git -C $WORKTREE"

green()  { printf '\033[32m%s\033[0m' "$*"; }
red()    { printf '\033[31m%s\033[0m' "$*"; }
yellow() { printf '\033[33m%s\033[0m' "$*"; }
bold()   { printf '\033[1m%s\033[0m'  "$*"; }
gray()   { printf '\033[90m%s\033[0m'  "$*"; }

echo
bold "POST-MERGE REGRESSION — $RELEASE_NAME"
echo

FAILURES=0
declare -a failure_msgs=()

run_in_wt() {
  if [[ -n "$WORKTREE" ]]; then
    cd "$WORKTREE" && eval "$1" 2>&1
  else
    eval "$1" 2>&1
  fi
}

# ── Go tests ──
if [[ "$SUITE" == "all" || "$SUITE" == "go" ]]; then
  gray "Running Go tests..."
  if go_out=$(run_in_wt "cd go && go test -v -count=1 ./..." 2>&1); then
    green "Go tests: PASS"
  else
    red "Go tests: FAIL"
    FAILURES=$((FAILURES + 1))
    failure_msgs+=("Go test suite failed. Last 20 lines:\n$(echo "$go_out" | tail -20)")
  fi
  echo
fi

# ── TypeScript tests ──
if [[ "$SUITE" == "all" || "$SUITE" == "ts" ]]; then
  gray "Running TypeScript tests..."
  if ts_out=$(run_in_wt "pnpm test 2>&1" 2>&1); then
    green "TypeScript tests: PASS"
  else
    red "TypeScript tests: FAIL"
    FAILURES=$((FAILURES + 1))
    failure_msgs+=("TypeScript test suite failed. Last 20 lines:\n$(echo "$ts_out" | tail -20)")
  fi
  echo
fi

# ── Golden fixtures (Go scenario tests) ──
if [[ "$SUITE" == "all" || "$SUITE" == "go" ]]; then
  gray "Checking golden fixture scenarios..."
  if scenario_out=$(run_in_wt "cd go && go test -v -run 'TestScenario|TestGolden|TestFixture' ./pkg/tools/fire/..." 2>&1); then
    green "Golden fixtures: PASS"
  else
    red "Golden fixtures: DIVERGED"
    FAILURES=$((FAILURES + 1))
    failure_msgs+=("Golden fixture scenarios diverged:\n$(echo "$scenario_out" | tail -20)")
  fi
  echo
fi

# ── Verdict ──
if [[ $FAILURES -eq 0 ]]; then
  green "REGRESSION GATE PASSED"
  echo
  echo "All test suites and golden fixtures passed against the merged release-wt."
  echo
  exit 0
else
  red "REGRESSION GATE FAILED — $FAILURES suite(s)"
  echo
  for msg in "${failure_msgs[@]}"; do
    echo -e "$msg"
    echo "---"
  done
  echo
  red "MERGED STATE IS NOT CLEAN"
  echo
  echo "Two independently-verified tracks may have a semantic conflict."
  echo "Investigate failures before merging to the integration branch."
  echo
  exit 1
fi

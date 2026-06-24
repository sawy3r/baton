#!/usr/bin/env bash
#
# release-mock-check.sh — no-mock boundary enforcement (Rule 10).
#
# Scans test files and test configuration for undeclared mock boundaries.
# Rule 10: a journey walked over a mocked boundary proves nothing. An
# undeclared mock at a validated boundary fails the gate closed.
#
# A mock is declared when the test file or its config explicitly
# acknowledges it (via comment annotation, config flag, or the slice's
# open_deferrals entry). Undeclared mocks are flagged.
#
# Usage: release-mock-check.sh --slice <slice-id> --release <name> [--worktree <path>]
#   Exits 0 when all mock boundaries are properly declared.
#   Exits 1 with undeclared mocks enumerated.

set -euo pipefail

SLICE_ID=""
RELEASE_NAME=""
WORKTREE=""
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose) VERBOSE=true; shift ;;
    --slice)   SLICE_ID="${2:-}"; shift 2 ;;
    --release) RELEASE_NAME="${2:-}"; shift 2 ;;
    --worktree) WORKTREE="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$SLICE_ID" || -z "$RELEASE_NAME" ]]; then
  echo "usage: release-mock-check.sh --slice <slice-id> --release <name> [--worktree <path>]" >&2
  exit 2
fi

GIT_CMD="git"
[[ -n "$WORKTREE" ]] && GIT_CMD="git -C $WORKTREE"
RELEASE_DIR="${BATON_RELEASE_DIR:-docs/release}"
STATUS="${RELEASE_DIR}/${RELEASE_NAME}/${SLICE_ID}/status.json"

green()  { printf '\033[32m%s\033[0m' "$*"; }
red()    { printf '\033[31m%s\033[0m' "$*"; }
yellow() { printf '\033[33m%s\033[0m' "$*"; }
bold()   { printf '\033[1m%s\033[0m'  "$*"; }
gray()   { printf '\033[90m%s\033[0m'  "$*"; }

# ── load declared deferrals from status.json ──
declare -a declared_mocks=()
if [[ -f "$STATUS" ]]; then
  while IFS= read -r item; do
    declared_mocks+=("$item")
  done < <(jq -r '.open_deferrals[]? | select(.why | test("mock|fixture|seed|stub|fake"; "i")) | .item // ""' "$STATUS" 2>/dev/null || true)
fi

# ── get diff files ──
START_COMMIT=$(jq -r '.start_commit // ""' "$STATUS" 2>/dev/null || echo "")
if [[ -z "$START_COMMIT" || "$START_COMMIT" == "null" ]]; then
  echo "release-mock-check: no start_commit in status.json" >&2
  exit 2
fi

mapfile -t changed_files < <($GIT_CMD diff --name-only "$START_COMMIT"..HEAD 2>/dev/null || true)

echo
bold "MOCK BOUNDARY CHECK — $SLICE_ID"
echo

# ── patterns that indicate mock usage ──
MOCK_PATTERNS=(
  "mock|stub|fake|dummy|fixture|seed|test.*data|test.*helper"
  "newMock|mockStore|mockDB|mockClient|mockServer"
  "MemoryStore|InMemory|FakeDB|TestDB|TestStore"
  "sqlmock|pgxmock|gomock|testify.*mock"
  "vi\\.fn\\(|jest\\.fn\\(|jest\\.mock\\(|vi\\.mock\\("
  "nock\\(|msw\\.|miragejs|json-server"
  "testcontainers|docker.*test|compose.*test"
)

# ── patterns that indicate real infrastructure ──
REAL_INFRA_PATTERNS=(
  "localhost:(5432|6379|27017|9092|9200)"  # real DB/Redis/etc ports
  "DATABASE_URL|DB_HOST|REDIS_URL|KAFKA_BROKER"
  "NEON_URL|SUPABASE_URL|AUTH0_DOMAIN|STRIPE_KEY"
  "production|prod-|live-]"
)

# ── Python scan ──
result=$(python3 <<PYEOF
import sys, json, re, os

worktree = "$WORKTREE" if "$WORKTREE" else "."
changed_files = $(python3 -c "import json; print(json.dumps(${changed_files[@]@Q}))")
declared_mocks = $(python3 -c "import json; print(json.dumps(${declared_mocks[@]@Q}))")

mock_re = re.compile(r'mock|stub|fake|dummy|fixture|seed.*data|inmemory|test.*db|sqlmock|gomock|jest\.fn|vi\.fn|testcontainers', re.IGNORECASE)
real_infra_re = re.compile(r'localhost:(5432|6379|27017|9092|9200)|DATABASE_URL|DB_HOST|REDIS_URL|AUTH0_DOMAIN|STRIPE_KEY|NEON_URL|production', re.IGNORECASE)
declared_re = re.compile(r'@mock-boundary|mock-boundary:|declared.mock|NO_MOCK_BOUNDARY', re.IGNORECASE)

# Only scan test files and config
test_patterns = ['.test.', '_test.', 'spec.', '.spec.', '__tests__/', 'tests/', '.env.test', 'vitest.config', 'jest.config']
violations = []

for cf in changed_files:
    # Determine if this is a test file or config
    is_test = any(pat in cf for pat in test_patterns) or cf.endswith(('.env.test', '.env.example', 'docker-compose.test.yml', 'docker-compose.test.yaml'))
    if not is_test:
        continue

    path = os.path.join(worktree, cf) if worktree != "." else cf
    if not os.path.exists(path):
        continue

    try:
        with open(path) as f:
            content = f.read()
    except:
        continue

    # Check if file uses mocks
    has_mock = bool(mock_re.search(content))
    # Check if file references real infra
    has_real = bool(real_infra_re.search(content))
    # Check if mocks are declared (annotation in file or in deferrals)
    has_declared = bool(declared_re.search(content)) or any(
        dm.lower() in content.lower() for dm in declared_mocks
    )

    if has_mock and not has_declared:
        violations.append({
            "file": cf,
            "issue": "undeclared-mock",
            "msg": f"Test file {cf} uses mocks/stubs/fixtures without declaring the mock boundary.",
        })

    if has_real and has_mock and not has_declared:
        violations.append({
            "file": cf,
            "issue": "real-infra-with-mock",
            "msg": f"Test file {cf} references real infrastructure AND uses mocks — this is a mock boundary that must be declared.",
        })

changed_test_files = [cf for cf in changed_files if any(pat in cf for pat in test_patterns)]
summary = {
    "test_files_scanned": len(changed_test_files),
    "violations": len(violations),
    "verdict": "PASS" if not violations else "FAIL",
}

print(json.dumps({"summary": summary, "violations": violations}))
PYEOF
)

summary_json=$(echo "$result" | jq '.summary')
violations_json=$(echo "$result" | jq '.violations')

files_scanned=$(echo "$summary_json" | jq -r '.test_files_scanned')
violation_count=$(echo "$summary_json" | jq -r '.violations')
verdict=$(echo "$summary_json" | jq -r '.verdict')

gray "test files scanned: $files_scanned"

if [[ "$verdict" == "PASS" ]]; then
    green "PASS — no undeclared mock boundaries"
    echo
    exit 0
fi

echo
red "$violation_count undeclared mock boundary violation(s)"
echo

i=1
while IFS=$'\t' read -r file msg; do
    printf "  %d. " "$i"
    red "$msg"
    gray "    $file"
    ((i++))
done < <(echo "$violations_json" | jq -r '.[] | "\(.file)\t\(.msg)"')

echo
echo "Declare mock boundaries by one of:"
echo "  1. Add @mock-boundary comment in the test file"
echo "  2. Add to status.json open_deferrals with why/tracking/acknowledgement"
echo "  3. Suppress via architecture-overrides.json for this release"
echo
exit 1

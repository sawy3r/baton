#!/usr/bin/env bash
#
# release-coverage.sh — mechanical spec-AC → test traceability.
#
# For a given slice, extracts every acceptance check from spec.md and
# traces it to a test function/assertion in the diff. Outputs a machine-
# verifiable coverage map that closes the last link in the evidence chain:
# intake need → slice (covers_needs) → AC (spec.md) → test (diff) → proof.
#
# Usage: release-coverage.sh --slice <slice-id> --release <name> [--worktree <path>]
#   Exits 0 when every AC has at least one matching test.
#   Exits 1 with uncovered ACs enumerated.

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
  echo "usage: release-coverage.sh --slice <slice-id> --release <name> [--worktree <path>]" >&2
  exit 2
fi

GIT_CMD="git"
[[ -n "$WORKTREE" ]] && GIT_CMD="git -C $WORKTREE"
RELEASE_DIR="${BATON_RELEASE_DIR:-docs/release}"
SPEC="${RELEASE_DIR}/${RELEASE_NAME}/${SLICE_ID}/spec.md"
STATUS="${RELEASE_DIR}/${RELEASE_NAME}/${SLICE_ID}/status.json"

green()  { printf '\033[32m%s\033[0m' "$*"; }
red()    { printf '\033[31m%s\033[0m' "$*"; }
yellow() { printf '\033[33m%s\033[0m' "$*"; }
bold()   { printf '\033[1m%s\033[0m'  "$*"; }
gray()   { printf '\033[90m%s\033[0m'  "$*"; }

if [[ ! -f "$SPEC" ]]; then
  echo "release-coverage: spec not found at $SPEC" >&2
  exit 2
fi

# ── extract ACs from spec.md ──
mapfile -t ac_lines < <(grep -n '^\s*- \[[ x]\]' "$SPEC" 2>/dev/null || true)
declare -a ac_texts=()
declare -a ac_numbers=()
i=1
for line in "${ac_lines[@]}"; do
  lineno="${line%%:*}"
  text="${line#*]}"
  text="${text#"${text%%[![:space:]]*}"}"
  ac_texts+=("$text")
  ac_numbers+=("AC-$i")
  ((i++))
done

if [[ ${#ac_texts[@]} -eq 0 ]]; then
  echo "release-coverage: no acceptance checks found in $SPEC" >&2
  exit 2
fi

# ── get start_commit for diff scope ──
START_COMMIT=""
if [[ -f "$STATUS" ]]; then
  START_COMMIT=$(jq -r '.start_commit // ""' "$STATUS" 2>/dev/null || echo "")
fi
if [[ -z "$START_COMMIT" || "$START_COMMIT" == "null" ]]; then
  echo "release-coverage: no start_commit in status.json — cannot determine diff scope" >&2
  exit 2
fi

# ── Python: match ACs to test functions in diff ──
result=$(python3 <<PYEOF
import sys, json, re, os, subprocess

worktree = "$WORKTREE" if "$WORKTREE" else "."
git_cmd = f"git -C {worktree}" if worktree != "." else "git"
start_commit = "$START_COMMIT"
ac_texts = $(python3 -c "import json; print(json.dumps(${ac_texts[@]@Q}))")
ac_numbers = $(python3 -c "import json; print(json.dumps(${ac_numbers[@]@Q}))")

# Get diff files
try:
    output = subprocess.check_output(
        f"{git_cmd} diff --name-only {start_commit}..HEAD",
        shell=True, text=True, cwd=worktree
    )
    changed_files = [f.strip() for f in output.splitlines() if f.strip()]
except:
    changed_files = []

# Only scan test files
test_patterns = ['.test.', '_test.', 'spec.', '.spec.', '__tests__/', 'tests/']
test_files = []
for cf in changed_files:
    if not cf.endswith(('.go', '.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.rs')):
        continue
    if any(pat in cf for pat in test_patterns):
        test_files.append(cf)

# Extract test function names from test files
test_functions = {}  # function_name -> (file, line)
for tf in test_files:
    path = os.path.join(worktree, tf) if worktree != "." else tf
    if not os.path.exists(path):
        continue
    try:
        with open(path) as f:
            content = f.read()
    except:
        continue

    lines = content.splitlines()
    for li, line in enumerate(lines, 1):
        # Go: func TestXxx(t *testing.T)
        m = re.match(r'func\s+(Test\w+)\s*\(', line)
        if m:
            test_functions[m.group(1)] = (tf, li)
        # TypeScript: it('...', () => {}) or test('...', () => {})
        m = re.match(r"^\s*(it|test)\s*\(\s*['\"](.+?)['\"]", line)
        if m:
            name = f"{m.group(1)}: {m.group(2)[:80]}"
            test_functions[name] = (tf, li)
        # TypeScript: describe('...', () => {})
        m = re.match(r"^\s*describe\s*\(\s*['\"](.+?)['\"]", line)
        if m:
            test_functions[f"describe: {m.group(1)[:80]}"] = (tf, li)
        # Pytest: def test_xxx():
        m = re.match(r'\s*def\s+(test_\w+)\s*\(', line)
        if m:
            test_functions[m.group(1)] = (tf, li)

# For each AC, find test functions with keyword overlap
def extract_keywords(text):
    """Extract significant keywords from AC text for matching."""
    # Remove common stop words and punctuation
    stop = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
            'could', 'should', 'may', 'might', 'must', 'can', 'and', 'or', 'not',
            'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'into',
            'through', 'during', 'before', 'after', 'above', 'below', 'between'}
    words = re.findall(r'[a-zA-Z_][a-zA-Z0-9_]*', text.lower())
    return [w for w in words if w not in stop and len(w) > 2]

coverage = []
for idx, (ac_text, ac_num) in enumerate(zip(ac_texts, ac_numbers)):
    keywords = extract_keywords(ac_text)
    matches = []

    for func_name, (file, line) in test_functions.items():
        func_lower = func_name.lower()
        # Count keyword matches
        score = sum(1 for kw in keywords if kw in func_lower)
        if score > 0:
            matches.append({
                "function": func_name,
                "file": file,
                "line": line,
                "score": score,
            })

    # Sort by score desc
    matches.sort(key=lambda x: x["score"], reverse=True)
    # Take top match if score >= 2, or only match
    top = matches[0] if matches else None
    if top and (top["score"] >= 2 or len(matches) == 1):
        coverage.append({
            "ac": ac_num,
            "ac_text": ac_text[:120],
            "test": top["function"],
            "test_file": top["file"],
            "test_line": top["line"],
            "covered": True,
        })
    else:
        coverage.append({
            "ac": ac_num,
            "ac_text": ac_text[:120],
            "test": None,
            "test_file": None,
            "test_line": None,
            "covered": False,
            "matches_considered": [m["function"] for m in matches[:3]],
        })

covered_count = sum(1 for c in coverage if c["covered"])
total_count = len(coverage)
verdict = "PASS" if covered_count == total_count else "FAIL"

print(json.dumps({
    "summary": {
        "total_acs": total_count,
        "covered": covered_count,
        "uncovered": total_count - covered_count,
        "verdict": verdict,
    },
    "coverage": coverage,
}))
PYEOF
)

summary_json=$(echo "$result" | jq '.summary')
coverage_json=$(echo "$result" | jq '.coverage')

total_acs=$(echo "$summary_json" | jq -r '.total_acs')
covered=$(echo "$summary_json" | jq -r '.covered')
uncovered=$(echo "$summary_json" | jq -r '.uncovered')
verdict=$(echo "$summary_json" | jq -r '.verdict')

echo
bold "COVERAGE TRACE — $SLICE_ID"
echo
gray "ACs: $total_acs  covered: $covered  uncovered: $uncovered"
echo

if [[ "$verdict" == "PASS" ]]; then
    green "PASS — every acceptance check has a matching test"
    echo
    if $VERBOSE; then
        while IFS=$'\t' read -r ac test file line; do
            printf "  %-8s → %-40s %s:%s\n" "$ac" "$test" "$file" "$line"
        done < <(echo "$coverage_json" | jq -r '.[] | "\(.ac)\t\(.test)\t\(.test_file)\t\(.test_line)"')
    fi
    echo
else
    red "FAIL — $uncovered acceptance check(s) have no matching test"
    echo
    while IFS=$'\t' read -r ac text candidate; do
        printf "  %s: " "$ac"
        red "uncovered"
        echo "    $text"
        [[ -n "$candidate" && "$candidate" != "null" ]] && gray "    candidates considered: $candidate"
    done < <(echo "$coverage_json" | jq -r '.[] | select(.covered == false) | "\(.ac)\t\(.ac_text)\t\(.matches_considered // "")"')
    echo
    red "INCOMPLETE COVERAGE"
    echo
    echo "Write a test that exercises each uncovered AC, or add a NOTE: escape"
    echo "to the AC in spec.md if it is intentionally not test-covered."
    echo
fi

# Print machine-readable coverage map
if $VERBOSE; then
    echo "--- COVERAGE MAP (machine-readable) ---"
    echo "$coverage_json" | jq '.'
fi

[[ "$verdict" == "PASS" ]] && exit 0 || exit 1

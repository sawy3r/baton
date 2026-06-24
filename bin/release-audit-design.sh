#!/usr/bin/env bash
#
# release-audit-design.sh — Rule 9 mechanical design-conformance gate (Layer 1).
#
# Scans a slice's diff for hardcoded colour values (hex, rgb, rgba, hsl)
# that are not declared in the project's design token set. Exits 0 on
# clean pass, 1 on violations with file:line details.
#
# Runs as a verifier gate — the implementer conforms, the verifier checks.
# Escape hatch: per-slice design-allowlist.json or open_deferrals entry
# with explicit human/captain acknowledgement.
#
# Usage: release-audit-design.sh [--slice <slice-id>] [--release <name>] [--worktree <path>]
#   Defaults to scanning the current working tree's diff.
#   --slice: names the slice for allowlist lookup.
#   --release: release name for docs path resolution.
#   --worktree: path to track worktree for git operations and file reads.

set -euo pipefail

VERBOSE=false
SLICE_ID=""
RELEASE_NAME=""
WORKTREE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose) VERBOSE=true; shift ;;
    --slice)   SLICE_ID="${2:-}"; shift 2 ;;
    --release) RELEASE_NAME="${2:-}"; shift 2 ;;
    --worktree) WORKTREE="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

GIT_CMD="git"
[[ -n "$WORKTREE" ]] && GIT_CMD="git -C $WORKTREE"
RELEASE_DIR="${BATON_RELEASE_DIR:-docs/release}"

green()  { printf '\033[32m%s\033[0m' "$*"; }
red()    { printf '\033[31m%s\033[0m' "$*"; }
yellow() { printf '\033[33m%s\033[0m' "$*"; }
bold()   { printf '\033[1m%s\033[0m'  "$*"; }
gray()   { printf '\033[90m%s\033[0m'  "$*"; }

# ── project-level design config (optional) ──
DESIGN_CONFIG="docs/baton/design-fidelity.json"
PROJECT_UI_BEARING=false
TOKEN_FILE=""

if [[ -f "$DESIGN_CONFIG" ]]; then
  if command -v jq >/dev/null 2>&1; then
    PROJECT_UI_BEARING=$(jq -r '.ui_bearing // false' "$DESIGN_CONFIG" 2>/dev/null || echo "false")
    TOKEN_FILE=$(jq -r '.design_system.token_source // ""' "$DESIGN_CONFIG" 2>/dev/null || echo "")
  fi
fi

# ── per-slice allowlist (escape hatch) ──
ALLOWLIST=""
declare -A allowlist_map

if [[ -n "$SLICE_ID" && -n "$RELEASE_NAME" ]]; then
  ALLOWLIST="${RELEASE_DIR}/${RELEASE_NAME}/${SLICE_ID}/design-allowlist.json"
  if [[ -f "$ALLOWLIST" ]]; then
    while IFS=$'\t' read -r pattern reason; do
      allowlist_map["$pattern"]="$reason"
    done < <(jq -r '.allowlist[]? | "\(.pattern)\t\(.reason)"' "$ALLOWLIST" 2>/dev/null)
  fi
fi

# ── extract allowed tokens from project config ──
declare -A allowed_hex
if [[ -n "$TOKEN_FILE" && -f "$TOKEN_FILE" ]]; then
  while IFS= read -r hex_val; do
    [[ -n "$hex_val" ]] && allowed_hex["${hex_val,,}"]=1
  done < <(jq -r '.. | select(type == "string" and test("^#[0-9a-fA-F]{3,8}$"))?' "$TOKEN_FILE" 2>/dev/null || true)
fi

# ── colour detection patterns ──
# Matches: #RGB #RRGGBB #RRGGBBAA rgb(r,g,b) rgba(r,g,b,a) hsl(h,s,l) hsla(h,s,l,a)
HEX_PATTERN='#[0-9a-fA-F]{3,8}'
RGB_PATTERN='rgba?\s*\([^)]+\)'
HSL_PATTERN='hsla?\s*\([^)]+\)'

COLOUR_SCAN=$(cat <<'PYEOF'
import sys, re, json, os

worktree = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else "."
git_cmd = f"git -C {worktree}" if worktree != "." else "git"
allowlist_map = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
allowed_hex = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
ui_bearing = sys.argv[4] if len(sys.argv) > 4 else "false"

# Only scan UI files
import subprocess
try:
    output = subprocess.check_output(
        f"{git_cmd} diff --name-only", shell=True, text=True, cwd=worktree
    )
    changed_files = [f.strip() for f in output.splitlines() if f.strip()]
except:
    changed_files = []

ui_extensions = {'.tsx', '.ts', '.jsx', '.js', '.css', '.scss', '.less', '.html', '.vue', '.svelte'}
violations = []

hex_re = re.compile(r'#[0-9a-fA-F]{3,8}')
rgb_re = re.compile(r'rgba?\s*\([^)]+\)')
hsl_re = re.compile(r'hsla?\s*\([^)]+\)')

for f in changed_files:
    ext = os.path.splitext(f)[1].lower()
    if ext not in ui_extensions:
        continue
    # Skip test files
    if any(pat in f for pat in ['.test.', '.spec.', '__tests__/', 'tests/', 'test/']):
        continue
    path = os.path.join(worktree, f) if worktree != "." else f
    if not os.path.exists(path):
        continue
    try:
        with open(path, 'r') as fh:
            lines = fh.readlines()
    except:
        continue

    for i, line in enumerate(lines, 1):
        stripped = line.strip()

        # Skip allowlisted lines
        line_key = f"{f}:{i}"
        if line_key in allowlist_map:
            continue

        # Skip comments, string literals in non-style contexts is harder
        # but skip obvious CSS-variable usage and design-token imports
        if 'var(--' in stripped or 'tw-' in stripped:
            continue

        # Scan for hex colours
        for m in hex_re.finditer(stripped):
            val = m.group().lower()
            # Skip allowlisted patterns (match against the hex value)
            if val in allowlist_map:
                continue
            # Skip if hex is 3 or 6 chars and in allowed tokens
            if len(val) in (4, 7, 9) and val in allowed_hex:
                continue
            # Skip common non-colour hex patterns (hashes, regex ranges)
            if re.search(r'[\'"`]' + re.escape(val), stripped) is None:
                continue
            violations.append({
                "file": f, "line": i,
                "kind": "hardcoded-colour-hex",
                "value": m.group(),
                "msg": f"Hardcoded hex colour {m.group()} — use design token or CSS variable instead."
            })

        # Scan for rgb/rgba
        for m in rgb_re.finditer(stripped):
            val = m.group()
            if val in allowlist_map:
                continue
            violations.append({
                "file": f, "line": i,
                "kind": "hardcoded-colour-rgb",
                "value": val,
                "msg": f"Hardcoded RGB colour {val} — use design token or CSS variable instead."
            })

        # Scan for hsl/hsla
        for m in hsl_re.finditer(stripped):
            val = m.group()
            if val in allowlist_map:
                continue
            violations.append({
                "file": f, "line": i,
                "kind": "hardcoded-colour-hsl",
                "value": val,
                "msg": f"Hardcoded HSL colour {val} — use design token or CSS variable instead."
            })

summary = {
    "ui_bearing": ui_bearing,
    "files_scanned": len([f for f in changed_files if os.path.splitext(f)[1].lower() in ui_extensions]),
    "violations": len(violations),
    "verdict": "PASS" if not violations else "FAIL",
}

print(json.dumps({"summary": summary, "violations": violations}))
PYEOF
)

# Pass allowlist as JSON
allowlist_json="{}"
if [[ -n "${!allowlist_map[*]}" ]]; then
  allowlist_json="{"
  first=true
  for pattern in "${!allowlist_map[@]}"; do
    reason="${allowlist_map[$pattern]}"
    $first || allowlist_json+=","
    allowlist_json+="\"$pattern\": \"$reason\""
    first=false
  done
  allowlist_json+="}"
fi

allowed_json="{}"
if [[ -n "${!allowed_hex[*]}" ]]; then
  allowed_json="{"
  first=true
  for hex_val in "${!allowed_hex[@]}"; do
    $first || allowed_json+=","
    allowed_json+="\"$hex_val\": 1"
    first=false
  done
  allowed_json+="}"
fi

if ! result="$(python3 -c "$COLOUR_SCAN" "$WORKTREE" "$allowlist_json" "$allowed_json" "$PROJECT_UI_BEARING" 2>&1)"; then
    echo "release-audit-design: Python scan failed:" >&2
    echo "$result" >&2
    exit 2
fi

summary_json=$(echo "$result" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['summary']))")
violations_json=$(echo "$result" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['violations']))")

files_scanned=$(echo "$summary_json" | jq -r '.files_scanned')
violation_count=$(echo "$summary_json" | jq -r '.violations')
verdict=$(echo "$summary_json" | jq -r '.verdict')

echo
bold "DESIGN CONFORMANCE AUDIT"
echo
gray "UI-bearing: $PROJECT_UI_BEARING  files scanned: $files_scanned"

if [[ "$verdict" == "PASS" ]]; then
    green "PASS — no hardcoded colour violations"
    echo
    exit 0
fi

echo
red "$violation_count hardcoded colour violation(s)"
echo

i=1
while IFS=$'\t' read -r file line value msg; do
    printf "  %d. " "$i"
    red "$msg"
    gray "    $file:$line — $value"
    ((i++))
done < <(echo "$violations_json" | jq -r '.[] | "\(.file)\t\(.line)\t\(.value)\t\(.msg)"')

echo
red "DESIGN NOT CONFORMANT"
echo
echo "Replace hardcoded colours with design tokens or CSS variables."
if [[ -n "$SLICE_ID" ]]; then
    echo "To accept a violation, add it to $ALLOWLIST with rationale."
    echo "Or declare in status.json open_deferrals with human/captain acknowledgement."
fi
echo
exit 1

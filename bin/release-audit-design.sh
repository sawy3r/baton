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

# ── architectural rule config ──
ARCH_CONFIG="docs/baton/architecture.json"
ARCH_RULES=""
ARCH_OVERRIDES=""
ARCH_HAS_RULES=false

if [[ -n "$RELEASE_NAME" && -f "${RELEASE_DIR}/${RELEASE_NAME}/architecture-overrides.json" ]]; then
  ARCH_OVERRIDES="${RELEASE_DIR}/${RELEASE_NAME}/architecture-overrides.json"
fi
if [[ -f "$ARCH_CONFIG" ]]; then
  ARCH_RULES="$ARCH_CONFIG"
  ARCH_HAS_RULES=true
fi

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

# ── Architecture check (separate pass) ──
ARCH_VIOLATIONS=0
ARCH_FAIL=false
if $ARCH_HAS_RULES; then
  OVERRIDES_FLAG=""
  [[ -n "$ARCH_OVERRIDES" ]] && OVERRIDES_FLAG="$ARCH_OVERRIDES"
  arch_result=$(python3 -c "
import sys, json, os, re, subprocess

arch_config_path = sys.argv[1]
overrides_path = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else ''
worktree = sys.argv[3] if len(sys.argv) > 3 else '.'

with open(arch_config_path) as f:
    config = json.load(f)

rules = config.get('rules', [])
# Apply overrides: suppress rules by id
suppressed = set()
if overrides_path and os.path.exists(overrides_path):
    with open(overrides_path) as f:
        ov = json.load(f)
    suppressed.update(ov.get('suppress_rules', []))

try:
    output = subprocess.check_output(
        f'git -C {worktree} diff --name-only', shell=True, text=True, cwd=worktree
    )
    changed = [f.strip() for f in output.splitlines() if f.strip()]
except:
    changed = []

violations = []
for rule in rules:
    rid = rule.get('id', '')
    if rid in suppressed:
        continue
    check = rule.get('check', 'grep')
    pattern = rule.get('pattern', '')
    file_pat = rule.get('files', '**')
    severity = rule.get('severity', 'error')
    desc = rule.get('description', rid)
    note = rule.get('note', '')

    if not pattern:
        continue

    # Filter changed files by the rule's file pattern (globby)
    import fnmatch
    matched_files = []
    for cf in changed:
        # Match against glob pattern(s)
        for fp in file_pat.split(','):
            fp = fp.strip()
            if fnmatch.fnmatch(cf, fp):
                matched_files.append(cf)
                break

    if not matched_files:
        continue

    # For grep checks: search pattern in matched files
    if check == 'grep':
        pat = re.compile(pattern)
        for mf in matched_files:
            path = os.path.join(worktree, mf) if worktree != '.' else mf
            if not os.path.exists(path):
                continue
            try:
                with open(path) as fh:
                    for li, line in enumerate(fh, 1):
                        if pat.search(line):
                            violations.append({
                                'rule': rid,
                                'file': mf,
                                'line': li,
                                'severity': severity,
                                'msg': f\"{desc} — {line.strip()[:100]}\",
                                'note': note,
                            })
            except:
                pass

    # touchpoints check: every changed file must be in planned touchpoints
    elif check == 'touchpoints':
        touchpoint_source = rule.get('touchpoint_source', 'spec')
        # Read planned files from spec.md or status.json
        planned = set()
        slice_id = rule.get('slice_id', '')
        if slice_id:
            status_path = os.path.join(worktree, 'docs/release', release_name, slice_id, 'status.json') if release_name else ''
            if status_path and os.path.exists(status_path):
                with open(status_path) as f:
                    st = json.load(f)
                for pf in st.get('planned_files', []):
                    planned.add(pf)
                for pf in st.get('actual_files', []):
                    planned.add(pf)
        for mf in matched_files:
            # Skip docs, screenshots, config files
            if mf.startswith(('docs/', 'screenshots/', '.baton/', '.env')):
                continue
            if mf not in planned:
                violations.append({
                    'rule': rid,
                    'file': mf,
                    'line': 0,
                    'severity': severity,
                    'msg': f\"{desc} — file '{mf}' not in planned touchpoints\",
                    'note': note or 'If intentional, add to spec.md planned touchpoints or declare in proof.md divergence',
                })

    # diff-size check: file growth in lines
    elif check == 'diff-size':
        max_added = rule.get('max_lines_added', 200)
        max_file = rule.get('max_file_lines', 500)
        for mf in matched_files:
            # Get diff stat for this file
            try:
                stat = subprocess.check_output(
                    f'git -C {worktree} diff --numstat HEAD^ -- {mf}',
                    shell=True, text=True, cwd=worktree
                )
                parts = stat.strip().split()
                if len(parts) >= 2:
                    added = int(parts[0]) if parts[0].isdigit() else 0
                    if added > max_added:
                        violations.append({
                            'rule': rid,
                            'file': mf,
                            'line': 0,
                            'severity': severity,
                            'msg': f\"{desc} — {mf} grew by {added} lines (max {max_added})\",
                            'note': note or 'Large additions may indicate monolithic code dumps — consider splitting',
                        })
            except:
                pass
            # Check absolute file size
            path = os.path.join(worktree, mf) if worktree != '.' else mf
            if os.path.exists(path):
                try:
                    with open(path) as fh:
                        line_count = sum(1 for _ in fh)
                    if line_count > max_file:
                        violations.append({
                            'rule': rid,
                            'file': mf,
                            'line': 0,
                            'severity': severity,
                            'msg': f\"{desc} — {mf} is {line_count} lines (max {max_file})\",
                            'note': note or 'Large files should be decomposed',
                        })
                except:
                    pass

summary = {
    'rules_checked': len([r for r in rules if r['id'] not in suppressed]),
    'rules_suppressed': len(suppressed),
    'violations': len(violations),
    'verdict': 'PASS' if not violations else 'FAIL',
}

print(json.dumps({'summary': summary, 'violations': violations}))
" "$ARCH_RULES" "$ARCH_OVERRIDES" "$WORKTREE" 2>&1)

  arch_summary=$(echo "$arch_result" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['summary']))")
  arch_violations_json=$(echo "$arch_result" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['violations']))")
  arch_rules_checked=$(echo "$arch_summary" | jq -r '.rules_checked')
  arch_suppressed=$(echo "$arch_summary" | jq -r '.rules_suppressed')
  ARCH_VIOLATIONS=$(echo "$arch_summary" | jq -r '.violations')
  arch_verdict=$(echo "$arch_summary" | jq -r '.verdict')

  gray "architecture rules checked: $arch_rules_checked  suppressed: $arch_suppressed  violations: $ARCH_VIOLATIONS"

  if [[ "$arch_verdict" != "PASS" ]]; then
    ARCH_FAIL=true
    echo
    red "$ARCH_VIOLATIONS architecture violation(s)"
    echo
    i=1
    while IFS=$'\t' read -r rule file line msg note; do
      printf "  %d. [%s] " "$i" "$rule"
      red "$msg"
      gray "    $file:$line"
      [[ -n "$note" ]] && yellow "    note: $note"
      ((i++))
    done < <(echo "$arch_violations_json" | jq -r '.[] | "\(.rule)\t\(.file)\t\(.line)\t\(.msg)\t\(.note // "")"')
  fi
fi

if [[ "$verdict" == "PASS" ]] && ! $ARCH_FAIL; then
    green "PASS — no design or architecture violations"
    echo
    exit 0
fi

total_violations=$((violation_count + ARCH_VIOLATIONS))
echo
red "NOT CONFORMANT — $total_violations total violation(s)"
echo
echo "Replace hardcoded colours with design tokens or CSS variables."
echo "Fix architecture violations per the rules in $ARCH_CONFIG."
if [[ -n "$SLICE_ID" ]]; then
    echo "To accept a violation, add it to $ALLOWLIST with rationale."
    echo "Or declare in status.json open_deferrals with human/captain acknowledgement."
fi
echo
exit 1

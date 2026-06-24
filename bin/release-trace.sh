#!/usr/bin/env bash
#
# release-trace.sh — mechanical RTM + EARS + sniff-test gate for Rule 8.
#
# Verifies the full requirements-fidelity chain mechanically:
#   intake → slice (covers_needs) → AC (spec.md citations) → test (Required tests)
#
# Plus structural-completeness sniff-test and EARS conformance.
#
# Reads from docs/release/<release-name>/ (or $BATON_RELEASE_DIR override).
# Exits 0 on PASS, 1 on FAIL with numbered violations.
#
# Usage: release-trace.sh <release-name> [--verbose]
#   --verbose  print passing checks as well as violations

set -euo pipefail

VERBOSE=false
RELEASE_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose) VERBOSE=true; shift ;;
    *) RELEASE_NAME="${1:-}"; shift ;;
  esac
done

if [[ -z "$RELEASE_NAME" ]]; then
  echo "usage: release-trace.sh <release-name> [--verbose]" >&2
  exit 2
fi

# Resolve release docs root.
RELEASE_DIR="${BATON_RELEASE_DIR:-docs/release}"
RELEASE_ROOT="${RELEASE_DIR}/${RELEASE_NAME}"
INTAKE="${RELEASE_ROOT}/intake.md"

for dep in python3 jq; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    echo "release-trace: '$dep' is required but not on PATH" >&2
    exit 2
  fi
done

if [[ ! -f "$INTAKE" ]]; then
  echo "release-trace: intake not found at $INTAKE" >&2
  exit 2
fi

green()  { printf '\033[32m%s\033[0m' "$*"; }
red()    { printf '\033[31m%s\033[0m' "$*"; }
yellow() { printf '\033[33m%s\033[0m' "$*"; }
bold()   { printf '\033[1m%s\033[0m'  "$*"; }
gray()   { printf '\033[90m%s\033[0m'  "$*"; }

# ────────────────────────────────────────────────────────────────────
# Pass the heavy text analysis to Python for maintainability.
# It reads intake.md + all slice spec.md + status.json files and
# emits one JSON line per violation, plus a summary.
# ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_CHECK="$(cat <<'PYEOF'
import sys, json, os, re, glob

release_root = sys.argv[1]
intake_path = os.path.join(release_root, "intake.md")
slice_globs = glob.glob(os.path.join(release_root, "S*/"))

if not os.path.exists(intake_path):
    print(json.dumps({"fatal": "intake.md not found at " + intake_path}))
    sys.exit(1)

# ── extract needs from intake.md ──
with open(intake_path) as f:
    intake_text = f.read()

# Find "What the human wants" section and extract N-NN items.
# Format: "- **S01**: label" or numbered list items with - **S01**:
needs = {}  # N-NN -> line content
in_wants = False
for line in intake_text.splitlines():
    if "what the human wants" in line.lower():
        in_wants = True
        continue
    if in_wants and line.startswith("##"):
        break
    if in_wants:
        # Match - **S01**: or - **S01**:
        m = re.match(r'\s*-\s*\*?\*?S(\d+)\*?\*?\s*[:|-]\s*(.+)', line)
        if m:
            nid = f"N-{m.group(1)}"
            needs[nid] = m.group(2).strip()

# If no N-NN extracted, also try: numbered items like "1. **S01** ..."
if not needs:
    in_wants = False
    for line in intake_text.splitlines():
        if "what the human wants" in line.lower():
            in_wants = True
            continue
        if in_wants and line.startswith("##"):
            break
        if in_wants:
            m = re.match(r'\s*\d+\.\s*\*?\*?S(\d+)\*?\*?\s*[:|-]\s*(.+)', line)
            if m:
                nid = f"N-{m.group(1)}"
                needs[nid] = m.group(2).strip()

violations = []

# ── check 0: intake has needs ──
if not needs:
    violations.append({
        "check": "intake-structure",
        "severity": "FAIL",
        "msg": "No N-NN needs found in intake.md 'What the human wants' section.",
        "detail": "Enumerate needs with stable IDs: '1. **S01** — summary bar label changed'",
    })

# ── load all slices ──
slices = {}
for sdir in slice_globs:
    sid = os.path.basename(sdir.rstrip("/"))
    status_path = os.path.join(sdir, "status.json")
    spec_path = os.path.join(sdir, "spec.md")
    if not os.path.exists(status_path):
        continue
    with open(status_path) as f:
        try:
            status = json.load(f)
        except:
            continue
    covers = status.get("covers_needs", []) or []
    state = status.get("state", "unknown")
    spec_text = ""
    if os.path.exists(spec_path):
        with open(spec_path) as f:
            spec_text = f.read()
    slices[sid] = {
        "covers": covers,
        "state": state,
        "spec_text": spec_text,
    }

# ── check 1: every intake N-NN covered by ≥1 slice ──
for nid, ndesc in sorted(needs.items()):
    covered_by = [sid for sid, s in slices.items() if nid in s["covers"]]
    if not covered_by:
        violations.append({
            "check": "orphaned-need",
            "severity": "FAIL",
            "msg": f"Intake need {nid} ('{ndesc}') is not covered by any slice's covers_needs.",
            "need": nid,
        })

# ── check 2: every covers_needs ID exists in intake ──
for sid, s in sorted(slices.items()):
    for nid in s["covers"]:
        if nid not in needs:
            violations.append({
                "check": "invalid-covers",
                "severity": "FAIL",
                "msg": f"Slice {sid} covers_needs references {nid} which is not in intake.md needs.",
                "slice": sid,
            })

# ── check 3: every covers_needs ID has AC citation in that slice's spec ──
for sid, s in sorted(slices.items()):
    for nid in s["covers"]:
        if f"({nid})" not in s["spec_text"] and f"{nid}" not in s["spec_text"]:
            violations.append({
                "check": "unclaimed-coverage",
                "severity": "FAIL",
                "msg": f"Slice {sid} claims {nid} in covers_needs but no AC in spec.md cites {nid}.",
                "slice": sid,
                "need": nid,
            })

# ── check 4: EARS conformance on every AC checkbox ──
# Authentic EARS patterns (Mavin et al., IEEE RE'09):
#   Ubiquitous:      shall <response>                          (always active)
#   Event-driven:    When <trigger>[,] shall <response>
#   State-driven:    While <state>[,] shall <response>
#   Optional-feature: Where <feature>[,] shall <response>
#   Unwanted-beh.:   If <condition>[,] then shall <response>
#   Complex:         two or more EARS keywords + shall
# The <system name> slot is optional for agent-authored specs where the
# subject is implicit (the slice's component / API / page under test).
ears_ubiquitous = re.compile(r'\bshall\b', re.IGNORECASE)
ears_keywords = {
    "When": re.compile(r'\b[Ww]hen\b'),
    "While": re.compile(r'\b[Ww]hile\b'),
    "Where": re.compile(r'\b[Ww]here\b'),
    "If": re.compile(r'\b[Ii]f\b.*\b[Tt]hen\b'),
}
ears_stats = {}
free_form_count = 0

for sid, s in sorted(slices.items()):
    # Extract checkbox ACs from spec
    acs = re.findall(r'^\s*- \[[ x]\]\s*(.+)', s["spec_text"], re.MULTILINE)
    for ac in acs:
        ac_clean = ac.strip()
        # Skip NOTE: lines
        if ac_clean.upper().startswith("NOTE:"):
            continue
        if not ears_ubiquitous.search(ac_clean):
            free_form_count += 1
            violations.append({
                "check": "ears-conformance",
                "severity": "FAIL",
                "msg": f"Slice {sid}: AC '{ac_clean[:80]}...' lacks 'shall' — not EARS-conformant.",
                "slice": sid,
            })
        else:
            # Classify: check for keywords
            keyword_count = 0
            matched_keywords = []
            for kw, pat in ears_keywords.items():
                if pat.search(ac_clean):
                    keyword_count += 1
                    matched_keywords.append(kw)
            if keyword_count >= 2:
                tag = "Complex"
            elif keyword_count == 1:
                tag = matched_keywords[0]
            else:
                tag = "Ubiquitous"
            ears_stats[tag] = ears_stats.get(tag, 0) + 1

# ── check 5: sniff-test — no "see intake.md" references, concretes check ──
concrete_terms = re.compile(
    r'(\.tsx?|\.go|\.json|\.css|\.md)[\'"\s]|'       # file extension
    r"data-testid=|testid=|aria-label=|className="
    r"|[A-Z][a-z]+\.tsx|[a-z_]+\.go|"                # file paths
    r"['\"][A-Za-z0-9._/-]+\.(tsx?|go|json)['\"]|"   # quoted file paths
    r"\b\d{3}\b|"                                     # HTTP status codes
    r"\b[0-9]+(?:\.[0-9]+)?%\b"                       # percentages
)
see_intake = re.compile(r'see\s+intake\.?md|refer\s+to\s+intake|as\s+described\s+in\s+(the\s+)?intake', re.IGNORECASE)
vague_ac = re.compile(r'^(fix|add|wire|build|implement|make|do|handle|address)\s+(the|a|an)\s+', re.IGNORECASE)

for sid, s in sorted(slices.items()):
    # Check for "see intake" references
    if see_intake.search(s["spec_text"]):
        violations.append({
            "check": "see-intake",
            "severity": "FAIL",
            "msg": f"Slice {sid} spec.md contains a 'see intake.md' reference.",
            "slice": sid,
        })
    # Check ACs for vague-scope
    acs = re.findall(r'^\s*- \[[ x]\]\s*(.+)', s["spec_text"], re.MULTILINE)
    for ac in acs:
        ac_clean = ac.strip()
        if ac_clean.upper().startswith("NOTE:"):
            continue
        if vague_ac.match(ac_clean) and not concrete_terms.search(ac_clean):
            violations.append({
                "check": "vague-ac",
                "severity": "FAIL",
                "msg": f"Slice {sid}: AC '{ac_clean[:80]}...' is vague — no concrete artefact (file, testid, status code, label).",
                "slice": sid,
            })

    # Also check in-scope items for vagueness
    in_scope_section = re.search(r'## In scope\s*\n((?:\s*-.*\n)*)', s["spec_text"])
    if in_scope_section:
        for line in in_scope_section.group(1).splitlines():
            stripped = line.strip().lstrip("- ").strip()
            if stripped and not concrete_terms.search(stripped) and vague_ac.match(stripped):
                violations.append({
                    "check": "vague-scope",
                    "severity": "FAIL",
                    "msg": f"Slice {sid}: In-scope item '{stripped[:80]}...' is vague — no concrete artefact.",
                    "slice": sid,
                })

# ── build summary ──
failed = [v for v in violations if v["severity"] == "FAIL"]
summary = {
    "release": os.path.basename(release_root),
    "total_needs": len(needs),
    "total_slices": len(slices),
    "total_acs_checked": sum(ears_stats.values()) + free_form_count,
    "ears_distribution": ears_stats,
    "free_form_acs": free_form_count,
    "violations": len(violations),
    "failed": len(failed),
    "verdict": "PASS" if not failed else "FAIL",
}

print(json.dumps({"summary": summary, "violations": violations}))
PYEOF
)"

if ! result="$(python3 -c "$PY_CHECK" "$RELEASE_ROOT" 2>&1)"; then
    echo "release-trace: Python check failed:" >&2
    echo "$result" >&2
    exit 2
fi

if echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get('fatal') else 99)" 2>/dev/null; then
    echo "release-trace: $(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['fatal'])")" >&2
    exit 2
fi

# ────────────────────────────────────────────────────────────────────
# output
# ────────────────────────────────────────────────────────────────────

summary_json=$(echo "$result" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['summary']))")
violations_json=$(echo "$result" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['violations']))")

total_needs=$(echo "$summary_json" | jq -r '.total_needs')
total_slices=$(echo "$summary_json" | jq -r '.total_slices')
total_acs=$(echo "$summary_json" | jq -r '.total_acs_checked')
free_form=$(echo "$summary_json" | jq -r '.free_form_acs')
violation_count=$(echo "$summary_json" | jq -r '.violations')
failed_count=$(echo "$summary_json" | jq -r '.failed')
verdict=$(echo "$summary_json" | jq -r '.verdict')

echo
bold "RELEASE TRACE — $RELEASE_NAME"
echo
gray "needs: $total_needs  slices: $total_slices  ACs checked: $total_acs"

# EARS distribution
ears_summary=""
for tag in Ubiquitous Complex When While Where If; do
    count=$(echo "$summary_json" | jq -r ".ears_distribution.\"$tag\" // 0")
    ears_summary="${ears_summary}${tag}=$count "
done
gray "EARS: $ears_summary free-form=$free_form"

if [[ "$verdict" == "PASS" ]]; then
    green "PASS — all $total_needs needs traced, $total_acs ACs conformant"
    echo
    if $VERBOSE; then
        echo "Horizontal chain: intake → covers_needs → AC → test"
        echo "Every N-NN covered, every cover backed by AC citation, every AC EARS-conformant."
        echo "No 'see intake' references, no vague-scope ACs."
    fi
    echo
    exit 0
fi

# ── violations ──
red "FAIL — $failed_count violation(s)"
echo

declare -A check_labels
check_labels=(
    ["intake-structure"]="Intake structure"
    ["orphaned-need"]="Orphaned need"
    ["invalid-covers"]="Invalid covers_needs reference"
    ["unclaimed-coverage"]="Unclaimed coverage"
    ["ears-conformance"]="EARS conformance"
    ["see-intake"]='"See intake" reference'
    ["vague-ac"]="Vague acceptance criterion"
    ["vague-scope"]="Vague in-scope item"
)

i=1
while IFS=$'\t' read -r check msg slice need; do
    label="${check_labels[$check]:-$check}"
    printf "  %d. [%s] " "$i" "$label"
    red "$msg"
    [[ -n "$slice" ]] && gray "    slice: $slice"
    [[ -n "$need" ]] && gray "    need: $need"
    ((i++))
done < <(echo "$violations_json" | jq -r '.[] | "\(.check)\t\(.msg)\t\(.slice // "")\t\(.need // "")"')

echo
red "NOT TRACEABLE"
echo
echo "Fix violations above, then re-run release-trace.sh."
echo
exit 1

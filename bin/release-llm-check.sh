#!/usr/bin/env bash
#
# release-llm-check.sh — deterministic LLM-based quality gate.
#
# Layer 2 of the verification stack. Mechanical gates catch missing
# structure (no AC, no "shall", no test function). LLM checks catch
# content failures the mechanical gates cannot see: "does this code
# actually satisfy the AC?", "does this design conflict with memory?",
# "does this test actually test what the AC describes?"
#
# Each check is a focused, deterministic (temp=0) model call with
# structured prompt + structured output. Fail-closed: absence of
# evidence is FAIL.
#
# Check types:
#   ac-satisfaction   does every AC have a matching implementation?
#   spec-ambiguity    are any ACs ambiguous or incomplete?
#   design-review     does the design conflict with project memory?
#   security-review   does the change introduce vulnerabilities?
#   semantic-coverage does the test actually verify the AC?
#
# Usage: release-llm-check.sh --check <check-type> --slice <id> --release <name> [--worktree <path>] [--model <model-id>]
#   Exits 0 on PASS, 1 on FAIL, 2 on configuration error.

set -euo pipefail

CHECK_TYPE=""
SLICE_ID=""
RELEASE_NAME=""
WORKTREE=""
MODEL="${BATON_LLM_MODEL:-claude-sonnet-4-6}"
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)   CHECK_TYPE="${2:-}"; shift 2 ;;
    --slice)   SLICE_ID="${2:-}"; shift 2 ;;
    --release) RELEASE_NAME="${2:-}"; shift 2 ;;
    --worktree) WORKTREE="${2:-}"; shift 2 ;;
    --model)   MODEL="${2:-}"; shift 2 ;;
    --verbose) VERBOSE=true; shift ;;
    *) shift ;;
  esac
done

if [[ -z "$CHECK_TYPE" || -z "$SLICE_ID" || -z "$RELEASE_NAME" ]]; then
  echo "usage: release-llm-check.sh --check <type> --slice <id> --release <name>" >&2
  echo "check types: ac-satisfaction, spec-ambiguity, design-review, security-review, semantic-coverage, maintainability-review" >&2
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
  echo "release-llm-check: spec not found at $SPEC" >&2
  exit 2
fi

# ── load spec content ──
SPEC_CONTENT=$(cat "$SPEC" 2>/dev/null || echo "")

# ── load diff (changed files + content summary) ──
START_COMMIT=$(jq -r '.start_commit // ""' "$STATUS" 2>/dev/null || echo "")
if [[ -z "$START_COMMIT" || "$START_COMMIT" == "null" ]]; then
  echo "release-llm-check: no start_commit in status.json" >&2
  exit 2
fi

CHANGED_FILES=$($GIT_CMD diff --name-only "$START_COMMIT"..HEAD 2>/dev/null | head -50 || echo "")
DIFF_STAT=$($GIT_CMD diff --stat "$START_COMMIT"..HEAD 2>/dev/null | tail -1 || echo "")
DIFF_CONTENT=$($GIT_CMD diff "$START_COMMIT"..HEAD 2>/dev/null | head -5000 || echo "")

echo
bold "LLM CHECK — $CHECK_TYPE — $SLICE_ID"
echo
gray "model: $MODEL  files changed: $(echo "$CHANGED_FILES" | wc -l)"

# ── prepare prompt per check type ──
case "$CHECK_TYPE" in
  ac-satisfaction)
    PROMPT="You are verifying that a software implementation satisfies its specification.

## SPECIFICATION (spec.md)
$SPEC_CONTENT

## CHANGED FILES
$CHANGED_FILES

## DIFF (first 5000 lines)
$DIFF_CONTENT

## TASK
For each acceptance check in the specification (checkbox items under '## Acceptance checks'), determine whether the diff contains code that satisfies it.

For each AC:
1. Identify the AC text
2. Find the code in the diff that implements it (file:line)
3. Judge: SATISFIED, PARTIALLY_SATISFIED, or NOT_SATISFIED
4. Provide evidence: specific file:line references

## OUTPUT FORMAT
Return valid JSON only — no prose, no markdown framing:
{
  \"verdict\": \"PASS\" or \"FAIL\",
  \"findings\": [
    {
      \"ac_index\": <number>,
      \"ac_text\": \"<text>\",
      \"satisfaction\": \"SATISFIED\" | \"PARTIALLY_SATISFIED\" | \"NOT_SATISFIED\",
      \"evidence\": \"<file:line — what the code does>\",
      \"gap\": \"<if not SATISFIED, what is missing>\"
    }
  ]
}

A verdict of FAIL means at least one AC is NOT_SATISFIED."
    ;;
  spec-ambiguity)
    PROMPT="You are reviewing a software specification for ambiguity and completeness.

## SPECIFICATION (spec.md)
$SPEC_CONTENT

## TASK
For each acceptance check, determine whether it is unambiguous and complete enough to implement without further clarification. An ambiguous AC leaves critical details undefined. An incomplete AC describes a behaviour without specifying boundary conditions or error cases.

Judgement criteria:
- UNAMBIGUOUS: names specific files, labels, testids, values, status codes, or concrete behaviour
- AMBIGUOUS: uses vague terms ('properly', 'correctly', 'works', 'fixed') without defining what that means
- INCOMPLETE: describes happy path only without edge cases or error handling
- UNDERSCOPED: describes what should happen but not where (no file, component, or endpoint)

## OUTPUT FORMAT
Return valid JSON:
{
  \"verdict\": \"PASS\" or \"FAIL\",
  \"findings\": [
    {
      \"ac_index\": <number>,
      \"ac_text\": \"<text>\",
      \"quality\": \"UNAMBIGUOUS\" | \"AMBIGUOUS\" | \"INCOMPLETE\" | \"UNDERSCOPED\",
      \"issue\": \"<what is missing or unclear>\",
      \"suggestion\": \"<concrete improvement>\"
    }
  ]
}

A verdict of FAIL means at least one AC is AMBIGUOUS, INCOMPLETE, or UNDERSCOPED."
    ;;
  design-review)
    # Load project memory if available
    MEMORY_DIR="${BATON_MEMORY_DIR:-.claude/memory}"
    MEMORY_CONTENT=""
    if [[ -d "$MEMORY_DIR" ]]; then
      MEMORY_CONTENT=$(find "$MEMORY_DIR" -name "*.md" -exec head -200 {} \; 2>/dev/null | head -3000 || echo "")
    fi

    PROMPT="You are reviewing a design implementation against project memory and established patterns.

## PROJECT MEMORY (constraints, conventions, prior decisions)
$MEMORY_CONTENT

## SPECIFICATION
$SPEC_CONTENT

## CHANGED FILES
$CHANGED_FILES

## TASK
Review the changed files for design conformance:
1. Does this implementation follow established project patterns?
2. Does it conflict with any memory entry (prior decision, convention)?
3. Does it introduce new patterns without justification?
4. Does it duplicate existing functionality?

## OUTPUT FORMAT
Return valid JSON:
{
  \"verdict\": \"PASS\" or \"FAIL\",
  \"findings\": [
    {
      \"severity\": \"violation\" | \"concern\" | \"observation\",
      \"file\": \"<path>\",
      \"issue\": \"<what the design concern is>\",
      \"memory_cited\": \"<memory entry if applicable>\",
      \"recommendation\": \"<what should change>\"
    }
  ]
}

A verdict of FAIL means at least one design violation was found."
    ;;
  maintainability-review)
    PROMPT="You are reviewing code for long-term maintainability — can a new team member understand and modify this code 12 months from now?

## SPECIFICATION
$SPEC_CONTENT

## CHANGED FILES
$CHANGED_FILES

## DIFF (first 5000 lines)
$DIFF_CONTENT

## TASK
Review the diff for maintainability anti-patterns:
1. Naming: are functions, variables, types named clearly and consistently? Does the name convey intent?
2. Separation of concerns: does each function/module have a single responsibility? Is unrelated logic mixed together?
3. Self-documenting design: can you understand what the code does without comments? Are complex algorithms explained?
4. Extension surface: if requirements change, can this be extended without rewriting? Is there a clear interface/contract?
5. Duplication: is any logic duplicated that should be extracted? Copy-paste code that differs by one parameter?
6. God objects/functions: does one entity do too many things? Is a component both rendering UI AND managing state AND making API calls AND handling validation?
7. Test clarity: are test names descriptive? Do assertions fail with useful messages? Can you understand the test intent without reading the implementation?

## OUTPUT FORMAT
Return valid JSON:
{
  \"verdict\": \"PASS\" or \"FAIL\",
  \"findings\": [
    {
      \"severity\": \"blocker\" | \"major\" | \"minor\",
      \"file\": \"<path>:<line>\",
      \"category\": \"naming\" | \"separation_of_concerns\" | \"self_documenting\" | \"extension_surface\" | \"duplication\" | \"god_object\" | \"test_clarity\",
      \"issue\": \"<what is hard to understand or maintain>\",
      \"recommendation\": \"<how to improve>\"
    }
  ]
}

A verdict of FAIL means at least one blocker or major maintainability issue was found."
    ;;
  semantic-coverage)
    PROMPT="You are verifying that tests actually exercise the behaviour the specification requires, not just name-match.

## SPECIFICATION
$SPEC_CONTENT

## CHANGED FILES
$CHANGED_FILES

## DIFF (first 5000 lines)
$DIFF_CONTENT

## TASK
For each acceptance check, find the test that claims to cover it. Determine:
1. Does the test setup create the preconditions the AC requires?
2. Does the test exercise the specific behaviour the AC describes?
3. Do the assertions verify the specific outcome the AC expects?
4. Is the test a genuine verification or a tautology (always passes)?

## OUTPUT FORMAT
Return valid JSON:
{
  \"verdict\": \"PASS\" or \"FAIL\",
  \"findings\": [
    {
      \"ac_index\": <number>,
      \"ac_text\": \"<text>\",
      \"test_found\": \"<test function name or 'none'>\",
      \"genuine\": true or false,
      \"gap\": \"<if not genuine, what the test fails to verify>\"
    }
  ]
}

A verdict of FAIL means at least one test does not genuinely verify its AC."
    ;;
  security-review)
    PROMPT="You are reviewing code changes for security vulnerabilities.

## SPECIFICATION
$SPEC_CONTENT

## CHANGED FILES
$CHANGED_FILES

## DIFF (first 5000 lines)
$DIFF_CONTENT

## TASK
Review the diff for:
1. Injection vulnerabilities (SQL, command, template)
2. Authentication/authorization bypasses
3. Sensitive data exposure (logging, error messages, serialization)
4. Missing input validation
5. Insecure cryptography (weak algorithms, hardcoded keys, improper IV/nonce)
6. Race conditions or TOCTOU issues

## OUTPUT FORMAT
Return valid JSON:
{
  \"verdict\": \"PASS\" or \"FAIL\",
  \"findings\": [
    {
      \"severity\": \"critical\" | \"high\" | \"medium\" | \"low\",
      \"file\": \"<path>:<line>\",
      \"vulnerability\": \"<CWE or description>\",
      \"evidence\": \"<the vulnerable code>\",
      \"remediation\": \"<how to fix>\"
    }
  ]
}

A verdict of FAIL means at least one security vulnerability was found."
    ;;
  *)
    echo "release-llm-check: unknown check type '$CHECK_TYPE'" >&2
    echo "valid types: ac-satisfaction, spec-ambiguity, design-review, semantic-coverage, security-review, maintainability-review" >&2
    exit 2
    ;;
esac

# ── output prompt and instructions ──
echo
gray "Prompt prepared ($(echo "$PROMPT" | wc -c) chars)."
echo
echo "This check requires an LLM invocation. The prompt is ready."
echo
echo "--- PROMPT (pipe to your model provider) ---"
echo "$PROMPT"
echo "--- END PROMPT ---"
echo
echo "The model response should be valid JSON matching the output format."
echo "Parse it to determine PASS/FAIL."

# ── for automated use, invoke via configured provider ──
PROVIDER="${BATON_LLM_PROVIDER:-}"
if [[ -n "$PROVIDER" ]]; then
  case "$PROVIDER" in
    anthropic)
      if ! command -v anthropic-cli >/dev/null 2>&1; then
        echo "anthropic-cli not installed. Install via: npm i -g @anthropic-ai/cli" >&2
        exit 2
      fi
      echo "$PROMPT" | anthropic-cli --model "$MODEL" --temperature 0 --json 2>&1
      ;;
    openai)
      echo "release-llm-check: openai provider not yet implemented" >&2
      exit 2
      ;;
    *)
      echo "release-llm-check: unknown provider '$PROVIDER'. Set BATON_LLM_PROVIDER=anthropic|openai" >&2
      exit 2
      ;;
  esac
fi

---
title: Watcher Protocol — machine-readable turn-end signals
description: Agents running under automated orchestration must emit a structured WATCHER_STATUS block at the end of every turn so the watcher can route without LLM inference.
---

# Watcher Protocol

When a project uses the `agent-watcher` orchestrator (or any equivalent automated session monitor), agents must emit a **WATCHER_STATUS block** as the very last output of every turn that ends at a prompt boundary.

This makes routing deterministic — the watcher greps for the block rather than running NLP inference on freeform prose. It is the difference between a reliable assembly line and a fragile one.

## Format

```
<!-- WATCHER
STATE: <state>
SLICE: <current-slice-id or NONE>
NEXT: <next-slice-id or NONE>
REASON: <one sentence — human-readable>
-->
```

All four fields are required. Omit none.

## Valid STATE values

| STATE | Meaning | Watcher action |
|---|---|---|
| `verified_awaiting_approval` | Slice passed adversarial verification. Awaits human approval to merge/ship. | Telegram alert to human — no auto-advance |
| `verified_implement_next` | Slice verified. Next slice is known and ready. | Auto: `/new` → `/implement-slice <NEXT>` |
| `verified_validate` | Slice implemented. Ready for adversarial verification. | Auto: `/new` → `/validate-slice <SLICE>` |
| `blocked_needs_planner` | Spec gap or ambiguity found. Planner re-engagement required before proceeding. | Telegram escalation — no auto-advance |
| `blocked_needs_human` | Multiple-choice decision, unclear path, or out-of-scope discovery requires human input. | Telegram escalation — no auto-advance |
| `in_progress` | Turn is a natural pause mid-slice (e.g. waiting on a tool, intermediate commit). Not done yet. | Watcher ignores — no action |
| `error` | Tests failed, build broken, or irrecoverable state. | Telegram escalation — no auto-advance |

## When to emit

- **Implementer**: emit at the wrap-up step, after `status.json` is updated to `implemented` and the proof bundle is written. STATE should be `verified_validate`.
- **Verifier**: emit after the PASS/FAIL/BLOCKED verdict. STATE maps directly: PASS → `verified_awaiting_approval`, FAIL → `blocked_needs_human`, BLOCKED → `blocked_needs_planner`.
- **Planner**: emit after the release index and all slice specs are written and committed. STATE should be `verified_implement_next` with NEXT set to the first slice id.
- **Any session that hits a blocker**: emit immediately with the appropriate blocked state before stopping.

## Placement rule

The WATCHER_STATUS block must be the **absolute last content** in the turn — after all prose, after proof bundle output, after everything. The watcher detects turn completion by seeing the prompt return, then reads the last N lines. If the block is buried in the middle of output, it may be missed.

## Example — implementer wrap-up

```
proof.md written. scripts/release-verify.sh S07 passed all gates. status.json → implemented.

Ready for fresh-context verification.

<!-- WATCHER
STATE: verified_validate
SLICE: S07-playwright-harness-suite
NEXT: NONE
REASON: All gates passed, proof bundle written, ready for adversarial verification.
-->
```

## Example — verifier PASS

```
PASS

Slice: S07-playwright-harness-suite
Verified against: 4a2b3c1d
Verifier session: fresh, artefact-only

<!-- WATCHER
STATE: verified_awaiting_approval
SLICE: S07-playwright-harness-suite
NEXT: S08-foo-bar
REASON: All six gates passed. S08 is the next unimplemented slice per the release index.
-->
```

## Example — blocked

```
BLOCKED

Slice: S01-hecs-validation
Reason: spec.md assumes persons[].hecsBalance exists in FireValidationState but the field
is absent. Planner re-engagement needed to amend spec before implementation can proceed.

<!-- WATCHER
STATE: blocked_needs_planner
SLICE: S01-hecs-validation
NEXT: NONE
REASON: Data plumbing prerequisite missing from spec — hecsBalance not present in FireValidationState.
-->
```

## Reusability note

This protocol is independent of the source project. Any project using the `agent-watcher` script (or any orchestrator that watches for the same block format) can adopt it by including this file and patching their role prompts to emit the block. The block format is intentionally minimal — four fields, plain ASCII, HTML comment syntax so it renders invisibly in markdown. No external schema, no JSON, no YAML — just greppable text.


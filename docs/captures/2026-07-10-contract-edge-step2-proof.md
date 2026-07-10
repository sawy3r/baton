---
title: 'Proof: contract-edge step 2 draft — contracts-v1 schema, mock-parity sub-rule, assembly stage (baton#59)'
description: 'Proof bundle for the step-2 governance package drafted on feat/contract-edge-step2. Deliverable is a reviewable branch; ratification is the human merge decision, by design.'
---

# Proof: contract-edge step 2 draft (baton#59)

Anchor issue: [baton#59](https://github.com/sawy3r/baton/issues/59). Verdicts ratified in-conversation 2026-07-10: kind-enum extensions delegated to draft-for-review; mock parity lands as a **Rule 10 sub-rule** (not a Rule 2 extension, and not a twelfth rule — ROADMAP fixes the rule count at eleven); `assembled` is a **derived** state (artefact existence + verdict), consistent with board pure-plan invariant 5.

## Scope

Draft the three step-2 governance artefacts from the ordering ruling — the `contracts-v1.json` record schema, the mock-parity rule text, and the `assembled` state + Rule 10 wording — plus the planner/merge-release wiring that emits and reads them, all under the optional-with-advisory skew policy. The deliverable is a branch for human ratification, not a merged change.

## Files changed

`git diff --name-only main` on `feat/contract-edge-step2`:

```
baton/AGENTS-fragment.md
baton/customer-journey-validation.md
baton/release-mode-template/contracts.json
baton/role-prompts/planner.md
commands/merge-release.md
docs/captures/2026-07-10-contract-edge-step2-proof.md
schemas/contracts-v1.json
```

## Test results

The slice-relevant checks are schema-mechanical (this repo has no code suite):

- `contracts-v1.json` parses and compiles as JSON Schema draft 2020-12 (`jsonschema.Draft202012Validator`).
- Positive example (4 contracts incl. the retro's CP-PUT/If-Match/CORS triple): **VALID**.
- Fail-closed negatives, all **rejected**: consumers without `live_test`; `http-endpoint` without `edge_config`; malformed `edge_config` waiver (must be `C-NN` or `n/a: <reason>`); unknown `kind` (`route`).
- Template exemplar `release-mode-template/contracts.json`: **VALID** against the schema.

## Reachability artefact

The affordances are the role prompts and command docs read at runtime from the installed tree. Reachability at review time = the branch diff itself; post-merge reachability = the install-sync step (repo → `~/.claude/baton/` + `~/.codex/baton/` + the AGENTS-fragment Rule 10 paragraph re-spliced into `~/.claude/CLAUDE.md`), recorded as a merge-time checklist item in the PR. Smoke step post-merge: `/plan-release <name>` Phase 3b now instructs emitting `contracts.json`; `/merge-release <name>` Step 1 now surfaces the assembly gate.

## Delivered

- **`schemas/contracts-v1.json`** — 11-kind closed enum (7 from the proposal + `cookie`, `db-schema`, `feature-flag`, `auth-scope` added for review); one owner per contract; `live_test` conditionally required; `edge_config` sibling-or-waiver conditionally required on HTTP-middleware-crossing kinds. Advisory status stated in the schema description.
- **Rule 10 sub-rule "Mock parity at registered contract boundaries"** — `baton/customer-journey-validation.md`: owner-recorded fixtures, the unmocked-round-trip escape hatch, the freshness invariant (fixtures newer than the owner's last production-code change to the surface), file-based pact mechanics, advisory status.
- **Rule 10 "The assembly stage"** — same file: `tracks-merged → assembled → journey-validated → merged`; `assembled` derived from `assembly-proof.json` existence + verdict on `release-wt/<name>`; human journey walk moves to after the assembly run passes; workflow steps renumbered.
- **`baton/AGENTS-fragment.md`** — Rule 10 condensed paragraph extended with mock parity + assembly stage.
- **`role-prompts/planner.md`** — Phase 3b step 3 "Build the contract registry" (emit `contracts.json`, advisory); Phase 4 checklist gains "Wire artefacts registered".
- **`commands/merge-release.md`** — Step 1 gate 3 assembly gate: passing proof = assembled; failing proof = hard BLOCK; absent proof = explicit human-risk-acceptance WARNING until `sworn assemble` ships. Step 2 scope summary surfaces it.
- **`baton/release-mode-template/contracts.json`** — schema-valid exemplar including the edge-config sibling pattern.

## Not delivered (Rule 2 deferrals — why + tracking + acknowledgement)

- **Ratification + merge** — human-owned by design (ordering ruling step 2 is "governance changes, human-ratified"). Tracking: the PR itself. Acknowledged: this session's wrap-up.
- **Install sync + `~/.claude/CLAUDE.md` Rule 10 re-splice** — deferred until the branch merges (syncing an unratified draft would put unratified rule text live). Tracking: PR merge checklist. Acknowledged: session wrap-up.
- **`CLAUDE-md-user-level.md` refresh** — the optional user-level fragment predates Rules 8–11 entirely; out of this slice's scope. Tracking: noted on baton#59. Acknowledged: session wrap-up.
- **Sworn implementations** (`lint contracts`, fixture checks, `assemble`, schema-version handshake) — ordering ruling step 3, blocked on this ratification. Tracking: baton#59 checklist, swornagent/sworn#88 precedent.

## Divergence from plan

- **Kind enum extended beyond the proposal's seven** (`cookie`, `db-schema`, `feature-flag`, `auth-scope` added; SPA `route` considered and excluded — no middleware surface; broken links belong to the journey walk). Flagged in the PR for strike-through review rather than pre-agreed.
- **`edge_config` made a first-class conditional field** rather than the proposal's lint-level "WARN → FAIL in strict mode" sibling rule — the schema can carry the fail-closed obligation directly, which is stronger than a lint heuristic and simpler to grade.
- **Merge-release absent-proof semantics**: the proposal implied gate-on-assembled outright; the draft makes absence an explicit human-risk-acceptance warning during the advisory window (skew policy) while a *failing* proof is already a hard BLOCK.

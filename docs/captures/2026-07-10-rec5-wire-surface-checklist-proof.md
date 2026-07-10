---
title: 'Proof: Rec 5 — wire-surface enumeration in the planner prompt (baton#59, step 1)'
description: 'Proof bundle for the first contract-edge item from the 2026-07-10 one-CP retro: planner.md Layer 4 wire-surface checklist + Phase 4 mocked-boundary live-transport guard.'
---

# Proof: Rec 5 — wire-surface enumeration in the planner prompt

Anchor issue: [baton#59](https://github.com/sawy3r/baton/issues/59) (epic: contract-edge gates). Source retro: `fired` repo, `docs/captures/2026-07-10-baton-sworn-edge-contracts-proposal.md`.

## Scope

Land the agreed do-first item from the contract-edge proposal: two prompt-only additions to `baton/role-prompts/planner.md` so wire-level seams (headers, endpoints, body shapes, middleware/config surfaces) get an owning slice or an explicit not-applicable at planning time, and any AC satisfiable by a mocked boundary must name the live-transport test that pins it.

## Files changed

`git diff --name-only` (against `main` HEAD `fc497b4`, working tree at commit time):

```
baton/role-prompts/planner.md
docs/captures/2026-07-10-rec5-wire-surface-checklist-proof.md
```

## Test results

This repo is pure prose + JSON Schemas; no test suite covers the role prompts. Slice-relevant verification is mechanical:

- The two insertions are additive (3 lines net in `planner.md`); no existing checklist item, phase heading, or hard constraint was modified or removed — confirmed by `git diff baton/role-prompts/planner.md` showing insertions only.
- Post-sync, `diff` of repo copy vs `~/.claude/baton/role-prompts/planner.md` and vs `~/.codex/baton/role-prompts/planner.md` is empty (recorded in the session; re-runnable any time).

## Reachability artefact

The affordance is `/plan-release`, which reads `$HOME/.claude/baton/role-prompts/planner.md` at runtime (see `commands/plan-release.md` line 10). Reachability = the new text present in that runtime-read path:

```
grep -c "Wire-surface enumeration" ~/.claude/baton/role-prompts/planner.md   # → 1
grep -c "Live-transport pin"       ~/.claude/baton/role-prompts/planner.md   # → 1
```

Smoke step: open any fresh planner session via `/plan-release <name>`; Layer 4 of the governing prompt now contains the wire-surface enumeration block, and the Phase 4 self-contained-spec checklist contains the mocked-boundary guard.

## Delivered

- **Layer 4 wire-surface enumeration** — `baton/role-prompts/planner.md`, "Wire-surface enumeration" block at the end of Layer 4: every NEW wire artefact must have each middleware/config surface between client and handler assigned to an owning slice or explicitly marked not-applicable. Carries the observed failure class (If-Match specced both ends, CORS AllowHeaders owned by nobody) as portable prose.
- **Phase 4 checklist: live-transport pin for mocked boundaries** — new checklist item; interim guard until Recs 1+2 (contract registry + owner-recorded fixtures) subsume it.
- **Install sync** — repo copy propagated to `~/.claude/baton/role-prompts/planner.md` and `~/.codex/baton/role-prompts/planner.md` (both runtime-read paths; the retro's install-source-skew scar).
- **Durable anchors** — baton#59 (epic, Recs 1/2/3/5 with ordering ruling + skew-window management) and swornagent/sworn#88 (Rec 4, BLOCKED short-circuit, sworn-first per the exception ruling).

## Not delivered (Rule 2 deferrals — why + tracking + acknowledgement)

- **Rec 1 (contracts-v1 schema + planner Phase 3b/4 registry wiring)** — deliberately not landed with Rec 5: the Phase 3b "build the contract registry" instruction must reference a ratified `contracts-v1.json` schema or the planner emits an unvalidated record, breaking the records-over-prose invariant. Governance change, human-ratified per ordering ruling step 2. Tracked: baton#59 checklist. Acknowledged: surfaced in this session's wrap-up to Brad.
- **Rec 2 (mock-parity rule + proof fixtures)** and **Rec 3 (`assembled` state + Rule 10 wording)** — same governance gate. Tracked: baton#59. Acknowledged: session wrap-up.
- **Rec 4** — sworn-side, ships independently. Tracked: swornagent/sworn#88. Acknowledged: session wrap-up.

## Divergence from plan

- The proposal's Layer 4 text cited the consumer project's issue number ("the 2026-07-10 #1169 class"). The landed text describes the failure class in portable prose instead — a `fired` issue number is meaningless in the portable rule-set. Substance unchanged.
- The proposal's interim-guard line ("fold the S14 lesson into the self-contained-spec checklist") was landed as a full checklist item with the shared-blind-spot rationale, not a one-liner, matching the register of the surrounding checklist entries.
- Proof bundles live at `docs/captures/` per the global rule-set; this is the first capture in the baton repo (directory established by this file).

---
title: 'Proof: Rule 12 (Guard Fidelity) + Rule 8/9 amendments (baton#64)'
description: 'Proof bundle for landing Rule 12 (Guard Fidelity) as a new rule plus the Rule 8 (bounded AC) and Rule 9 (prevalence ≠ correctness) amendments, with full integration. Drafted for human ratification.'
---

# Proof: Rule 12 (Guard Fidelity) + Rule 8/9 amendments (baton#64)

Anchor: [baton#64](https://github.com/sawy3r/baton/issues/64). Full brief + provenance:
`docs/captures/2026-07-12-rule-12-guard-fidelity-handoff.md`.

## Scope

Land Rule 12 (Guard Fidelity) as a new rule, plus the Rule 8 (bounded acceptance criterion) and
Rule 9 (prevalence is not correctness) amendments, fully integrated across the rule-set surface,
for human ratification. All three trace to one root cause — a claim made wider than the evidence
that backed it — at the check, criterion, and decision layers.

## Files changed

`git diff --name-only main` on `feat/rule-12-guard-fidelity` (incl. new files):

```
baton/guard-fidelity.md                  NEW — Rule 12 doc (moved from repo root, polished to house style)
baton/requirements-fidelity.md           Rule 8: "an acceptance criterion must be bounded"
baton/design-fidelity.md                 Rule 9: "prevalence is not correctness"
baton/role-prompts/verifier.md           Gate 6b — guard fidelity (Rule 12 enforcement)
baton/AGENTS-fragment.md                 12th rule block; eleven→twelve
baton/RULES-HISTORY.md                   0.7.0 cycle entry; header eleven→twelve
README.md                                rule table row 12; eleven→twelve; 6–11→6–12 framing
docs/captures/2026-07-12-rule-12-guard-fidelity-handoff.md   NEW — provenance brief (moved from root)
docs/captures/2026-07-12-rule-12-guard-fidelity-proof.md     this bundle
```

## Test results

Prose/spec repo, no code suite. Slice-relevant verification is mechanical/consistency:

- Rule count reconciled across every surface: `README.md`, `AGENTS-fragment.md`, `RULES-HISTORY.md`
  header all read **twelve**; the only remaining "eleven" strings are historical RULES-HISTORY
  entries that correctly describe past states, and the new entry's "eleven verification failures"
  (a different count).
- Rule 12 doc carries the house-style sections other rule docs have: The rule / corollary / Why /
  Priority-order note / Relationship to existing rules / When it applies / When it does NOT apply /
  Provenance.
- Public-repo scrub: no product identifiers, brand tokens, or private issue numbers in any changed
  file. (`tremor` retained — a public third-party UI library, not a source-project identifier;
  matches the handoff author's own scrub.)

## Reachability artefact

Affordances are the rule docs and verifier prompt read at runtime from the installed tree.
Reachability at review = the branch diff; the enforcement teeth are Gate 6b in
`role-prompts/verifier.md` (Rule 12 is otherwise advisory — the handoff's own point that "advisory
rules lose"). Post-merge: install-sync to `~/.claude/baton/` + `~/.codex/baton/`, re-splice the
12-rule AGENTS-fragment into `~/.claude/CLAUDE.md`. Smoke: a verifier reading the updated prompt
now applies Gate 6b before accepting a guard as evidence for a domain-quantified claim.

## Delivered

- **Rule 12 — Guard Fidelity** (`guard-fidelity.md`): four conditions (mutation proof, scope parity,
  mutate-the-real-form, right instrument) + quantifier-discipline corollary; priority-order note
  (append-as-12, logically upstream of 6/7); relationship + applicability sections.
- **Rule 8 amendment**: bounded-AC section — unbounded AC = non-terminating verification loop; bind
  to a named enumerable set; honest-bounding test (narrows *and* strengthens); framed as the
  front-half twin of Rule 12's scope parity.
- **Rule 9 amendment**: prevalence-is-not-correctness section — separate the prevalence finding from
  the recommendation; run the quality floor on the incumbent; the "ratifies reality / follows the
  code's gravity" tell.
- **Verifier Gate 6b**: guard-fidelity enforcement — scope parity, real-form mutation, right
  instrument, presence-over-absence, each fail-closed.
- **Integration**: AGENTS-fragment 12th block + count; RULES-HISTORY 0.7.0 entry; README rule table
  + framing; provenance handoff preserved under `docs/captures/`.

## Not delivered (Rule 2 deferrals — why + tracking + acknowledgement)

- **Priority-order: append-as-Rule-12 vs renumber into a low position** — the handoff flagged this
  as a Coach call. Drafted as append (non-disruptive; renumbering breaks every adopter reference and
  vendored copy) with an in-doc note that it is logically upstream of 6/7. Tracking: PR #64 + #64
  checklist. Acknowledged: session wrap-up. Amend before merge if you want a renumber.
- **Ratification + merge + VERSION/tag/release** — human-owned governance; version follows the merge
  per RELEASING.md. This is a new rule (rules-content minor → 0.7.0); the package minor it ships in
  is the Coach's sequencing call relative to the in-flight #63. Tracking: PR + #64.
- **Install-sync + CLAUDE.md re-splice** — post-merge, to avoid syncing an unratified rule live.
  Tracking: PR merge checklist.
- **Interaction with PR #63** — both touch `design-fidelity.md` and `AGENTS-fragment.md`, but in
  disjoint sections/anchors (this PR: Rule 9 "prevalence" after Option surfacing, and the AGENTS
  Rule 12 block; #63: Rule 9 "autonomous gate" before Design-system input, and the AGENTS Rule 9/10/11
  text) — a clean git auto-merge is expected whichever lands first. Surfaced in the PR.

## Divergence from plan

- Handoff shipped the Rule 12 draft at the repo root as "the only copy"; moved it to `baton/`
  alongside the other rule docs and the brief to `docs/captures/` (durable provenance), per the
  handoff's own integration step 1.
- Rule 9 "prevalence" section placed after **Option surfacing** rather than after Enforcement,
  specifically to avoid a merge collision with PR #63's autonomous-gate section (which anchors before
  Design-system input). Content unchanged; placement chosen for clean coexistence.

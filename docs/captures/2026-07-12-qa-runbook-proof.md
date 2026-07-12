---
title: 'Proof: cutover QA runbook — Rule 10 companion artefact (baton#66)'
description: 'Proof bundle for the cutover QA runbook: a rendered-from-records human-walk artefact that targets manual QA. Rule 10 doc addition + template + fragment touch. Drafted for ratification.'
---

# Proof: cutover QA runbook (baton#66)

Anchor: [baton#66](https://github.com/sawy3r/baton/issues/66).

## Scope

Add the cutover QA runbook — a generated, human-facing per-release walk that targets manual QA rather than replacing it — as an additive artefact under Rule 10, for human ratification.

## Files changed

`git diff --name-only main` on `feat/qa-runbook-rule10` (incl. new files):

```
baton/customer-journey-validation.md         Rule 10: "The cutover QA runbook" section + Workflow step
baton/release-mode-template/qa-runbook.md     NEW — rendered-from-records exemplar
baton/AGENTS-fragment.md                       Rule 10 condensed text: runbook clause
baton/RULES-HISTORY.md                         0.7.1 patch entry
docs/captures/2026-07-12-qa-runbook-proof.md   this bundle
```

## Test results

Prose/template repo, no code suite. Consistency checks:

- Not a new rule — the count stays twelve; RULES-HISTORY logs it as a patch (0.7.1), additive artefact only. No existing rule, role, or contract text changed in a breaking way.
- The runbook is positioned as a rendered view of existing records (Rule 1 smoke-steps, `journeys-v1`, `proof-v1` delivered, `contracts-v1`) — no new data model. Advisory: no new fail-closed gate; the attestation stays the gating artefact.
- Template `qa-runbook.md` carries the "rendered — do not hand-edit" banner and a concrete per-journey walk exemplar consistent with the other `release-mode-template/` artefacts.
- Public-repo scrub: no product identifiers (example uses the generic `2026-05-20-billing-redesign` release from the other templates).

## Reachability artefact

Affordance is the Rule 10 doc + template read at runtime from the installed tree; reachability at review = the branch diff. Post-merge: install-sync to `~/.claude/baton/` + `~/.codex/baton/`, re-splice the Rule 10 fragment paragraph into `~/.claude/CLAUDE.md`. Smoke: a cutover session reading Rule 10 now finds the runbook step between the assembly run and the attestation, with a template to render against.

## Delivered

- **Rule 10 "The cutover QA runbook" section** (`customer-journey-validation.md`) — what it is, the rendered-view inputs, where it sits in the chain (assembly-proof → runbook → attestation), form/rendering, advisory status; Workflow gains step 6 (render) with the human walk now "guided by the runbook".
- **`release-mode-template/qa-runbook.md`** — rendered-from-records exemplar: per-touched-journey walk (what changed → how to check → expected), new-wire-surface spot-checks, not-covered section, attestation sign-off pointer.
- **AGENTS-fragment** Rule 10 clause; **RULES-HISTORY** 0.7.1 patch entry with the two-independent-arrivals provenance.

## Not delivered (Rule 2 deferrals — why + tracking + acknowledgement)

- **Design questions from #66 resolved by drafting the recommended leans, flagged for ratification**: placement = Rule 10 cutover workflow (not standalone command); not a new rule; prose rendered from records; rendered by `sworn`/orchestrator; pairs with (does not duplicate) the attestation. Merge = ratify; amend to override. Tracking: PR + #66.
- **Engine rendering (`sworn` emits `qa-runbook.md` at cutover)** — engine work, re-vendored on the VERSION-pin bump. Tracking: the sworn v0.11.0 integration handoff (append). Acknowledged: session wrap-up.
- **VERSION bump + install-sync** — post-merge; this is a rules-content patch (0.7.1), package version per Coach sequencing. Tracking: PR merge checklist.

## Divergence from plan

- Kept the artefact **advisory** (no fail-closed gate) deliberately — a human-walk aid should not block the pipeline; the attestation is already the gating artefact. If a future gate wants to assert "a runbook was rendered", that is a separate, later decision.
- No schema: `qa-runbook.md` is human-facing prose rendered from records, so per the records-vs-prose rule it is Markdown, not a JSON record — no `qa-runbook-v1` schema is introduced.

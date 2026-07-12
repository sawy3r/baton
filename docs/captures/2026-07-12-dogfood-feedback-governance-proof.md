---
title: 'Proof: dogfood-feedback governance package — capability-policy-v1 + Rule 9/10/11 refinements (baton#62)'
description: 'Proof bundle for the first sworn→Baton dogfood-feedback package: the capability-policy-v1 schema, Rule 9 autonomous-gate / Rule 10 mock-is-code / Rule 11 resume-reset refinements, and the feedback-loop CONTRIBUTING note. Drafted for human ratification.'
---

# Proof: dogfood-feedback governance package (baton#62)

Anchor: [baton#62](https://github.com/sawy3r/baton/issues/62). Source of truth: sworn repo
`docs/captures/2026-07-12-baton-handoff-capability-policy-and-protocol-updates.md`, sworn ADR-0013.

## Scope

Land the five protocol actionables from the 2026-07-12 sworn dogfood as a human-ratified
governance package: a new `capability-policy-v1` schema, refinements to Rules 9/10/11, a
gate-contract clause for capability-absent, and a CONTRIBUTING note formalising the sworn→Baton
feedback loop. The deliverable is a branch for ratification, not a merged change.

## Files changed

`git diff --name-only main` on `feat/dogfood-feedback-capability-policy` (incl. new files):

```
CONTRIBUTING.md                          NEW — §5 feedback-loop process
ROADMAP.md                               schema list + capability-policy-v1
baton/AGENTS-fragment.md                 Rule 9/10/11 condensed-text refinements
baton/capability-policy.md               NEW — §3.1 contract doc + §3.5 clause
baton/customer-journey-validation.md     §3.4 mock = code construct
baton/design-fidelity.md                 §3.3 autonomous-mode gate semantics
baton/process-global-mutation.md         §3.2 resumed-loop restore contract
schemas/capability-policy-v1.json        NEW — §3.1 headline schema
docs/captures/2026-07-12-…-proof.md       this bundle
```

## Test results

Schema-mechanical (this repo has no code suite):

- `capability-policy-v1.json` compiles as JSON Schema draft 2020-12.
- Positive: the handoff's example policy (7-token taxonomy, 4 roles with thresholds,
  `on_capability_absent`) → **VALID**.
- Fail-closed negatives, all **rejected**: unknown role; ordinal capability without `levels`;
  malformed comparator (`~200000`); two-key threshold object; bad `on_capability_absent` enum;
  missing `taxonomy`.

## Reachability artefact

Affordances are the schema and the rule/role docs read at runtime from the installed tree.
Reachability at review = the branch diff. Post-merge: install-sync to `~/.claude/baton/` +
`~/.codex/baton/`, re-splice the AGENTS-fragment Rule 9/10/11 paragraphs into `~/.claude/CLAUDE.md`,
publish `capability-policy-v1.json` to `baton.sawy3r.net/schemas/` — recorded as the PR merge
checklist. Smoke: a planner/loop reading the updated Rule 9 now finds defined autonomous-gate
behaviour; a capability-aware engine can validate an operator policy against the published schema.

## Delivered

- **`schemas/capability-policy-v1.json`** — taxonomy (boolean/quantitative/ordinal kinds) + per-role
  `requires` (bare token or single-key threshold object) + optional `on_capability_absent`. Roles
  enum-constrained; ordinal-needs-levels and single-key-threshold enforced structurally. Validated.
- **`baton/capability-policy.md`** — the contract rationale: the model-pin problem, eligibility =
  requirements ∩ registry, the explicit non-goal (Baton does not rank/pick), and the §3.5
  capability-absent clause (prose-fallback-gated vs rule2-deferral; silent no-op forbidden).
- **Rule 9 autonomous-gate section** (`design-fidelity.md`) — Type-2 auto-proceed-with-record;
  Type-1 hard-pause for async Coach ack, never auto-proceed, captain self-review may enrich but not
  clear. Marked as a Coach-ratifiable Type-1 governance choice.
- **Rule 10 mock-is-code-construct** (`customer-journey-validation.md`) — detection against code
  tokens (non-string/non-comment spans / AST), not raw text; annotation-parsing code no longer
  self-fails.
- **Rule 11 resumed-loop restore contract** (`process-global-mutation.md`) — `reset --hard` + clean
  to committed slice state (target asserted first) before re-dispatch; recovers cleanly, not merely
  without corrupting.
- **`CONTRIBUTING.md`** — the triage→route→version→durability feedback loop; this package as the
  exemplar.
- **`AGENTS-fragment.md`** — condensed Rule 9/10/11 text carries all three refinements.

## Not delivered (Rule 2 deferrals — why + tracking + acknowledgement)

- **Ratification + merge + VERSION bump to v0.11.0 + tag + GitHub release** — human-owned by design
  (governance). VERSION/tag follow the merge per RELEASING.md, not this PR. Tracking: the PR + #62.
  Acknowledged: session wrap-up.
- **Publish `capability-policy-v1.json` + install-sync** — deferred to post-merge; syncing an
  unratified schema live would put an unratified contract in front of consumers. Tracking: PR merge
  checklist. Acknowledged: wrap-up.
- **sworn-side implementation** (provider registry, taxonomy mapping, eligibility gate, eval router;
  Findings 0/2/3/4 engine fixes) — the engine's work per ADR-0013, re-vendored on the VERSION-pin
  bump. Tracking: sworn ADR-0013 + the `loop-hardening` release. Acknowledged: wrap-up.

## Divergence from plan

- **§3.3 and §3.5 carried genuine forks; drafted with the safety-conservative default and flagged**
  for Coach ratification rather than silently choosing (Rule 9: the model proposes, the human
  records the Type-1 decision — merge = authorise, edit = override). §3.3 → hard-pause on Type-1;
  §3.5 → `on_capability_absent` field, default engine behaviour, silent no-op forbidden.
- **`edge_config`-style structural enforcement of "requires token ∈ taxonomy"** is a gate check, not
  a schema constraint (JSON Schema cannot cross-reference within the doc); documented as the
  engine/gate's responsibility, mirroring how `contracts-v1` treats `live_test` resolution.
- **Capability thresholds in the doc example are a labelled starter policy**, not a prescribed
  requirement — the specific tokens/thresholds are the Coach's calibration.

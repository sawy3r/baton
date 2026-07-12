<!--
  qa-runbook.md — RENDERED from the release's records; do not hand-edit.
  Regenerated at cutover (after the assembly run passes) from:
    - each verified slice's reachability smoke-step (Rule 1)
    - the journeys this release touched (journeys-v1)
    - each slice's `delivered` list (proof-v1)
    - the new wire surfaces introduced (contracts-v1)
  Purpose: TARGET manual QA, not replace it — a focused walk of what changed
  and how to check it. Pairs with the attestation (attestations-v1): this is
  the input the human walks; the attestation is the output they sign.
-->

# QA runbook — 2026-05-20-billing-redesign

Release goal: *Billing and invoices redesign — self-serve plan changes.*
Assembly: **passed** (`assembly-proof.json`, verdict `pass`).
Walk these before attesting. Each item: what changed → how to check → expected.

## J02 — Existing customer changes plan

_Touched by: S01-plan-api, S03-plan-picker-ui, S05-downgrade-flow_

1. **Plan upgrade persists** _(S03 → S01)_
   - How: sign in as a pro-tier fixture, open Settings → Billing, pick a higher plan, confirm.
   - Expect: success toast; reload shows the new plan; `GET /api/billing/plan` returns the incremented version.
2. **Downgrade unloads scheduled add-ons** _(S05)_
   - How: from the same screen, downgrade to the base plan.
   - Expect: the "scheduled add-ons" panel clears; no error toast; the downgrade banner shows the effective date.
3. **Stale plan version is rejected** _(S01, contract C-02 If-Match)_
   - How: open Billing in two tabs, change the plan in tab A, then confirm the stale form in tab B.
   - Expect: tab B shows a "plan changed, please review" message (HTTP 412), not a silent overwrite.

## J05 — New customer hits the paywall

_Touched by: S02-flag-plumbing, S03-plan-picker-ui_

1. **Free-tier upgrade CTA opens the sheet** _(S03)_
   - How: as an anonymous/free fixture, click a locked premium control.
   - Expect: the upgrade sheet opens (heading "Unlock Premium"); no console error; no POST fired.

## New wire surfaces to spot-check _(contracts-v1)_

- **`PUT /api/billing/plan`** (C-01) — real-browser preflight: `OPTIONS` from the app origin returns 204 with `If-Match` in `Access-Control-Allow-Headers`. _(The class of seam a unit test can't see.)_
- **`billing_redesign_enabled`** flag (C-04) — confirm the redesign is actually gated by the flag, not always-on.

## Not covered by this walk

- Enterprise-seat proration (staging-only harness; excepted in the assembly proof).

---

**Sign-off:** when the walk passes against real infrastructure, record it in the attestation (`attestations-v1`), naming who walked it and against which runbook revision.

---
title: 'Slice spec template'
description: 'The contract the implementer is held to and the verifier checks against. One slice = one user-reachable outcome.'
---

# Slice: `<slice-id>`

> Copy this file to `docs/release/<release-name>/<slice-id>/spec.md`. Fill in every section. Empty placeholders are NOT acceptable — explicit "N/A" is.
> 
> **This spec is the implementer's sole contract.** Every implementation-relevant
> detail from the intake must be replicated here. An implementer who reads only
> this spec (never `intake.md`) must have everything needed to build the slice
> correctly. "See intake.md" is never a valid reference — the spec owns its
> detail completely.

## User outcome

`<One sentence. Names a user, a gesture, and an observable result. Example: "A pro user clicks Export PDF on the dashboard and receives a downloaded PDF; a free user clicks the same control and is shown the upgrade modal.">`

## Entry point

`<The route, page, API endpoint, or user gesture that triggers the outcome. Must be a concrete user-reachable surface. Example: "Button on /dashboard page with data-testid='control-panel-export-pdf'; backend endpoint POST /api/reports/export-pdf">`

## In scope

- `<List specific user-visible behaviour or contract changes>`
- `<Be explicit about which surfaces are covered>`

## Out of scope

- `<Adjacent functionality intentionally not covered>`
- `<Cross-slice work that must wait for its own slice>`

## Planned touchpoints

\<Files / modules expected to change. The verifier compares this against `git diff --name-only`. List specific paths, not "the web app."\>

- `src/app/...`
- `src/components/...`
- `src/lib/...`

## Acceptance checks

`<Bulleted, verifiable checks. Each must be falsifiable from artefacts the verifier can read.>`

- [ ] User can `<specific gesture>` and observes `<specific result>`
- [ ] API endpoint returns `<specific shape>` for `<specific input>`
- [ ] Gating prevents `<specific unauthorised case>`
- [ ] Tracking / audit / compliance requirement satisfied (cite specific requirement)

## Required tests

- **Unit**: `<test file path and name pattern>`
- **Integration**: `<test file path; must exercise the entry point per Rule 1>`
- **Reachability artefact**: `<screenshot path / Playwright spec path / explicit smoke-step description naming the user gesture>`
- **E2E gate type** (required when Playwright is listed): `local` (verifier can run; no persona creds needed) | `ci-authoritative` (persona/auth env vars required; test file must be committed with real assertions; execution + screenshot are CI/staging-gated — verifier checks committed spec + integration tests, not screenshot artefact)

## Risks

`<Concrete, named risks for this slice. Not generic. Example: "Webhook race condition between payment completion and entitlement write — verified by ordering test in TestWebhookOrdering">`

- ...

## Deferrals allowed?

`<Yes/No. If yes, under what conditions and tracked where. Defaults to No — Rule 2 surfacing required for anything carved out mid-implementation.>`

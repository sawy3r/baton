---
title: Release intake template
description: The discovery output document. Captures what the human described, what was decided, what was deferred. The slice list is downstream of this file.
---

# Release Intake: `<release-name>`

> Copy this file to `docs/release/<release-name>/intake.md` at the start of planning. Append to it across sessions. This is the durable record of the requirements conversation; if it disappears, the slice list is unanchored.
>
> **Naming convention:** `<release-name>` follows `YYYY-MM-DD-<theme>` where the date is planning-start (today). Examples: `2026-05-20-billing-redesign`, `2026-06-10-multi-currency`. See `role-prompts/planner.md` for rationale.

## Release goal

`<One paragraph. Written by the planner from the human's opening description and confirmed back to them. What user-visible outcome does this release deliver, why now, and what would "shipped" look like?>`

## Source of truth

- **Human stakeholder**: `<name / role>`
- **Tracking issue / epic**: `<GitHub issue link>`
- **Related captures**: \<links to prior session captures under `docs/captures/` (and historical captures from earlier tooling, if relevant)\>
- **Related memory entries**: \<list relevant `feedback_*` / `project_*` memory entries the planner consulted\>

## Users and their gestures

`<For each affected user type, name the gestures and the outcomes. Be specific about which user can do what.>`

- **Anonymous visitor**: ...
- **Free user**: ...
- **Premium user**: ...
- **Advisor**: ...
- **Admin**: ...

## What's currently broken or missing

`<The human's "this isn't working" / screenshot dumps go here. Quote them. Don't sanitise them — the verifier may need to reconstruct the original complaint to confirm a fix matches it.>`

- ...

## What the human wants

`<The human's "I want this" / wish list. Capture each as a discrete item, not as prose. Items here become candidate slice acceptance checks downstream.>`

- ...

## Constraints and non-negotiables

`<Domain constraints surfaced during the conversation. Examples (replace with your project's): privacy-law data minimisation, regional data residency, regulatory advice-language restrictions, encrypted-at-rest persistence per architecture decision records, third-party billing source-of-truth rules.>`

- ...

## Adjacent / out of scope

`<Things the human raised that are NOT in this release. Each must be a Rule 2 deferral: why, tracking link, acknowledgement that the human knows it's deferred.>`

- **Item**: `<description>`. **Why deferred**: `<reason>`. **Tracking**: `<issue/punch-list>`. **Acknowledged**: `<date>`.

## Decisions made during planning

`<Chronological log of decisions reached during planning conversations. Each decision must be re-statable in a commit message body per Rule 4. If a decision is reversed later, append the reversal rather than editing the original.>`

### `<YYYY-MM-DD>` — `<decision summary>`

- **Context**: `<what was being decided>`
- **Options considered**: `<briefly>`
- **Decision**: `<what was chosen>`
- **Why**: `<reason>`

## Schema-vs-spec audit notes

\<Per `feedback_spec_vs_schema_audit`: anything the human's description assumed about the data model that the planner cross-checked against the actual schema. Catches the failure mode where a brainstormed spec encodes plausible-but-wrong data assumptions.\>

- ...

## Proposed slice decomposition (draft)

`<Working draft of the slice list before specs are written. Iterates with the human during Phase 3 of the planner workflow. Once finalised, slices get their own folders and this section becomes historical reference.>`

- `S01-<name>` — `<one-sentence user outcome>`
- `S02-<name>` — `<one-sentence user outcome>`
- ...

## Ambiguity register

`<Every ambiguity surfaced during structured discovery. Each entry identifies what is unclear, where it matters (which user outcome or AC), and how it will be resolved. An unacknowledged ambiguity at decomposition time becomes a spec defect the verifier will BLOCKED on.>`

| # | Ambiguity | Affects | Resolution |
|---|-----------|---------|------------|
| A-01 | `<what is unclear>` | `<which outcome / AC>` | `deferred to implementation` or `requires spike` or `human will provide by <date>` |

`<Ambiguities deferred to implementation are acceptable only when explicitly acknowledged here. Those marked "human will provide" must have a concrete deadline.>`

## Screenshots / references

`<Inline screenshot paths if available, or links to where they live. Image-heavy intakes are fine — the planner is conversational by design.>`

- `docs/release/<release-name>/screenshots/<filename>.png` — `<one-line description of what the screenshot shows>`

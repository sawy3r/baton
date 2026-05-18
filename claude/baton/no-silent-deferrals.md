---
title: Rule 2 — No Silent Deferrals
description: Inline "deferred" comments are rationalisations, not decisions, unless they carry why + tracking + acknowledgement
---

# Rule 2 — No Silent Deferrals

## The rule

An inline code comment marking something as "deferred" / "later" / "future" / "TODO" is **not a decision**. It becomes one only when all three of the following are present:

1. **Why** — a concrete reason the deferral is necessary (framework limitation, blocking dependency, explicit scope cut). Not "we ran out of time on this PR."
2. **Tracking** — a linked GitHub issue, plan task, or punch-list item that the decision lives in. Not just the inline comment.
3. **Acknowledgement** — the user, product owner, or decision-maker has been told, in plain text, that this item is being deferred.

Without all three, the inline comment is dark code's data-model cousin: it looks tracked, isn't.

## Why

The v0.5.0 audit traced six schema-level "deferrals" in inline header comments. Of the six, **only one had a real framework-level reason**. The other five were silent absences dressed up as decisions:

- "Land later when Detailed mode UI is wired" — Detailed mode itself was unbuilt and unscheduled.
- "Cross-field deferred (see header)" — PPOR-only version existed; per-IP version simply never written.
- "Deferred to a later phase" — no specific reason given; scope management punt.
- Several entire entities (Property Expense per-item, Credit Facility, Investment Account, Other Asset, HECS-HELP, five action types) had no schema at all — "deferred" in the team summary but in fact never started.

The decision-maker had not been told about any of them. They surfaced only when an audit grepped the schema headers.

## How to apply

- **Before writing `// deferred` / `// later` / `// future` / `// TODO`** on a schema rule, contract surface, or other publicly-consumed declaration: surface the decision to the user first. Get explicit acknowledgement. Create a tracking item. Then write the comment, with the tracking ID in the comment.
- **Pattern to use:** `// deferred: <reason> — tracked at <issue/plan-id>`. If you can't fill both blanks honestly, you don't have a deferral, you have a punt.
- **When reviewing code** with bare `// deferred` / `// TODO` and no linked tracking: flag it. The comment author owes you the why + tracking + acknowledgement chain.
- **At phase / sprint boundaries:** grep your changeset for "deferred", "later", "future", "TODO". For each hit, verify all three conditions are met. Any failure becomes a tracked item or gets resolved before close.

## The schema-cousin pattern

Silent deferrals show up most often where types or contracts publish a promise that the implementation doesn't keep. Examples:

- A schema declares a field but no rule validates it.
- An engine input type comment says "computed via X" but no calc-X function exists.
- A type union enumerates cases the matching switch doesn't handle.
- A public function signature accepts a parameter that's silently ignored.

The reachability gate (Rule 1) catches the UI version of this; this rule catches the *contract-published* version. Both are forms of dark code.

## The UI-label cousin

The rule originated against `// deferred` code comments. The same three-component requirement applies to **user-visible labels** that announce future work:

- Dropdown rows labelled `(coming soon)` or `(deferred)` shipping behind a disabled state.
- "Available in a future release" empty-state messages.
- Tooltip hints saying "Feature X — not yet supported."
- Inline footer text on form sections: "Note — Y will be added later."

Each of these is a public promise that something specific is *not* shipped. Each one requires the same three components — why + tracking + acknowledgement — or it falls back to the same failure mode: a rationalisation dressed as a decision, surfaced only on audit.

### Concrete case

A surplus-allocation editor shipped four rule-kind rows in a target dropdown labelled `(coming soon)` / `(deferred - future portfolio release)`. The reachability-gate verifier failed the slice because the rows existed in the UI without slice-local tracking — no `proof.md § "Not delivered"` entry, no cross-reference to the canonical Rule 2 surfacing elsewhere in the project.

Remediation: `proof.md` was extended with a section enumerating each disabled row, cross-referenced to the existing canonical deferral docs. The labels were honest; the slice's own surfacing of them was missing.

### How to apply to UI labels

Same triple, same discipline:

1. **Why** — concrete reason the row / message / tooltip ships in its disabled / future-promise form.
2. **Tracking** — link to the slice, issue, or audit doc that owns the deferred work.
3. **Acknowledgement** — surfaced in the slice's `proof.md § "Not delivered"` for the slice that ships the label.

If the user-facing label promises work that isn't tracked, the label is dishonest in the same way a `// deferred` comment with no tracking is dishonest. Same remediation: track it or remove the promise.

## Symptoms to grep for

After any sprint that touches schemas, contracts, or public APIs:

```bash
grep -rn "deferred\|TODO\|FIXME\|later\|future" packages/ apps/*/lib/ | \
  grep -v "\.test\." | grep -v "node_modules" | grep -v "\.next"
```

For each hit, ask: is this tracked, why, and was the user told?

## Provenance

the source project v0.5.0 audit (May 2026) found 6 silent deferrals in `packages/fire-validation/src/schemas/` header comments. User's reaction when surfaced: "I'm not sure why these were deferred, I don't remember making that call." The pattern was rationalisation, not decision. The fix (this rule) makes the rationalisation impossible by demanding the three conditions up front.

# Contributing to Baton

Baton is a protocol — rules, role contracts, record schemas, and templates. The "API" is the
contract adopters build their process on, so changes are governed, versioned (see
[`RELEASING.md`](RELEASING.md)), and biased toward additive-with-advisory rollout.

## Feedback from reference engines

Baton specifies; a conformant **engine** (the open `sworn` reference implementation, or any other)
runs the gates. Engines are where the protocol meets reality, so they are Baton's most valuable
source of feedback — but only if that feedback reaches the protocol instead of being buried as an
engine bug. The loop below makes the hand-off a formal, repeatable path rather than tribal memory.

1. **Triage at the source.** Every engine dogfood or session finding is tagged **`protocol`** or
   **`engine`** in its own capture doc, with one line of ownership rationale. A finding is
   `protocol` when the durable fix changes a rule, a role contract, or a schema — not when it
   changes engine code. (Litmus: "would another conformant engine hit this too?" → `protocol`.)
2. **Route.** `engine` findings become issues in the engine's own tracker. `protocol` findings
   become Baton issues labelled **`dogfood-feedback`**, each **linking back to the engine capture**
   that grounds it, so every proposed change carries its empirical evidence.
3. **Triage into a version.** Baton owns the contract (ADR-0010): it reviews each `dogfood-feedback`
   item on the evidence, ratifies or amends, and lands the accepted set into a version. The engine
   re-vendors on the VERSION-pin bump and implements against the ratified contract. Nothing an
   engine proposes is imposed on the protocol; nothing the protocol ratifies is optional for a
   conformant engine.
4. **Durability.** The loop is itself stable reference: the engine writes an ADR, Baton lands the
   contract change plus this note, so a future maintainer can reconstruct *why* a rule moved from
   the evidence, not from memory.

The exemplar is the first instance: sworn's 2026-07-12 dogfood → Baton epic
[#62](https://github.com/sawy3r/baton/issues/62) (capability policy + Rule 9/10/11 refinements),
grounded in the sworn capture `docs/captures/2026-07-12-baton-handoff-capability-policy-and-protocol-updates.md`.

## What bumps a version

See [`RELEASING.md`](RELEASING.md). In short: a new rule / role / schema / check type is a **minor**;
wording, clarifications, and additive templates are a **patch**; a removed or redefined rule, role,
or contract is a **major**. Tie-breaker: does an existing adopter have to *do* anything to stay
correct? If yes, at least a minor.

## Ground rules

- **Records vs prose.** Anything a role parses to make a decision is a schema-validated JSON record;
  anything authored for humans is Markdown the machine never parses. Don't hand-edit a record's
  structure as text, and don't keep a second hand-written copy of the same facts.
- **Additive-first.** New records and rule clauses land optional-with-advisory where possible, and
  flip to required only when the corresponding gate ships — so a protocol/engine version skew is a
  visible warning, not a silent behaviour gap.
- **Validate before you commit** any schema change against its examples, positive and negative.

## Contract tests

Protocol schema tests use Python 3, Git, and the development-only dependency declared in
`tests/requirements.txt`. The Git-backed lifecycle fixture creates only temporary local repositories
and requires no network access:

```bash
python3 -m pip install -r tests/requirements.txt
python3 -m unittest discover -s tests -v
```

The runtime protocol remains data-only; this dependency is required only to validate JSON Schema
2020-12 fixtures during Baton development.

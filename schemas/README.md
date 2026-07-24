# Baton schema

Baton RC2 has one authored JSON Schema:

- [`work-status-v1.json`](work-status-v1.json) validates the sole durable
  projection for both work and release assembly.

`plan.md`, `design.md`, and `proof.md` remain concise Markdown. Plan metadata is
a closed strict-JSON `baton-plan-v1` block parsed by the reference record
validator; it is deliberately not a second JSON Schema.

Schema validity is necessary but not sufficient. Cross-field bindings,
responsibility separation, transitions, ownership, Git identity, and
compare-and-set rules are enforced by `reference/records/` and the conformance
suite.

# Baton RC2 schema

Baton RC2 has one authored JSON Schema:

- [`work-status-v1.json`](work-status-v1.json) validates the sole durable
  current projection for either one planned work item or the assembled release.

The other three handoffs are exact Markdown:

- `plan.md` contains one closed strict-JSON `baton-plan-v1` metadata block;
- `design.md` records the Implementer’s approach and evidence plan; and
- `proof.md` binds acceptance evidence to one exact candidate.

Plan metadata is parsed by the reference record validator; it is deliberately
not a second JSON Schema.

Schema validity alone cannot prove a Baton transition. The reference record and
Git actions additionally enforce plan and approval digests, responsibility
separation, exact handoff bytes, state transitions, ref ownership, candidate
and product identity, track composition, assembly components, and target
compare-and-set behavior.

`baton.board/v1` is a read-only projection contract produced from captured refs
and records. It is not another status schema, an editable database, or an action
surface.

See the [RC2 walkthrough](../examples/README.md) for work and assembly status
examples in context. Executable positive and negative fixtures live in
[`../conformance/fixtures/`](../conformance/fixtures/).

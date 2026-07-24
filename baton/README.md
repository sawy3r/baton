# Baton 1.0 RC2 protocol

Baton is the protocol and portable kit; an engine such as Sworn orchestrates it.
The shortest useful path through the normative documents is:

1. [CORE.md](CORE.md) — five principles for a trustworthy “done” claim;
2. [PROTOCOL.md](PROTOCOL.md) — five responsibilities, lifecycle, records,
   track composition, assembly, and exact release Merge;
3. [ASSURANCE.md](ASSURANCE.md) — what guided use requires and what an
   autonomous engine must additionally prove; and
4. [CONFORMANCE.md](CONFORMANCE.md) — observable portable and engine
   obligations.

[RATIONALE.md](RATIONALE.md) explains why RC2 keeps the useful guarantees from
Baton 0.x while removing universal ceremony.

The portable kit puts the protocol into practice with:

- five canonical documents in [`../operations/`](../operations/);
- generated Claude Code and Codex Skills with identical canonical bytes;
- `plan.md`, `design.md`, and `proof.md` templates;
- one strict [`work-status-v1.json`](../schemas/work-status-v1.json) schema;
- admitted record and Git actions;
- a JSON oracle, terminal renderer, and loopback GET-only WebUI; and
- one role-independent process-driver contract.

The normal handoffs are:

```text
plan.md -> design.md -> proof.md -> status.json
```

`status.json` is the sole durable projection for either work or assembly. The
board is derived from captured refs and records; it is not another status
schema and cannot authorize an action.

The common driver does not manage inference. An engine chooses a driver and an
explicit model string or `null` for every Planner, Implementer, Captain,
Verifier, or Merge invocation. Baton bundles no model, provider account,
fallback policy, or credentials.

Final `v1.0.0` requires a real engine to pass the 12 autonomous cases. RC2’s
portable profile passes, while those engine cases truthfully remain `NOT RUN`.

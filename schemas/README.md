# Baton receipt schema

Baton's authored JSON Schema is
[`receipt-v1.json`](receipt-v1.json). It bounds the compact receipt envelope
and its role-specific evidence fields. The reference validator additionally
enforces canonical one-line JSON, allowed role/result pairs, required evidence
for each result, and exact detail hashing.

One receipt is stored in the final `Baton-Receipt:` trailer of a metadata-only
Git commit:

```text
<subject>

Baton-Detail-Begin
<exact role detail bytes>
Baton-Detail-End

Baton-Receipt: <canonical receipt-v1 JSON>
```

The plan is not a second JSON Schema. `plan.md` begins with one closed
`baton-plan-v2` strict-JSON block and then explanatory Markdown. The reference
validator binds the exact complete file as a Git blob, derives each slice
contract, and checks the forward-only `revision` / `previous_plan` chain.

Schema validity alone cannot prove a Baton result. The reference records and
Git actions also enforce approval, role separation, plan and contract binding,
attempt ordering, candidate and product-tree identity, dependency inputs,
metadata-only receipt commits, fresh verification, deterministic composition,
and target compare-and-set.

The board has no authored status schema. It is a read-only projection derived
from the current plan, valid receipts, and captured Git objects.

See the [lightweight walkthrough](../examples/README.md) for compact receipt
commits in context. Executable positive and negative fixtures live in
[`../conformance/fixtures/`](../conformance/fixtures/).

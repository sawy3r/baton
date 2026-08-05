# Baton receipt schema

A Baton receipt is a small saved note about a decision or result. Its readable
part explains what happened; its machine-readable part connects that outcome
to the exact plan, work, and evidence.

Baton's JSON Schema is [`receipt-v1.json`](receipt-v1.json). The technical
rules below keep every receipt small and unambiguous.

One receipt is stored in the final `Baton-Receipt:` trailer of a metadata-only
Git commit:

```text
<subject>

Baton-Detail-Begin
<exact role detail bytes>
Baton-Detail-End

Baton-Receipt: <canonical receipt-v1 JSON>
```

The plan is not a second JSON Schema. Legacy v2 `plan.md` files begin with one
closed `baton-plan-v2` strict-JSON block. New v3 plans keep a release skeleton
in `plan.md` and put each slice contract in one declared `slices/<id>.md` file,
using a closed `baton-slice-v1` block. The reference validator binds the
skeleton plus every declared slice blob, derives each slice contract, and checks
the forward-only `revision` / `previous_plan` chain. A missing, extra, or
digest-mismatched slice file is invalid.

Human-readable evidence is separate from the governed plan. Projects may keep
slice bundles under the configured release-docs root (default
`docs/baton/releases`) at `<release>/slices/<id>/`. Set `release_docs_root` in
`~/.config/baton/config.json` for a user-wide standard, or override it in the
project's `.baton/config.json`. An
`evidence.json` file may inventory the bundle, but it is advisory and is not a
strict Baton schema.

Schema validity alone cannot prove a Baton result. The reference records and
Git actions also enforce approval, role separation, plan and contract binding,
attempt ordering, candidate and product-tree identity, dependency inputs,
metadata-only receipt commits, independent read-only verification,
deterministic composition, and target compare-and-set.

The board has no authored status schema. It is a read-only projection derived
from the current plan, valid receipts, and captured Git objects.

See the [lightweight walkthrough](../examples/README.md) for compact receipt
commits in context. Executable positive and negative fixtures live in
[`../conformance/fixtures/`](../conformance/fixtures/).

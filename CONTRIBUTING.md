# Contributing to Baton

Baton optimizes for a small, stable trust kernel. A contribution should reduce
interpretation or add evidence, not teach every future agent another procedure.

## Admission test

Before changing normative text, answer:

1. Which of B1-B5 is currently impossible to enforce?
2. Why can this not be a deterministic engine invariant, project check, or
   assurance pack?
3. Which conformance mutation fails before the change and passes after it?
4. What existing wording or mechanism can be removed in exchange?

Incident provenance is welcome, but an incident alone does not justify a
universal rule.

## Budgets

- `baton/CORE.md`: at most 1,000 words.
- All normative Baton documents combined: at most 6,000 words.
- Current delivery-record schemas: four. Adding a fifth requires showing that
  combining it with an existing record would create conflicting authority or
  lifecycle.
- Universal model calls on the happy path: builder plus verifier.

## Schema changes

Schemas are strict. Add or change a field only with:

- a positive fixture;
- at least one relevant negative fixture;
- any required cross-record scenario in `conformance/manifest.json`; and
- an explanation of whether the change is compatible under the versioning
  policy.

Do not encode a mutable workflow state in a canonical record. The board is a
derived view.

## Pull requests

Keep changes narrow. Run:

```sh
python3 conformance/check.py
```

Also check the normative word budget and JSON formatting. A reference-engine
change belongs in Sworn, not here.

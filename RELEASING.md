# Releasing Baton

Baton uses semantic versioning for the normative protocol and record schemas.

- **Major** — a principle changes, a required record or field is removed, an
  outcome changes meaning, or old conforming behavior becomes non-conforming.
- **Minor** — an optional capability or backward-compatible schema version is
  added.
- **Patch** — wording, examples, fixtures, or clarifications change without
  changing conforming behavior.

## Release checklist

1. Confirm `VERSION` matches the intended tag.
2. Run `python3 conformance/check.py`.
3. Confirm every JSON file parses and every schema passes meta-validation.
4. Confirm `CORE.md` is at most 1,000 words and the full normative surface at
   most 6,000 words.
5. Run the manifest against the compatible Sworn candidate.
6. Review the diff from the previous tag for accidental new ceremony or
   compatibility claims.
7. Tag the exact reviewed commit as `v<version>` and publish release notes that
   identify schema and conformance changes.

A portable run that reports real-boundary cases as `NOT RUN` does not satisfy
step 5. Do not tag final `v1.0.0` until one real engine passes every published
engine case through its actual binary and boundaries.

## The 1.0 cut

`v0.16.0` is the immutable Baton 0.x archaeology point. Baton 1.x does not read,
migrate, or silently reinterpret 0.x records. Engines must report an explicit
unsupported-protocol error.

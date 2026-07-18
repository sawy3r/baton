# Protocol-history retirement verification repair

Issue: sawy3r/baton#80

Immutable verifier finding: `docs/captures/2026-07-18-protocol-history-retirement-verification.md` at commit `9dfb256`

## Finding 1: typed Verifier evidence identity

The `protocol_history_invalid` verification violation now requires a strict machine-readable object containing `disposition` and the complete typed `invalid_history` array. The same schema definition is reused by retirement. Free-text evidence is supplementary only.

`retirement.verifier_verdict` now pins only the Verifier status commit, physical status path and blob OID. A conformant gate resolves that exact blob, reads its BLOCKED result, fresh-context session and timestamp, and requires its typed evidence to equal retirement evidence structurally. Removing duplicated result/session/time fields eliminates divergent copies that JSON Schema could not equate.

Negative schema fixtures prove gate-only evidence, missing schema identity and missing verdict path fail validation. The Git-backed conformance fixture separately proves evidence and verdict-reference mismatches fail the lifecycle predicate.

## Finding 2: real Git lifecycle reachability

`tests/protocol_history_git_fixture.py` creates a temporary Git repository and commits this lifecycle with real object identities:

1. immutable baseline and pinned schema blob;
2. schema-invalid historical status plus authored semantic change;
3. current-valid implementation status;
4. fresh typed Verifier BLOCKED status;
5. Planner retirement preserving the exact maintainability JSON byte span;
6. mandatory rollback planning, semantic restoration and fresh verification;
7. functional replacement start after rollback verification.

The fixture walks first-parent history, resolves every cited blob, validates the historical status against the pinned schema, recomputes deterministic error fingerprints, compares typed Verifier and retirement evidence, compares maintainability byte spans, derives the complete non-record path envelope commit-by-commit, and compares exact mode/object tuples with the immutable start tree.

Committed negative branches cover:

- missing and wrong rollback ids;
- rollback out of track order or deferred;
- content and executable-mode tree mismatches;
- Verifier/retirement evidence and object-identity mismatches;
- maintainability byte mutation;
- replacement started before rollback verification;
- an ordinary schema-valid record relabelled as invalid history.

Each negative branch is exercised independently through the merge-track, merge-release and mark-shipped predicate entry points. The legal history reaches all three only after exact verified rollback. Separate outer-gate cases prove release merge ancestry and deployed-release requirements do not collapse into track readiness.

## Validation

- `python3 -B -m unittest discover -s tests -v`: 9 tests pass.
- Draft 2020-12 metaschema validation: all schemas pass.
- JSON parsing: all schemas, templates and fixtures pass.
- Installer shell syntax and scratch install parity: pass.
- Git diff/check and cache audit: pass.

The original verifier FAIL remains unchanged. This capture records only the repair and fresh re-verifier handoff.

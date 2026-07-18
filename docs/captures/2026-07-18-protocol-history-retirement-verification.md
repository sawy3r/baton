# Protocol-history retirement adversarial verification

Issue: sawy3r/baton#80

Branch: `feat/protocol-history-retirement`

Tested head: `3b741c5dd2e69d76a4577a0747b05c0293567b8b`

Base: `origin/main` at `aae82d1cb8c28085ab20668c720f0282048dcc09`

Verdict: **FAIL**

This was a fresh-context review of the live `origin/main...HEAD` diff, issue #80, contribution and release guidance, the complete changed schema and fixture, and every normative role, command, integration, and shipping surface named by the change.

## Numbered violations

1. **The immutable Verifier evidence identity is not machine-reproducible from the pinned BLOCKED status.**

   The normative contract says the fresh Verifier status must cite the same exact invalid-history evidence later copied into `retirement.invalid_history`, and that merge gates must reproduce and compare those identities. The schema only requires a violation object whose `gate` equals `protocol_history_invalid`. Its evidence remains an unconstrained free-text string. The positive fixture therefore records only a commit and status blob in prose, omitting the status path, schema id, schema blob OID, and validation-error fingerprints. The schema also does not couple `retirement.verifier_verdict.verifier_session_id` or `verifier_verdict_at` to the corresponding fields in the pinned verification object.

   Reproduction probe against the branch schema:

   ```text
   gate-only-verifier-evidence: schema_valid=True
   mismatched-verdict-session: schema_valid=True
   mismatched-verdict-time: schema_valid=True
   ```

   A conformant engine cannot deterministically compare the retirement evidence with the pinned Verifier evidence without inventing an unspecified parser for prose. Consequently, the immutable verifier/evidence identity and the ordinary-failure fail-closed boundary are not encoded by the record contract.

   Required correction: add a strict machine-readable evidence object to the `protocol_history_invalid` verification violation, containing the exact invalid-history identities and fingerprints, and add schema/test constraints or a deterministic fixture assertion that the retirement record matches that pinned evidence and verifier identity exactly.

2. **The required lifecycle reachability and negative coverage is a Boolean model, not a deterministic protocol fixture.**

   `test_integration_and_replacement_reachability_vectors` calculates readiness directly from four fixture booleans and compares the result with two expected booleans. The fixture uses invented object ids that do not resolve to Git objects. It never creates or walks committed status history, validates an actually invalid historical blob against a pinned schema blob, compares the Verifier status blob, checks byte spans, derives authored paths, proves rollback tree mode/object equality, checks track order, or attempts a replacement before and after rollback verification.

   The independent merge-track, merge-release, and mark-shipped coverage only asserts that each Markdown surface contains the words `protocol_history_invalid` and `rollback`. It would remain green if a surface omitted identity matching, sequential ordering, tree equality, byte preservation, or ordinary-failure exclusion.

   This does not prove issue #80's reachability requirement: the original must remain unmergeable without its verified rollback, become integration-ready only with exact tree equality, and allow a replacement only after rollback. It also does not prove that merge-track, merge-release, and shipping independently enforce the contract.

   Required correction: add a deterministic Git-backed fixture or equivalent conformance harness with real commits/blobs and negative cases for missing rollback, wrong rollback id, rollback out of order, rollback deferred, tree mismatch including mode/object changes, verifier/retirement identity mismatch, maintainability-byte mutation, replacement before rollback verification, and ordinary failure relabelling. Exercise the three integrator surfaces independently rather than testing for keywords.

## Contract surface assessment

- **Eligibility:** prose consistently limits retirement to current-valid, immutable earlier schema-invalid lifecycle history and excludes ordinary spec, delivery, test, environment, unavailable-gate, and maintainability failures.
- **Evidence:** `retirement.invalid_history` has strict commit/path/blob/schema/fingerprint fields and the fingerprint algorithm is deterministic, but violation 1 breaks the identity handoff from the Verifier.
- **Maintainability preservation:** the retirement record is top-level; normative surfaces require the complete maintainability value and JSON byte span to remain byte-identical to the pinned BLOCKED verdict. The positive test only proves that mutating a separate Python dictionary does not mutate maintainability, not historical byte preservation.
- **Mandatory rollback and replacements:** Planner, Implementer, track mode, and merge-track prose require the named rollback, exact start-tree equality, and replacement ordering. Violation 2 leaves those requirements mechanically unproved.
- **Independent integration gates:** merge-track, merge-release, and mark-shipped each state the intended gate. Violation 2 leaves their independent enforcement unproved.
- **Install parity:** both installers copied `slice-status-v1.json` byte-for-byte; Claude copied commands and schemas byte-for-byte; Codex installed all eight skills and contained no stale Claude Baton paths.

## Commands and results

All commands ran from `/home/brad/projects/baton-worktrees/protocol-history-retirement` at the tested head.

```text
python3 -m unittest discover -s tests -v
Ran 6 tests in 0.013s
OK

Draft202012Validator.check_schema over all 18 schemas
PASS

JSON parse validation over all release-mode templates and fixtures
PASS

bash -n install-claude.sh install-codex.sh
PASS

jq empty schemas/*.json baton/release-mode-template/*.json tests/fixtures/*.json
PASS

git diff --check origin/main...HEAD
PASS

Claude and Codex scratch installs plus source/install byte comparisons
PASS
```

Green tests do not override the two contract violations above.

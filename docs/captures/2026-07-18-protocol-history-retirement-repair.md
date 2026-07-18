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

- `python3 -B -m unittest discover -s tests -v`: 10 tests pass.
- Draft 2020-12 metaschema validation: all schemas pass.
- JSON parsing: all schemas, templates and fixtures pass.
- Installer shell syntax and scratch install parity: pass.
- Git diff/check and cache audit: pass.

The original verifier FAIL remains unchanged. This capture records only the repair and fresh re-verifier handoff.

## Second repair: chronology and qualifying envelope

Second immutable verifier finding: `docs/captures/2026-07-18-protocol-history-retirement-reverification.md` at commit `06b7fb5`.

External Gate Warden input against implementation head `6aff4fad` confirmed the first repair's P1 boundaries remain closed: Verifier/retirement evidence is strictly typed and exactly matched, and reachability uses real Git commits/blobs rather than Boolean or fake-OID vectors. Those surfaces were not redesigned.

The Warden's remaining P2 identified that a retirement record must not exist without a trustworthy semantic envelope. The schema now requires retirement to carry byte-preserved `maintainability.state: passed`, a concrete `implementation_head`, a non-empty report ledger and a PASS. The canonical evaluator additionally requires the newest report to be PASS and to pin that exact head. Schema fixtures and committed Git branches reject pending maintainability, a null head and an empty/insufficient ledger while keeping retirement outside the maintainability object.

The second fresh verifier found a separate chronology false-positive. The Git fixture now includes its exact counterexample on a real first-parent branch: rollback planning, exact restoration and verification, then replacement start, followed only afterward by retirement. The canonical evaluator locates the first committed retirement transition, first rollback status, first qualifying authoritative rollback PASS and every replacement `start_commit`. It requires retirement before rollback planning and verification and requires replacements to start only after the qualifying rollback verdict. The late-retirement branch is asserted to fail merge-track, merge-release and mark-shipped independently.

The normative track, Planner, Implementer, replan and three integration/shipping contracts carry the same passed-envelope and first-parent chronology requirements. Current board order and terminal states are explicitly insufficient.

Both immutable FAIL captures, at `9dfb256` and `06b7fb5`, remain byte-identical. This second repair changes only the bounded chronology and eligibility findings.

## Gate Warden repair: owner binding, historical verdict validity and strict chronology

The second Gate Warden pass found three remaining ways ordinary reachability could be mistaken for protocol authority. This bounded repair closes them without changing the disposition's scope.

Every `invalid_history` record is now bound to its owning retired slice. Its `status_path` must be the owner's exact physical status path, the parsed historical status must carry the owner's exact `slice_id` and `release`, and the evidence commit must occur strictly on the owner's first-parent history before the pinned Verifier verdict. A commit reachable only through a merge's second parent is not evidence authority. Real Git branches exercise an unrelated slice status, an unrelated release status and a same-slice second-parent-only status through all three integration predicates.

The pinned fresh Verifier status is now itself historical evidence. Parsing rejects duplicate JSON keys; the exact owner path/blob is resolved; the status commit must lie strictly on first-parent history before retirement; and the whole status must validate against the governing schema stored at that commit before its BLOCKED result, fresh identity and typed evidence are accepted. Real Git branches prove that a schema-invalid BLOCKED-looking status cannot be masked by a later valid deferred status, a duplicate-key verdict cannot be reinterpreted, and a valid verdict reachable only through a second parent cannot authorise retirement.

Chronology is now strict rather than non-strict ancestry. The retirement transition, rollback first-status commit, authoritative rollback verdict and each functional replacement `start_commit` must be distinct and strictly ordered on first-parent history. The real Git fixture includes the exact combined retirement plus rollback-first-status commit and proves merge-track, merge-release and mark-shipped all reject it. The legal fixture now uses a separate replacement planning anchor after the rollback verdict.

The canonical LLM checks, track contract, Planner/replan, Implementer, Verifier and all three integration/shipping command contracts state the same owner identity, duplicate-key, historical-schema and strict first-parent mechanics. The earlier FAIL reports remain byte-identical; their hashes are rechecked before commit.

Warden repair validation:

- `python3 -B -m unittest discover -s tests -v`: 14 tests pass.
- Draft 2020-12 metaschema validation: all 18 schemas pass.
- Duplicate-key-aware JSON parsing: all 19 schema, template and fixture JSON files pass.
- Installer shell syntax and isolated scratch parity: pass; 18 schemas are byte-identical in each install, all eight Claude commands are byte-identical, all eight Codex skills are present, and no stale Claude Baton paths remain in Codex output.
- `git diff --check` and Python cache audit: pass.

## Gate Warden repair: replacement owner-chain membership and total typed evidence

The third Gate Warden pass found two narrow totality gaps. First, strict ordering against a replacement `start_commit` did not separately state that the referenced commit itself belongs to the evaluated owner tip's first-parent history. The evaluator now emits stable failure `replacement-start-not-on-owner-first-parent` when an otherwise ordered anchor is reachable only through a merge's second parent. A real Git branch creates that exact side-branch anchor, merges it as parent two, references it from the owner replacement status, and proves merge-track, merge-release and mark-shipped all reject it.

Second, the pinned historical verdict path validated the whole status but continued into typed evidence using an object-only assumption. Historical verdict evaluation now type-guards the parsed status, verification object, violations array, each violation and the typed `protocol_history_invalid` value. Missing, null, scalar and list values fail closed with stable `verdict-status-invalid` and `verifier-retirement-evidence-mismatch` findings rather than raising an exception. The exact gate-only violation and the adjacent malformed shapes are committed as real Git histories and exercised through all three integration predicates.

Normative LLM checks, track, Planner/replan, Implementer and the three integration/shipping contracts now explicitly require owner-tip first-parent membership for each replacement start and deterministic failure for missing or non-object pinned typed evidence. This is a totality repair only; it does not broaden the retirement disposition.

Third Warden repair validation:

- `python3 -B -m unittest discover -s tests -v`: 16 tests pass.
- All 18 schemas pass Draft 2020-12 metaschema validation; all 19 schema, template and fixture JSON files pass duplicate-key-aware parsing.
- Installer shell syntax and isolated scratch parity pass: 18 schemas are byte-identical in each install, all eight Claude commands are byte-identical, all eight Codex skills are present, and Codex output contains no stale Claude Baton paths.
- `git diff --check`, Python cache audit and immutable FAIL-report hash checks pass.

## Gate Warden repair: structural raw-value extraction and pinned replay authority

The fifth Gate Warden pass replaced textual JSON member search with a duplicate-aware structural extractor. The extractor validates the entire document for malformed JSON and duplicate members at every depth, walks only the root object with JSON decoder offsets, and returns the exact UTF-8 bytes of the sole requested top-level value. It understands strings and escapes plus nested arrays/objects, ignores nested or escaped decoys, and distinguishes missing members from null values. Both retirement replay and maintainability byte comparison use it.

Focused adversarial vectors cover nested retirement decoys, escaped strings, surrounding and internal whitespace, null, arrays, objects, missing members, duplicate top-level keys and duplicate nested keys. A real schema-valid status places an old retirement object under a top-level decoy before the real key, mutates the real top-level retirement, then restores it while preserving the decoy. Structural replay detects `retirement-history-mutated`; merge-track, merge-release and mark-shipped all reject it.

Retirement baseline discovery now walks every branch-pinned owner status version chronologically and duplicate-aware parses/tokenises each one. Malformed JSON, duplicate keys or tokenisation failure returns stable `owner-status-history-malformed` immediately and cannot be skipped to a later corrected baseline. Parseable schema-invalid lifecycle records remain available as the exact evidence this disposition exists to retire. A real history commits a duplicate-key first retirement with the wrong rollback id, follows it with a corrected valid record, and is rejected across all integration predicates.

Merge-release and mark-shipped now duplicate-aware parse and schema-validate every current status before reading `state`, `retirement.disposition` or any other shape-dependent field; invalid records stop as `current-status-invalid`. Merge-track keeps the board oracle as sole ownership/topology authority, then permits only exact owner-ref-pinned `git show`, first-parent history and commit-pinned tree/blob/mode reads for retirement replay and evidence validation. Unpinned filesystem rereads, revision expressions and cross-ref fallback remain forbidden.

The canonical checks, track contract, Planner/replan, Implementer and three integration/shipping contracts mirror the same structural extraction, malformed-history and pinned-read boundary. This is a bounded mechanical hardening only.

Fifth Warden repair validation:

- `python3 -B -m unittest discover -s tests -v`: 21 tests pass, including the focused structural-tokenizer and real-Git adversarial cases.
- All 18 schemas pass Draft 2020-12 metaschema validation; all 19 schema, template and fixture JSON files pass duplicate-key-aware parsing.
- Installer shell syntax and isolated scratch parity pass: 18 schemas are byte-identical in each install, all eight Claude commands are byte-identical, all eight Codex skills are present, and Codex output contains no stale Claude Baton paths.
- `git diff --check`, Python cache audit and immutable FAIL-report hash checks pass.

## Gate Warden repair: history-wide retirement immutability and current-status totality

The fourth Gate Warden pass identified that retirement immutability must be replayed across history, not inferred from the first and current snapshots. The evaluator now captures the exact raw JSON value bytes of `retirement` at the first retirement transition, walks every later owner status version on first-parent history through the evaluated tip, and requires exact byte equality at each version. This rejects removal/nulling and every field rewrite, including rollback id, evidence, acknowledgement, tracking and rationale changes. Because every intermediate version is checked, mutate-then-restore cannot erase the violation.

Two real Git histories exercise the boundary through all three integration predicates. One begins with the wrong rollback id, completes the real rollback and replacement, then retroactively rewrites retirement to name the real rollback. The other changes rationale transiently and restores the original bytes before the evaluated tip. Both fail with stable `retirement-history-mutated` evidence despite a valid-looking current record.

Current status validation is now a total precondition. After duplicate-aware parsing, any `slice-status-v1` error returns immediately with only `current-status-invalid`; no retirement or maintainability shape is dereferenced. Real Git cases set `retirement.invalid_history` and `maintainability` to null and prove deterministic false results without exceptions across merge-track, merge-release and mark-shipped.

The canonical checks, track, Planner/replan, Implementer and all integration/shipping contracts now state the same history-wide raw-byte replay and immediate current-schema-invalid rejection. This remains a bounded fail-closed repair and does not alter the retirement schema or disposition.

Fourth Warden repair validation:

- `python3 -B -m unittest discover -s tests -v`: 18 tests pass.
- All 18 schemas pass Draft 2020-12 metaschema validation; all 19 schema, template and fixture JSON files pass duplicate-key-aware parsing.
- Installer shell syntax and isolated scratch parity pass: 18 schemas are byte-identical in each install, all eight Claude commands are byte-identical, all eight Codex skills are present, and Codex output contains no stale Claude Baton paths.
- `git diff --check`, Python cache audit and immutable FAIL-report hash checks pass.

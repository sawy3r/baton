# Protocol-history retirement adversarial reverification

Issue: sawy3r/baton#80

Branch: `feat/protocol-history-retirement`

Tested implementation head: `6aff4fadc608a81e2aad793111686dbfdc90060e`

Base: `origin/main` at `aae82d1cb8c28085ab20668c720f0282048dcc09`

Prior immutable FAIL evidence: commit `9dfb256a7ac68abc168931c2356fcde834e081fb`, capture `docs/captures/2026-07-18-protocol-history-retirement-verification.md`

Verdict: **FAIL**

This was a fresh, independent review of the complete `origin/main...6aff4fad` change. The prior FAIL report was read as immutable evidence and was not revised. Verification covered the repaired typed Verifier evidence contract, real Git-backed lifecycle reachability, exact rollback tree equality, track and history ordering, replacement gates, ordinary-failure exclusion, all three integration surfaces, schemas, fixtures, templates, role and command text, and scratch installer parity.

## Numbered violation

1. **The Git-backed lifecycle predicate admits retirement after rollback verification and functional replacement start.**

   The normative contract requires Planner retirement to precede its mandatory rollback and requires every functional replacement to wait until that retirement's named rollback is verified and tree-equal. `baton/track-mode.md` says only the rollback may immediately follow the retired original, and `commands/replan-release.md` requires functional replacements to follow the rollback. The three integration surfaces claim to enforce this ordering independently.

   The repaired fixture checks only the current track-array positions at `tests/protocol_history_git_fixture.py:490-500`, the rollback's current terminal state at lines 501-518, and whether the current rollback-status commit is an ancestor of the replacement `start_commit` at lines 520-529. It never proves that the retirement transition was committed before rollback planning, rollback verification, or replacement start. The three surface predicates at lines 533-545 all delegate to this same incomplete evaluator.

   An adversarial temporary Git history was constructed from the fixture's real BLOCKED commit in this order:

   1. plan the rollback while the original still has no retirement record;
   2. restore the exact baseline and verify the rollback;
   3. start the functional replacement;
   4. only then add the original's Planner retirement record.

   Every cited commit and blob was real, typed Verifier evidence equalled retirement evidence, maintainability bytes matched, rollback mode/object equality passed, and the ordinary current states were schema-valid. The evaluator nevertheless returned no failures, and all three integration predicates returned true:

   ```text
   chronology_probe_ready= True
   chronology_probe_failures= []
   merge_track= True
   merge_release= True
   mark_shipped= True

   blocked= 02d1385942dfce73ffea25046ad1bc1a14c0b7a6
   rollback_planned= e2eb1e19b64ad2e52d06aa6832a770b4d954d76f
   rollback_verified= 296f197377d3a48e51d4a234227a852374cb6d70
   replacement_started= c6dac626b272f987b43ed19397bfb90ebaf0daac
   retirement_committed= d0581ddae483922bb8c242972ecfdd2a52603bff
   ```

   The temporary commit ids are execution-local, but their strict order and the all-true predicate result are reproducible from the described probe.

   Required correction: extend the Git-backed lifecycle predicate and negative fixtures to pin the first committed retirement transition and prove, on the owning first-parent history, that the named rollback is planned and verified only after that retirement and that every functional replacement `start_commit` is after the qualifying rollback verdict. Add this exact late-retirement chronology as a negative branch and require `merge_track_predicate`, `merge_release_predicate`, and `mark_shipped_predicate` each to reject it. A current board order plus current terminal states is not sufficient evidence of transition order.

## Repaired areas that passed

- **Typed Verifier evidence:** `protocol_history_invalid` violations now require a strict typed object. The pinned fresh BLOCKED status is resolved by exact commit/path/blob identity, and the evaluator structurally compares its typed `invalid_history` array with retirement evidence.
- **Identity and equality negatives:** gate-only evidence, missing schema identity, missing verdict path, mismatched status blob, typed evidence mismatch, and maintainability byte mutation fail in the committed tests.
- **Rollback tree equality:** the real Git fixture compares exact mode/object tuples across the complete non-record authored envelope. Both content and executable-mode mismatches fail.
- **Ordinary failures:** the `ordinary_relabel` branch points retirement at a schema-valid historical status and fails with `cited-record-valid`; the protocol text also excludes spec, delivery, test, environment, unavailable-gate, and maintainability failures.
- **Schema, fixture, and template validity:** all 18 schemas pass Draft 2020-12 metaschema validation; all JSON parses; `board.json`, `spec.json`, `proof.json`, and `status.json` templates validate against their schemas.
- **Role, command, and install parity:** Claude scratch install commands and both installers' schemas are byte-identical to source. Codex installs eight skills, carries the retirement clauses in the verifier skill, and has no stale Claude Baton paths.

These passing areas do not override the lifecycle false positive.

## Commands and results

All commands ran from `/home/brad/projects/baton-worktrees/protocol-history-retirement` with implementation `HEAD` pinned to `6aff4fadc608a81e2aad793111686dbfdc90060e`.

```text
git status --short
PASS: clean before verdict artefact creation

git branch --show-current
feat/protocol-history-retirement

git rev-parse HEAD
6aff4fadc608a81e2aad793111686dbfdc90060e

git rev-parse origin/main
aae82d1cb8c28085ab20668c720f0282048dcc09

python3 -B -m unittest discover -s tests -v
Ran 9 tests in 2.579s
OK

Draft202012Validator.check_schema over schemas/*.json
PASS: 18 schemas

JSON parse over schemas/*.json, baton/release-mode-template/*.json, tests/fixtures/*.json
PASS

Template validation for board.json, spec.json, proof.json, status.json
PASS: all four

bash -n install-claude.sh install-codex.sh
PASS

jq empty schemas/*.json baton/release-mode-template/*.json tests/fixtures/*.json
PASS

git diff --check origin/main...6aff4fadc608a81e2aad793111686dbfdc90060e
PASS

Claude and Codex scratch installs plus source/install comparisons
PASS: 18 Claude schemas, 8 Claude commands, 18 Codex schemas, 8 Codex skills
PASS: no stale Claude Baton paths in the Codex install
```

The chronology reproduction used `PYTHONPATH=tests python3 -B` to instantiate `ProtocolHistoryRepositoryFixture`, branch from `commits["blocked"]`, commit rollback planning, exact baseline restoration, rollback verification, replacement start, and late retirement in that order, then invoke `evaluate_protocol_history_retirement`, `merge_track_predicate`, `merge_release_predicate`, and `mark_shipped_predicate`. Its output is recorded in the violation above.

## Blockers

There was no environmental blocker. Verification was trustworthy and completed. The sole blocker to PASS is the reproducible lifecycle-ordering false positive above.

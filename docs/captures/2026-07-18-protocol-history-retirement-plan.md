# Protocol-history retirement surface audit and contract plan

Issue: sawy3r/baton#80

## Failure being closed

A started slice can have a schema-valid current record and a preserved `maintainability.state: passed` ledger while an earlier committed `status.json` blob is invalid under the governing protocol. The canonical history gate must fail, but the existing terminal forms cannot retire the slice: ordinary deferral is unstarted-only and the rollback-backed form requires `maintainability.state: re_slice_required`. Rewriting history or converting the PASS ledger would destroy evidence.

## Contract shape

Add an optional top-level `retirement` record to `slice-status-v1`; it is separate from `maintainability`, so retirement never edits that ledger. Its only disposition is `protocol_history_invalid`, and it records:

- every exact invalid committed status identity: first-parent commit, status blob OID, schema identity and schema blob OID, plus deterministic validation-error fingerprints;
- the exact fresh Verifier BLOCKED verdict identity: committed status commit/blob, session id and verdict timestamp;
- the mandatory rollback slice id, rationale, tracker and Coach acknowledgement.

The disposition is legal only for a started, overall `deferred` slice whose current verification result remains `blocked`. Engines must reproduce every invalid-history claim from Git objects and the pinned schema, prove the invalidity is a lifecycle-history/schema defect rather than an ordinary delivery or maintainability failure, preserve the complete maintainability value byte-for-byte from the BLOCKED verdict blob, and require the rollback to restore the complete authored semantic envelope to the immutable `start_commit` tree.

## Surfaces

- `schemas/slice-status-v1.json` and the status template: typed retirement record and fail-closed state coupling.
- `baton/track-mode.md`: canonical integration-ready and sequential-order rules.
- Planner and `/replan-release`: sole authority to ratify retirement, append rollback/replacements, and preserve ledger bytes.
- Implementer and `/implement-slice`: only the named rollback may immediately follow; replacements wait for verified tree equality.
- Verifier and `/verify-slice`: emit the qualifying BLOCKED evidence without self-authorising retirement.
- `baton/llm-checks/README.md` and maintainability prompt: history validation and explicit exclusion from maintainability dispositions.
- `/merge-track`, `/merge-release`, `/mark-shipped`: independently reproduce evidence, ordering and rollback tree equality before treating the original as terminal.
- README/adversarial-verification prose: public state-machine description.

## Deterministic acceptance fixtures

Add positive and negative JSON fixtures plus a repository-local conformance script. It validates schemas and asserts contract text contains the same disposition, immutable-evidence, rollback, ordering, integration-ready and ledger-preservation requirements. Negative fixtures cover missing evidence, non-BLOCKED verification, non-deferred state, missing rollback, and attempts to put the disposition inside or mutate the maintainability ledger. The engine-side reachability fixture remains a Sworn follow-up: invalid-history original blocks without rollback, becomes ready only after exact tree equality, and permits a functional replacement only after rollback verification.

## Checkpoints

1. Commit this audit/contract plan.
2. Implement schema, templates and canonical protocol semantics.
3. Add deterministic fixtures/tests, run all contract checks, then push the feature branch.

No version bump, tag, publication, merge or cross-repository edit is in scope.

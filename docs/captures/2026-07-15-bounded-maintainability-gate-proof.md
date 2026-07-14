# Bounded maintainability gate dogfood proof

Issue: [#75](https://github.com/sawy3r/baton/issues/75)

## Evidence

A reference-project release slice ran maintainability review repeatedly while its semantic diff
was still changing. The protocol named Implementer and Verifier as runners, but neither role
prompt placed the check in its workflow. The default architecture record separately exposed it as
a warning. That left authority, timing, and retry limits to agent interpretation.

The resulting loop mixed implementation discovery with maintainability adjudication, reran broad
validation after intermediate refactors, and briefly advanced state without a fresh closure review.
The state error was corrected forward, but the protocol had made the unsafe path possible.

## Decision

- The Implementer gets a stable-diff readiness preflight, one remediation, and one closure review.
- The fresh Verifier owns the authoritative maintainability gate and runs it once.
- Every report identifies the exact scoped diff with a semantic input fingerprint; a role reuses
  its report for identical semantic bytes without another model call.
- Scope construction is canonical across engines: clean committed base/head, explicit release,
  generated, and lockfile exclusions, byte-sorted paths, fixed prompt-diff options, and SHA-256
  over a versioned path/mode/object manifest independent of local Git presentation. An empty
  semantic scope passes without a model call.
- The final Implementer PASS pins `implementation_head`. Verifier synchronization may advance the
  track, but scope is derived from first-parent non-merge slice commits only; merge-only sibling
  paths are excluded and any merge/slice path overlap fails closed.
- After the pin, only release-record commits and recognized `release-wt` synchronization merges are
  legal before the authoritative gate. A recognized merge's second parent must be on the current
  release branch's first-parent chain and its non-record merge result must match that parent exactly;
  any later semantic path or custom merge tree stales the evidence and fails closed.
- Newly introduced release history is provenance-checked: planner first-parent commits are
  record-only, and production bytes must arrive through a two-parent integration whose second parent
  is the retained, board-declared, verified track ref.
- Size thresholds trigger inspection but never block by themselves.
- Blocking findings require a named symbol, mixed responsibilities or hidden coupling, concrete
  future cost, and bounded in-scope remediation.
- A repeated blocker remains `in_progress` and stops for a recorded Coach adjudication. There is no
  waiver: re-slice, or approve one fresh in-scope remediation cycle. If that resumed cycle also
  fails closure, re-slicing is mandatory.
- The full suite, proof gate, AC check, and security check run before closure. No authored source,
  test, or configuration bytes may change after the final maintainability PASS.
- The Verifier runs maintainability last and read-only, after every gate that might expose or add
  semantic evidence.
- The native Implementer and Verifier command adapters point to the same role-owned ordering, so
  their completion steps cannot bypass or repeat the gate.
- `slice-status-v1` carries the parseable report history, cycle number, and Coach adjudication;
  journal prose is a human mirror rather than transition authority. The lifecycle object is
  required; a missing legacy object must be migrated by the Planner and cannot be reinitialised by
  an Implementer.
- Each compact report entry carries cycle, invocation id, durable report path and Git blob id,
  pinned review head, fingerprint, role, phase, verdict, and findings. Roles compare that ledger to its full report and to every
  committed prior status version, rejecting an erased/changed start commit, report rewrites or
  deletions, decreasing cycles, Coach-adjudication rewrites, or reuse of a terminal slice id.
- Each cycle is checked as a finite-state sequence: preflight first, closure only after preflight
  FAIL, authoritative only after an Implementer PASS, and no entries after a terminal phase.
- An authoritative cycle-0 FAIL goes to `needs_coach`; it never reopens the Implementer
  automatically. The sole Coach-approved resume is cycle 1, whose authoritative FAIL goes directly
  to `re_slice_required`.
- Coach adjudication cites two unique report invocation ids. Their semantic fingerprints may be
  identical, as expected when the Implementer and Verifier reviewed the same pinned bytes.
- A boundary-expanding maintainability disposition is a FAIL with `re_slice_required`, never a
  BLOCKED verdict that could bypass the exhausted-budget transition.
- Re-slicing creates replacement slice ids; the exhausted original keeps its terminal state and
  append-only evidence instead of resetting to cycle 0. A mandatory verified rollback slice first
  restores the entire authored envelope through its own pinned head to the original start tree,
  including post-report production commits, generated output, and lockfiles; `/merge-track`
  rechecks that pinned tree before
  allowing the deferred original to integrate. The merge command runs full committed
  lifecycle/blob/FSM validation before both a new merge and an already-merged no-op.
- Overall `verified` and `shipped` states require a current-cycle authoritative Verifier PASS;
  an empty or Implementer-only maintainability record cannot integrate or be marked shipped.
- `/mark-shipped` reconstructs each originating track history from durable release-merge parents and
  rejects any integration-branch lifecycle rewrite before recording deployment.
- Normal `/merge-track` builds the merge with `--no-commit`, validates the prospective canonical
  parent/tree provenance, then revalidates the committed merge; idempotent re-entry uses the same
  test.

## Protocol and engine boundary

- Baton defines the stable operation id, semantic scope, report identity, authority, retry budget,
  and role transitions. Engine CLI syntax is adapter-owned and non-normative.
- A conformant engine supplies the exact scoped diff, fingerprints the bytes passed to the model,
  validates the structured report, and fails closed when it cannot do so.
- Current reference-engine compatibility is downstream implementation work, not a reason to weaken
  or couple the Baton contract to one runner's present flags or diff behaviour.
- Sworn conformance recommendations are tracked separately in
  [swornagent/sworn#122](https://github.com/swornagent/sworn/issues/122) so they can be reviewed
  alongside the incoming Baton change.

## Validation

- Role ownership is explicit in both role prompts and the LLM-check registry.
- The maintainability prompt distinguishes evidence from size/style heuristics.
- Architecture metadata now identifies itself as discovery-only rather than competing authority.
- The shared report schema carries additive semantic fingerprint and scope fields.
- The slice status schema and template encode the one-resume lifecycle.
- JSON parsing, Draft 2020-12 schema checks, shell syntax, isolated installer dry runs, and
  whitespace validation pass.
- Lifecycle fixtures reject a missing maintainability object, `pending` cycle 1, a PASS without a
  pinned head, invalid role/phase and verdict/finding pairings, and a re-slice state that retains a
  stale head. Maintainability full reports without slice/release identity are also rejected.
- A temporary Git history fixture confirms first-parent slice scope, rejects an integrated track tip
  as a synchronization parent, accepts the release first-parent, and compares merge-result blobs to
  that parent.

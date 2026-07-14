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
  journal prose is a human mirror rather than transition authority.

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
- JSON and shell syntax checks plus whitespace validation are run before publication.

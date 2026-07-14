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
- Identical semantic bytes reuse the existing report within a role session.
- Size thresholds trigger inspection but never block by themselves.
- Blocking findings require a named symbol, mixed responsibilities or hidden coupling, concrete
  future cost, and bounded in-scope remediation.
- A repeated or scope-expanding blocker routes to Coach adjudication instead of another loop.
- Full workspace and hosted validation run on the final restored tree, not after every extraction.

## Validation

- Role ownership is explicit in both role prompts and the LLM-check registry.
- The maintainability prompt distinguishes evidence from size/style heuristics.
- Architecture metadata now identifies itself as discovery-only rather than competing authority.
- JSON and shell syntax checks plus whitespace validation are run before publication.

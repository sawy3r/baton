# Baton B1 corrected contract and records outcome

Date: 2026-07-24
Status: frozen for fresh independent Captain and Verifier review
Stage: B1 / RC2 R1-R2
Track: `track/v1.0.0/B1-contract-records`
Corrected contract commit: `ff13560a3e41ad8dbb186e92b74423522e75ece8`
Scope: [B1 contract and records scope](./2026-07-24-baton-b1-contract-records-scope.md)
Failed head: `65cd466814457dfa8449a9562531007301338be0`
Failure record: [B1 adversarial review](./2026-07-24-baton-b1-adversarial-review.md)

## Outcome

The corrected B1 head retains one schema and the five Baton responsibilities
while closing every boundary rejected by independent review:

- plan scope is contained by track touch surfaces and candidate Git history is
  replayed from the exact materialisation or prior passed-candidate base;
- materialisation persists one base/dependency set and creates the release and
  owner refs atomically at one shared marker;
- owner selection consumes one captured, bounded ref snapshot, detects erased
  owner markers, and projects optional assembly status structurally;
- Git runs through a trusted absolute binary with sanitized control state,
  disabled hooks/fsmonitor, and no external merge drivers;
- assembly `FAIL` persists truthfully for Planner recovery through a newly
  approved work and release identity;
- exact approval and Verifier-dispatch bytes/provenance mint opaque,
  status/profile-bound evidence admissions required by materialisation,
  composition, assembly preparation, and release Merge action validators; and
- bounded reads, writes, histories, paths, files, messages, and plan/status
  shapes fail closed.

Merge now has three explicit mechanical scopes: collective track composition
and transfer, assembly proof/status preparation over the exact release
candidate, and integration of only an assembly-passed candidate. A work `PASS`
covers its Captain-reviewed design and Implementer proof; only a separate
assembly `PASS` covers the exact composed components and permits release Merge.

The board-facing batch API is intentionally structural. It establishes record
shape and authority selection from captured refs, but cannot mint evidence
admissions or authorize an action.

## Adversarial seam matrix

| Review seam | Explicit regression |
| --- | --- |
| F1 scope, candidate delta, and trusted root | `plan scope, fixed root...`; `multi-work track replays...`; product-tree suite |
| F2 exact materialisation base/dependencies | `atomic materialization leaves a dual-ref marker...`; dependency-gated topology test |
| F3 absent, deleted, or fabricated owner | atomic marker-erasure test; owner-aware batch selection test |
| F4 hostile Git executable/config/drivers | complete `git-trust-adversarial.test.mjs` suite |
| F5 durable assembly `FAIL` | `assembly persists PASS, BLOCKED, and FAIL...` |
| F6 external evidence resolver/admission | trusted-admission positive/negative tests; missing-admission negatives for materialisation, composition, and assembly Merge; admitted assembly-preparation proof |
| Serial temporal replay | product-before-`PROCEED`, W2-before-W1-`PASS`, and cross-work-record negative tests |
| Assembly preparation | exact pre-preparation candidate, unchanged refs, exact two-record mutation, and structural assembly projection test |
| Resource and record mutation bounds | plan/JSON bounds plus adversarial batch/write/root replacement tests |

Every finding and every additional adversarial seam named above has a direct
negative or exact-boundary regression. This is a corrected freeze, not a
self-issued completion verdict; fresh review must run against the immutable
commit before B1 is declared complete.

## Measurements

The public documents remain materially smaller than the pre-B1 parent even
after the correction language. The executable reference grew because rejected
trust claims were converted into deterministic checks rather than longer role
instructions.

| Surface | Pre-B1 `4d56871` | Failed `65cd466` | Corrected `ff13560` |
| --- | ---: | ---: | ---: |
| Five public protocol documents, words | 5,246 | 3,789 | 4,584 |
| Core + Protocol + Assurance, words | 3,350 | 2,713 | 3,204 |
| Reference record runtime, lines | not present | 2,424 | 4,435 |
| Record tests including helpers, lines | not present | 1,577 | 3,262 |
| Authored JSON Schemas | 6 | 1 | 1 |
| Portable Python checker, lines | 2,469 | 306 | 306 |
| Conformance manifest, lines | 589 | 64 | 64 |

Relative to the pre-B1 parent, the five public documents are 12.6% smaller,
the role-facing Core/Protocol/Assurance set is 4.4% smaller, schemas are 83.3%
fewer, and the portable checker is 87.6% smaller. Relative to the rejected
head, reference runtime lines increased 83.0% and record-test lines increased
106.9%. Those executable and test surfaces are not role prompts; B2 operations
must keep model-facing instructions concise and call these validators rather
than restating them.

The reference runtime uses Node built-ins and Git only and has zero package
imports.

## Verification

```text
$ node --test test/records/*.test.mjs
tests 57
pass 57
fail 0

$ python3 conformance/check.py
PASS 7 strict JSON cases, 1 Draft 2020-12 schema, 2 positive status fixtures, and 6 negative status fixtures

$ git diff --check
(no output)
```

Freeze assertions also confirmed one `schemas/*.json`, no package imports in
the reference runtime, and no stale configurable-root, in-place materialised
rebind, `RETRY_ASSEMBLY`, or durable `no_verdict` promise in the active public
contract.

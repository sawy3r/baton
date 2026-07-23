# Baton B1 contract and records outcome

Date: 2026-07-24
Status: complete
Stage: B1 / RC2 R1-R2
Track: `track/v1.0.0/B1-contract-records`
Contract commit: `b65b6b893cb468a22165c2c11ab992a9dd1ab2fa`
Scope: [B1 contract and records scope](./2026-07-24-baton-b1-contract-records-scope.md)

## Outcome

B1 replaces the RC1 submission/verdict stack with one lean delivery contract:

- exactly five principles and five responsibilities;
- release-worktree plus owning-track topology with serial work and concurrent
  independent tracks;
- strict raw-byte plan, design, proof, approval, and dispatch bindings;
- one `work-status-v1` schema and one closed transition validator;
- owner-aware record selection and next-work admission;
- exact, compare-and-set, idempotent track and release composition; and
- complete assembly verification before final release Merge.

The reference runtime uses Node built-ins and Git only. Model/provider selection,
workers, retries, leases, events, cost, and hosted control remain Sworn concerns.

## Hardening closed in B1

The committed boundary tests prove:

- duplicate-name, unsafe-number, Unicode, hostile `__proto__`/`constructor`, and
  unknown-field rejection;
- one strict-loaded Draft 2020-12 schema with no duplicate names;
- exact Captain, proof, Verifier, candidate, product-tree, and target bindings;
- fresh/read-only independent verification and no durable `no_verdict`;
- projection-preserving materialisation, authorized rebind, repair/revision
  cycles, and terminal write-once behavior;
- foreign-copy rejection plus missing or malformed authoritative-owner failure;
- one next work item per track, `PASS` admitting the next serial item, and no
  partial track authority transfer;
- passed candidates reachable from the owner ref, final frozen product equality,
  all-work collective transfer, and all-track assembly coverage;
- exact raw design/proof bytes at their captured refs;
- deterministic merge trees, forged-tree rejection, conflict safety, moved-target
  rejection, stale-writer failure, and idempotent same-input replay;
- one successful writer among two same-head compare-and-set attempts;
- product-tree stability across record-only commits and invalidation after
  product changes;
- behaviorally consumed record-root rejection;
- captured-commit symlink rejection without consulting launch-worktree state,
  plus explicit workspace validation when requested;
- inherited Git control/config/object/index/namespace variables, replace refs,
  pathspec magic, locale, and interactive prompting cannot redirect reference
  reads or updates; and
- the current conformance manifest names only existing RC2 fixtures and suites.

## Measurements

Measured against the B1 parent `4d56871f954de909dc223b865b4bba6ec13679eb`:

| Surface | Before | B1 | Change |
| --- | ---: | ---: | ---: |
| Five public protocol documents | 5,246 words | 3,789 words | -27.8% |
| Authored JSON Schemas | 6 | 1 | -83.3% |
| Portable Python checker | 2,469 lines | 306 lines | -87.6% |
| Conformance manifest | 589 lines | 64 lines | -89.1% |

The executable reference is 2,424 lines and its real-boundary tests are 1,577
lines. That complexity is deliberately outside role prompts: callers consume a
small operation plus validated records rather than replaying incident history.
The reference runtime has zero package imports.

## Verification

```text
$ node --test test/records/*.test.mjs
tests 36
pass 36
fail 0

$ python3 conformance/check.py
PASS 7 strict JSON cases, 1 Draft 2020-12 schema, 2 positive status fixtures, and 6 negative status fixtures

$ git diff --check
(no output)
```

Additional freeze assertions confirmed exactly one `schemas/*.json`, no
`conformance/__pycache__`, five B1-B5 headings, five responsibility headings,
and no non-built-in reference-runtime imports.

## Scope notes

`conformance/README.md` and `conformance/manifest.json` were refreshed in
addition to the initially named checker and fixture paths because leaving their
executable-facing RC1 promises and deleted-schema references would make the new
suite misleading and broken.

There are no B1 deviations or blockers. B2 operations/installers and B3
oracle/board/driver work may consume the frozen API from the contract commit.

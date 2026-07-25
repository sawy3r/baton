# Baton v1 RC3 exact-ref scope and outcome

Date: 2026-07-25
Status: CANDIDATE CHECKS PASS; NODE 22 CI, MERGE, TAG, AND PUBLICATION NOT RUN
Release: `v1.0.0-rc.3`
Branch: `fix/v1.0.0-rc.3-exact-refs`
Target: `main`
Exact base: `890238ef063bb53cf51fb3359f1ff527f14846c6`
Product candidate: `56f9d4745d0704c3f21741d218ccd7c0094ea5fc`
Product candidate tree: `16ca20e144fa61fd39d9a3ef98832949f5f4b27b`
Approved design:
`sha256:725f0c93f8981a5c7f413de900ed0672900b6b7e10cf652404b484a103ac1e3c`
Captain: `PROCEED`
Implementer:
`codex:/root/baton_rc3_implementer/v1.0.0-rc.3/exact-ref-cas/design/1`

## Approved scope

Harden the existing exact-named direct-commit ref invariant without changing
the Baton protocol or public action surface:

1. Reject resolving aliases, dangling aliases, direct non-commit refs, and
   broken refs during exact capture.
2. Keep `unsafeAtomicUpdateRefs` synchronous while a same-module Node helper
   drives Git's prepared `update-ref --no-deref --stdin` protocol.
3. Recheck exact representation, existence, commit type, and expected OID
   beneath Git's prepared exact-ref locks.
4. Reconcile every helper outcome from a fresh exact-ref snapshot.
5. Return success for all-desired state, retain the existing snapshot-scoped
   no-advancement result for meaningful all-pre state, and require
   authoritative recovery for every ambiguous state.
6. Prove deterministic pre-commit timeout and kill cleanup, including actual
   Git-child exit and exact-lock release.
7. Publish the maintenance truth as RC3 while retaining byte-identical
   canonical operations and schema.

Owned code and test surfaces were limited to:

- `reference/records/git.mjs`
- `test/records/git-trust-adversarial.test.mjs`

Release maintenance was limited to `VERSION`, generated adapters and manifest,
current README/install/conformance truth, release assertions, one release note,
and this capture.

## Explicit non-goals

No files under `operations/`, `schemas/`, `baton/`, `reference/board/`, or
`reference/driver/` changed. There is no lifecycle, role, responsibility,
handoff, schema, board, driver, installer-transaction, website, Sworn, or
autonomous-engine claim change. Historical RC2 notes, captures, tag, and bytes
remain untouched.

## Observed outcome

Exact capture now reads `%(symref)` and performs at most two trusted probes for
each requested ref omitted by Git 2.43. Only a direct commit or genuine absence
is accepted.

Mutation now uses one prepared exact-ref transaction. The helper independently
validates its closed request and holds Git's exact named locks while checking
the raw pre-state. It never dereferences or normalizes an alias.

The synchronous parent precomputes immutable pre-state, desired-state, and
success vectors. After every helper exit, error, timeout, signal, or output
result it captures all operation refs and classifies:

- all desired: success and idempotent retry;
- all pre with a meaningful operation: existing no-advancement error,
  explicitly scoped to the current snapshot; or
- anything else: `ATOMIC_REF_UPDATE_FAILED` with
  `ambiguous outcome; authoritative recovery is required before retry`.

Parent-owned hooks cleanup is best effort after classification and cannot turn
a committed transaction into failure. Higher record wrappers preserve the
ambiguity and recovery wording.

## Candidate evidence

Observed local environment:

```text
Node v24.14.0
Git 2.43.0
Python 3.12
```

Observed checks:

```text
PASS  node --test test/records/git-trust-adversarial.test.mjs
      24 tests
PASS  node --test test/records/*.test.mjs
      77 tests
PASS  complete portable Node command
      142 tests
PASS  isolated-venv conformance/check.py
      7 strict JSON cases, 1 schema, 2 positive and 6 negative fixtures
PASS  node scripts/generate-adapters.mjs --check
      10 adapters, 5 operations
PASS  node scripts/measure-overhead.mjs --check
      all 9 budgets
PASS  sh -n install-claude.sh
PASS  sh -n install-codex.sh
PASS  git diff --check
PASS  RC2-to-RC3 diff under operations/ and schemas/
      no changed bytes
```

Captain's deterministic condition was observed for both injected pre-commit
kill and timeout. Each fixture recorded that the exact loose-ref lock existed
after `prepare: ok`, recorded the actual Git transaction child PID, then proved
the child no longer existed, the exact `.lock` was absent, the target remained
at the complete pre-vector, and a new cooperative compare-and-set succeeded.

Post-commit injected non-zero exit, SIGKILL, extra output, parser failure, and
parent cleanup failure all reconciled to the desired exact refs and returned
success. Repeating the exact transaction returned success without another ref
or reflog mutation.

Mixed pre/post, third OID, symbolic alias, and reconciliation-failure fixtures
returned the existing public code with the recovery-required ambiguity
message. The deterministic ABA fixture committed and reverted before
reconciliation; it returned the snapshot-scoped all-pre result while its
reflog proved why no historical non-movement claim is made.

## Immutable identities

Schema:

```text
schemas/work-status-v1.json
sha256:70219641e954afefa35fe20cf702eeabac3ce7c9290d09d5ce29082bf4a497c1
```

Canonical operations:

```text
baton-plan          sha256:e5c3ace4177cb10c9b0d3b5e569aa7cbe43bfdb3b7f4a17071a925a5ba3b77d3
baton-implement     sha256:2444bead5b1a32188003ce515ac8862bd04d373b740bd89646a86ac5341c2f88
baton-design-review sha256:ead3a7d0e22a794ca5430fdbaca5c29f3ae5d5f6fad7c102d1f2bd878f28e356
baton-verify        sha256:a6f0e9b9bf95cb59e5030b7f95f72d8d3545b52ef771c7d20e7be44a20e45bed
baton-merge         sha256:94b8fb6026c903569cd375cafd11d27868759072dde256265556c710387ae62c
```

Generated support package:

```text
version: 1.0.0-rc.3
Claude/Codex parity:
sha256:5faf93152eab01a625b3c3a3460d1f1554429c6461cfbf03be0ec6ba3fd901d3
```

## Archive and publication

The release-maintenance commit is:

```text
e06ebb121ca696be583ab7aa579439e63540deac
tree 8a5e3e97d228b5b96f6c440799c9099beea3c8e2
```

Two independently generated provisional archives from that exact commit were
byte-identical:

```text
baton-1.0.0-rc.3.tar.gz
210 entries
sha256:218d7c3930da7ba2c0d08543c569d8d8550f4052f2fdadf63cb14b25bf8b1a90
```

The archive retained executable modes on both installers and contained the
expected exact-ref implementation and RC3 release note. Safe extraction
succeeded. Claude Code and Codex project-scope dry-runs from the extracted
package each reported seven intended actions and left the isolated target with
only its pre-existing `.git` directory. The complete Node profile separately
passed both hosts' isolated user- and project-scope installer, dry-run, no-op,
rollback, uninstall, interruption, and migration fixtures.

This capture update is evidence-only and therefore follows the archived
release-maintenance commit. The final Verifier must bind and rebuild the exact
review tip rather than treating this provisional checksum as a tag checksum.

Node 22 CI, protected merge, post-merge rerun, annotated tag, GitHub
prerelease, asset download, public checksum verification, website work, and
Sworn re-pin are `NOT RUN` in this implementation handoff. They must not be
inferred from the portable candidate checks above.

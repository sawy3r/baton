# Baton B4 integrated conformance and dogfood outcome

Date: 2026-07-24
Status: PASS; awaiting independent release review
Stage: B4 / RC2 R8
Track: `track/v1.0.0/B4-conformance-dogfood`
Integrated code head: `813daed43ae26ada59ed34fbb1aed5d67d73f7e1`
Authority: [B4 scope](./2026-07-24-baton-b4-conformance-dogfood-scope.md)

## Outcome

The composed RC2 kit passes its complete portable profile:

- B1's seven-action record and Git authority boundary;
- five concise canonical operations and generated Claude/Codex Skills;
- transactional install, migration, rollback, and uninstall;
- the owner-aware board, terminal renderer, and local GET-only WebUI;
- one role-independent driver contract and deterministic fake;
- a real three-track manual lifecycle through assembly verification and exact
  release integration; and
- reproducible overhead measurement against immutable Baton v0.16 objects.

The package now installs the board oracle, terminal renderer, WebUI, driver
contract, and fake driver for both hosts. Installed copies were executed rather
than accepted from manifest presence alone.

## Dogfood identities

The integrated run used:

```text
package version:       1.0.0-rc.2
package digest:        sha256:eccd974741429df0bc82d5ba95e4d09cdb54af8ec47a7eb6a2b8a05b44df032d
plan digest:           sha256:a369986bab22be8eac3d11bef7e262d9b11d70e4eea836f6fa1e160c0d9b027b
target base:           8f079ee80aae3dc8ac1a20f6f4e99d1040902468
approved baseline:     008972fdad5ea8d58834e87502855ee65465a4dd
materialised T1:       03b242372b5ccf1c3d2afb82b201880112be0e67
materialised T2:       4f796c3ba1edea476c68f4bd7ef0d06ce7ba9dd9
materialised T3:       078d127c3c04431ee7dad1e20475ead296d1dda1
frozen T1:             ac2182e59cdbbbccfada9ee3ab29ceb16a5b2d5c
frozen T2:             686514acf5681dd2f9bdba3ea41989a80fd13293
frozen T3:             e173f39139b763776f17dd2aa14e5ce9a4ba4282
assembled candidate:   4c1430115baa4eb9b191b534083eb337db774347
assembly preparation:  664992aa284b263e783f5ef2341a23100df68864
assembly PASS record:  145bdcc480cb790c49e3cb80a9c2d73ebc992de1
integrated target:     4c1430115baa4eb9b191b534083eb337db774347
terminal status:       696d3e1b8bc5515c22e20a74f94daaf19f6aa28f
final board digest:    sha256:3b30c8fc74caf91666b21f0859867b95e93ccde409482e4c9bf27aad13a58d30
```

The run exercised 16 meaningful checkpoints. At each checkpoint the direct
board JSON and live WebUI `/api/board` bytes were identical, and the terminal
renderer exposed the same release, track, work, assembly, and next-operation
facts.

Responsibility dispatch counts were:

```text
Planner:      1
Implementer: 13
Captain:      5
Verifier:     7
Merge:        5
```

The observed wall time was 23.6 seconds. It is diagnostic, not a deterministic
release budget.

## Required recovery and authority observations

- T1 and T2 were simultaneously materialised and independently actionable;
  their work was interleaved while each track remained serial.
- T3 refused materialisation with `UNMET_TRACK_DEPENDENCY` until T1's exact
  frozen head was composed.
- Captain returned `REVISE` for W1; a new design was written before
  `PROCEED`.
- Verifier returned `FAIL` for W2; a new product candidate and proof were
  produced before `PASS`.
- A fake-driver `transport_error` produced `NO_VERDICT`: no status, ref, or
  commit-object change occurred.
- A newer foreign W1 copy at
  `c8103f2b9c48250a9f979bdc62c0020b2b79282c` did not alter the authoritative
  board projection.
- All three owner refs were frozen and composed exactly once.
- Assembly proof named all three exact frozen heads.
- Assembly Verifier dispatch was fresh-context and read-only.
- Release integration compared against the original exact target and moved it
  only to the passed assembled candidate.

This manual dogfood proves independent track actionability and owner isolation.
It does not claim simultaneous engine processes, leases, crash recovery, or
provider isolation. Those remain among the 12 autonomous-engine manifest cases
explicitly marked `NOT RUN` for Sworn.

## Measured overhead

The baseline is recomputed from annotated tag object
`a9128d8993a23d49ba3d3bd5bf918b28bda6ec67`, peeled v0.16.0 commit
`aae82d1cb8c28085ab20668c720f0282048dcc09`, and tree
`8e65016101762320572857ec786c0a377eedf2a8`.

```text
v0.16 fixed words:         56,973
RC2 fixed words:            1,512
RC2 / v0.16 ratio:          2.6539%
v0.16 required artefacts:        7
RC2 logical handoffs:            4
minimum normal invocations: 4 -> 4
authored JSON Schemas:            1
canonical operation words:   1,504
largest full host Skill:        397
```

Every operation is below 400 words, all five total below 2,000, one full host
Skill below 500, and the fixed-word ratio is below the 20% gate. Claude and
Codex canonical bytes, operation digests, and support-package digests match.

## Exact checks

```text
python3 conformance/check.py
  PASS: 7 strict JSON cases, 1 Draft 2020-12 schema,
        2 positive status fixtures, 6 negative fixtures

node --test test/records/*.test.mjs test/operations/*.test.mjs \
  test/adapters/*.test.mjs test/install/*.test.mjs \
  test/board/*.test.mjs test/driver/*.test.mjs \
  test/dogfood/*.test.mjs test/release/*.test.mjs
  PASS: 132/132

node scripts/measure-overhead.mjs --check
  PASS: all nine deterministic budgets

node scripts/generate-adapters.mjs --check
  PASS: 10 adapters, 5 operations
  package sha256:eccd974741429df0bc82d5ba95e4d09cdb54af8ec47a7eb6a2b8a05b44df032d

sh -n install-claude.sh
sh -n install-codex.sh
git diff --check
  PASS
```

The complete check left the worktree clean.

## Remaining boundary

R9 must now rewrite the public repository and website surfaces, add the
dependency-light CI/release gates, perform isolated and real-machine dry-runs,
complete the recoverable Claude/Codex cutover, and publish the exact reviewed
RC2 object. No global installation, public deployment, tag, release, or Sworn
pin is claimed by this outcome.

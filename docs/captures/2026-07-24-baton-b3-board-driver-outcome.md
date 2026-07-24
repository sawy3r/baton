# Baton B3 board and driver outcome

Date: 2026-07-24
Status: implemented and corrected; awaiting independent re-review
Stage: B3 / RC2 R5-R7
Track: `track/v1.0.0/B3-board-driver`
Code head: `b3732c1a9a4af803f7f56963c4729c76c1dd0c91`
Authority: [B3 scope](./2026-07-24-baton-b3-board-driver-scope.md)

## Delivered

- One deterministic oracle discovers exact `release-wt/*` refs, captures
  immutable release/target/track heads, selects baseline, owner, or composed
  authority through B1, and exposes every independently actionable track plus
  the separate assembly and release Merge gates.
- One pure terminal renderer and one dependency-free, loopback-only, GET-only
  WebUI consume the same `baton.board/v1` projection. Neither has a write path
  or independent lifecycle logic.
- One `baton.driver/v1` process contract serves all five roles with explicit
  model selection and transport-only results. The deterministic fake exposes
  only its five built-in transport profiles.

The board remains a structural projection. It does not claim protected
approval, dispatch isolation, behavioral inertness, active workers, retries,
cost, or runtime freshness beyond committed refs. Sworn owns those runtime
facts without forking the Baton board.

## Independent review corrections

The first exact candidate, `ff9868b385d9a4c1282e2dbe14028660b3430953`,
failed independent review. All four findings were corrected before
composition:

1. The B2 operations were composed into the track. Driver requests now match
   the exact installed operation ID, version, digest, and complete bytes; a
   caller cannot substitute self-consistent replacement instructions.
2. Statuses, designs, proofs, and assembly evidence are read in bounded batches
   per captured ref. Multi-proof reachability and ancestry use two bounded Git
   graph operations per track rather than one process per work item, and owner
   lineage is read once. One-proof and five-proof projections both use 24 Git
   processes in the regression fixture.
3. The WebUI client is executed against literal control/markup-shaped text and
   a successful-then-failed refresh; the committed view remains unchanged and
   visibly stale. Process fixtures exercise crash, missing-result, and
   stderr-diagnostic boundaries in addition to typed timeout and cancellation.
4. This durable outcome records the exact boundary and evidence.
5. A second review found that 342 valid work items exceeded the generic
   1,025-path batch ceiling. Release projection now has one dedicated,
   read-only `3 × work_total + 2` path envelope while ordinary record reads,
   tree reads, and mutation limits remain unchanged. A real 64-track,
   1,024-work plan proves the exact protocol ceiling and ref-scaled Git work.

## Evidence

- `node --test`: 128/128 pass across the composed B1, B2, and B3 tree.
- B3 board and driver suites: 39/39 pass, including rejection of a missing
  captured design handoff and projection of the maximum valid work count.
- `python3 conformance/check.py`: PASS for all strict JSON, schema, positive,
  and negative cases.
- `node scripts/generate-adapters.mjs --check`: ten adapters match five
  canonical operations; current composed package digest is
  `sha256:2d1564223abe2a79157a56409c12f2155d4b285baf2141af23c75b2c8be40c34`.
- The 100-work/20-ref warm projection median measured 9.3 ms in the final full
  run, below the one-second gate.
- Headless Chrome rendered the real fixture at desktop and mobile sizes with
  the intended release, track, work, assembly, and next-operation hierarchy.
- `git diff --check` is clean.

## Remaining integration boundary

B4 must add the board and driver runtime files to the generated install
package, regenerate the final package identity, and prove the complete loop in
a real temporary Git release. The package digest above is therefore a truthful
pre-B4 integration digest, not the publication identity.

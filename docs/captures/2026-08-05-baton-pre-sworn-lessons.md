# Pre-Sworn Baton lessons review — 2026-08-05

## Scope

Review the useful early Baton design before the Baton/Sworn split, especially
slice decomposition, proof bundles, reachability screenshots, board projection,
and concurrency boundaries. This is archaeology, not a proposal to restore the
old repository wholesale.

## Baseline examined

- `v0.1.0`–`v0.4.3`: the original release-mode templates, proof bundle, board,
  terminal status view, and screenshot convention.
- `v0.5.0`–`v0.10.0`: the JSON record transition and the growing proof, contract,
  assembly, and board schemas.
- `v0.16.0`: the mature pre-Sworn track-mode model, touchpoint matrix,
  worktree recovery rules, proof bundle, QA runbook, and wire-contract registry.
- `e984d658`, `2c8ce241`, `2004cd9`, `2166145`, and `d00ed0f`: the documented
  stateless-loop, screenshot, compression, and pre-Sworn course-correction
  decisions.

## Decisions

### Restore

1. **Per-slice contract boundaries.** The old `spec.json` was a useful unit of
   concurrency and verification. RC15.2 restores this as one immutable slice
   file beside the release skeleton, without restoring the old lifecycle files.
2. **Human-readable proof inventory.** The old `proof.json` made the result
   inspectable: files changed, test results, reachability, delivered items,
   undelivered items, and divergence. RC15.2 restores the human-facing bundle
   location and advisory `evidence.json` inventory.
3. **Reachability evidence as a first-class artifact.** The old rule correctly
   rejected “tests pass” as evidence for a user-facing change. Screenshots,
   output samples, and smoke steps should remain visible and linked to the
   slice attempt.
4. **Stateless board projection.** The May 29 loop and later board oracle
   derived responsibility from committed records and Git rather than trusting a
   second cached cursor. The current reference board preserves this principle.
5. **Track/worktree isolation.** The old track-mode diagnosis was correct:
   shared indexes, interleaved commits, and ambiguous recovery refs make
   concurrency unsafe. Separate worktree/branch ownership remains the right
   engine-level implementation boundary.

### Adapt

1. **Screenshot paths.** The old convention used a fixed `docs/<release>/...`
   path and slice-id prefixes. The better current form is a configurable
   `release_docs_root`, with global `~/.config/baton/config.json` defaults and
   project `.baton/config.json` overrides.
2. **Proof structure.** Keep the old `delivered`, `not_delivered`, and
   `divergence` concepts, but make them advisory evidence metadata. Receipts
   remain the authority for the candidate, attempt, and verdict.
3. **Touchpoint matrices.** The old `board.json.shared_touchpoints` and rendered
   matrix made parallel-edit assumptions explicit. The current v3 plan has
   tracks, dependencies, scopes, and consumed inputs, but does not yet
   mechanically validate file-level disjointness. This is the strongest next
   design candidate.
4. **Wire-contract registries and QA runbooks.** The old `contracts.json` and
   rendered QA runbook were valuable for releases crossing API/UI boundaries,
   but should be optional, slice- or release-level evidence rather than a
   universal Baton handoff.
5. **Recovery anchors.** The old track branch as durable recovery home is sound;
   the retired separate slice ref was a foot-gun. Keep the branch/worktree
   principle, not the extra ref or the old mutable status transitions.

### Retire

1. `status.json` as a mutable lifecycle authority. It duplicated facts now
   derived from plan, receipts, and Git and could drift from the actual tree.
2. `journal.md` as a required handoff. Useful context may exist, but it is not
   proof and should not be required for routing.
3. `proof.md`/`proof.json` as a universal strict schema. The evidence bundle is
   useful; making every project populate a large protocol record was not.
4. The broad 0.x schema catalogue, mission-control actions, worker controls,
   cost dashboards, and provider-specific prompt/runtime copies. The streamlining
   review correctly identified these as machinery around the trust kernel, not
   the kernel itself.
5. Fixed repository paths as protocol law. The old screenshot and release paths
   were conventions; project policy should be configurable.

## Follow-up candidates

1. Add an optional validated touchpoint/disjointness projection to a future plan
   revision, retaining the current v3 format as the compatibility floor.
2. Expand the advisory evidence template with optional `delivered`,
   `not_delivered`, `divergence`, `reachability`, and receipt/candidate links.
3. Add an example UI slice bundle under `docs/baton/releases/` so the intended
   screenshot and output layout is concrete rather than merely described.
4. Keep the next review focused on whether these additions improve independent
   verification; do not reintroduce a mutable status or activity store.

## Conclusion

The early Baton version was not a better candidate to resurrect wholesale. Its
best ideas were the narrow ones: slice-level contracts, visible proof bundles,
reachability artifacts, stateless projection, and explicit concurrency
boundaries. RC15.2 restores the first three in a lighter form. The touchpoint
matrix is the remaining high-value idea to evaluate next.

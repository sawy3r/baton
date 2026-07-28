# Release receipt epoch boundary bridge

## Authority

- Base: `4203a699947a9e2e4b18ee1d5a28e8ec9131bfcf`
- Implementer design: `e2d67188de92f3dce942684e5f12bcb498c49eeb`
- Captain: `PROCEED` via `codex:019fa55b-3456-77f2-9b2e-12792e630c91`

## Decision

A release reads receipts strictly after the target recorded by its revision-1
approval. Baton accepts that exclusive floor only when the exact topology is:

`approved target -> revision-1 plan commit -> revision-1 approval receipt`

The floor must occur on the bounded first-parent chain and must not already
contain this release's plan path or follow an earlier first-parent change to
that path. The revision-1 plan commit is therefore its unique first
introduction. Release, track, approval, and retirement scans share the
resulting epoch. Every receipt above the floor is parsed before ownership
filtering; foreign receipts above it still fail closed. Receipts at or below
the floor belong to inherited history and are not interpreted.

## Why

An exact Merge legitimately carries prior-release receipt commits into the next
release's Git ancestry. Treating that immutable ancestry as current authority
made sequential releases fail, especially when track or slice identities were
reused. The epoch restores release-local authority without weakening receipt
validation or changing schemas, roles, lifecycle, protocol, candidate
topology, or the product-identity algorithm.

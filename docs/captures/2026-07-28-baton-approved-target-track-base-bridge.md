# Approved-target track-base bridge

## Decision

Before design, a track base must contain both current release or track
authority and the current plan's approved target. Baton now prepares that base
in this order:

1. current authority as first parent;
2. approved target through the existing deterministic exact-composition
   primitive, only when not already contained;
3. plan-ordered consumed PASS authorities.

An authority-to-target fast-forward is allowed only when the authority is on
the target's bounded first-parent chain. A second-parent-only relationship
uses an authority-first two-parent composition so receipt replay cannot lose
the authority.

`prepareTrackBase` materializes the track ref when target composition is
required, including for a zero-consume slice. A normal revision-1 zero-consume
slice remains an inert no-op. Design and candidate actions, plus state replay,
reject histories that bypass the prepared target. Replay reconstructs the same
plan-specific authority, approved-target, and declared-input composition; merely
containing the individual ancestors is not equivalent to the exact base.

## RC7 reproduction

The live RC7 revision-2 topology was inspected without moving any ref:

- release authority: `f9f3faa9af78b788c24e917b183424820a7f5063`
- approved target: `faf652dd585214e32bbebf59bba5219d9822d864`
- deterministic prepared base:
  `20d74c55aa20b04f80e9d9b92b7321f181177751`

The prepared base contains both exact commits, retains the RC7 plan records,
and contains the maintenance-bridge source from the approved target.

## Boundary

This is a reference-engine maintenance correction. It does not change Baton
roles, lifecycle, schemas, receipt fields, product identity, candidate
topology, first-parent receipt authority, or protocol text.

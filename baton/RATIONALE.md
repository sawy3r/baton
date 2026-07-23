# Why Baton has this shape

Baton began as a working Bash Coach loop: plan a release, run ordered slices in
parallel-safe tracks, review design with a Captain, verify from fresh context,
and merge through a release worktree. It proved that a useful autonomous loop
did not require a large framework.

The protocol later accumulated twelve rules, many schemas, repeated role
manuals, copied platform prompts, universal model reviews, and incident-specific
artefacts. Each addition addressed a real failure, but every future invocation
paid for all of them. Token cost and procedural churn rose while attention to
the load-bearing boundaries fell.

The first Baton 1.0 release candidate compressed too far in the other direction.
It preserved a strong trust kernel but removed the portable five-responsibility
workflow, installers, and board that made Baton immediately usable.

RC2 restores the useful operating model without restoring the accumulated
ceremony.

## Archaeological basis

The recovery lineage is recorded in Fired:

- `e984d658` — earliest complete recoverable responsibility loop and board;
- `5d836ed6` — fresh inline dispatch without tmux;
- `2c8ce241` — authored plan separated from derived board state;
- `0c7b1460` — calibrated Captain triage; and
- `b7654a30` — one role-independent runtime-driver boundary.

The later `124265bd` checkpoint preserves broad provider compatibility
requirements but also shows why provider code, model rotation, worker controls,
and active mission control belong in Sworn rather than Baton.

The immutable `v0.16.0` tag remains the complete 0.x archaeology point.
`v1.0.0-rc.1` remains the trust-kernel experiment. Neither is silently migrated
or reinterpreted.

## The boundary

Baton owns five principles, five responsibilities, four concise handoff forms,
one status schema, deterministic reference validation, and a read-only board.

Sworn owns autonomous scheduling, leases, retries, cancellation, crash recovery,
process and credential isolation, concrete provider drivers, runtime events,
evaluation, cost, alerts, and hosted operations.

That separation keeps manual Baton useful, lets Sworn automate the same
contract, and prevents another provider-specific orchestration stack from
growing inside the protocol.

## How the protocol grows

New incident knowledge should normally become a deterministic check, negative
fixture, clearer existing field, project policy, or engine invariant. A new
universal instruction is justified only when its absence breaks trust for
nearly every delivery and no smaller mechanism can enforce it.

The goal is not the fewest possible files. It is the smallest causal chain that
still makes autonomous completion believable.

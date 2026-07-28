# Baton

Baton is a small, open protocol for delivering software with agents. It keeps
the facts that make “done” believable and leaves the operational machinery to
an engine.

```text
approved plan and slices
  -> Implementer design TL;DR
  -> Captain decision
  -> implementation candidate
  -> fresh Verifier decision
  -> merge the exact candidate that passed
```

The Verifier starts fresh, cannot change the candidate, and returns `PASS`,
`FAIL`, or `BLOCKED`. A broken runner is not a verdict. Only `PASS` over the
current candidate can reach Merge.

Baton defines those responsibilities and trust-critical facts.
[Sworn](https://github.com/sawy3r/sworn) is the reference engine for scheduling,
retries, recovery, worktrees, drivers, projections, and telemetry. Baton does
not run models, hold provider credentials, or choose a model.

## The small model

Five principles make completion trustworthy:

1. **Stay inside the agreed work** — begin from an externally approved plan.
2. **Keep durable facts** — Git and compact receipts outrank chat and dashboards.
3. **Prove the real result** — connect each claim to observable evidence.
4. **Use a fresh Verifier** — the builder does not mark its own homework.
5. **Merge only what passed** — recheck the candidate and target at Merge.

Five responsibilities carry those principles: **Planner**, **Implementer**,
**Captain**, **Verifier**, and **Merge**. They are authority boundaries, not a
requirement for five people, processes, or providers.

The durable minimum is one approved plan plus small machine-written receipts
for decisions and outcomes. The candidate diff, tests, code, and Git history
carry implementation evidence. Longer design or evidence documents are
optional when the work needs them; Baton does not universally require
`design.md`, `proof.md`, or a hand-maintained `status.json`.

## Commitment, not inventory

An approved plan commits the delivery to observable behavior, product surfaces,
acceptance, minimum checks, semantic limits, authority, and real product
dependencies. It is not a prediction of every file that implementation will
touch or every command that evidence will need.

Discovering an ancillary test, oracle, support file, or useful additional check
does not change that commitment. Record the actual paths and check results in
the candidate and evidence, then continue under the same approved plan and
stable slice. The same applies to evidence corrections and procedural recovery.

A material change to behavior, consumed product, contract, authority, or an
externally owned decision still stops for the appropriate Captain, Planner, or
authorizer. Exact approval, fresh verification, and exact-candidate Merge do
not weaken.

## Revision without churn

A plan advances at one path under one release identity. Its slices keep stable
identities:

- a design revision adds a design attempt to the same slice;
- a Verifier `FAIL` adds an implementation attempt to the same slice;
- a plan revision reuses unchanged slices and invalidates only changed slices
  and the real dependency closure whose inputs changed; and
- a new release identity is needed only when the overall goal, target, or
  authority is replaced.

Git keeps every earlier revision and attempt. The board derives the most
advanced trustworthy state; it is not another state store.

## What can block

Baton blocks when a trust-critical fact cannot be established: current
approval, unambiguous scope and authority, an applicable Captain decision, an
exact candidate and evidence, fresh verification, or safe exact composition.

Missing derived status, duplicate dispatch, stale board output, runner
interruption, a skipped cursor, or a reconcilable Git effect is operational.
An engine reconstructs or retries it without manufacturing approval,
`PROCEED`, `PASS`, or `MERGED`.

## Portable operations

Baton ships five concise, tool-neutral operations:

- `baton-plan`
- `baton-implement`
- `baton-design-review`
- `baton-verify`
- `baton-merge`

Claude Code and Codex expose byte-identical generated Skills. The board remains
a thin, read-only projection: looking at it cannot advance delivery.

## More than one track

Independent tracks may run together. Ordered slices remain serial inside a
track. Passed track candidates may be composed only through the approved plan;
a fresh Verifier then checks the complete assembled product before final Merge.

## Get started

RC7 is a bounded publication recovery over RC6. It keeps the same lean
protocol while carrying two reference-engine trust-boundary corrections and
making the complete package available under a fresh release identity. See the
[RC7 release note](docs/releases/v1.0.0-rc.7.md).

The easiest route is to ask Claude Code or Codex:

```text
Install Baton v1.0.0-rc.7 for me.

Clone the exact tag, read its INSTALL.md, show me the matching user-scope
dry-run, and wait for my approval before applying it.
```

If you prefer the shell, clone the reviewed tag and preview the matching
installer yourself:

```sh
git clone --branch v1.0.0-rc.7 --depth 1 https://github.com/sawy3r/baton.git
cd baton
./install-codex.sh --user --dry-run    # or ./install-claude.sh
```

Project-local installs are also supported. See [INSTALL.md](INSTALL.md), then
follow the [platform-agnostic walkthrough](examples/README.md).

## Repository map

- [`baton/CORE.md`](baton/CORE.md) — five trust principles
- [`baton/PROTOCOL.md`](baton/PROTOCOL.md) — responsibilities, facts, and receipts
- [`baton/ASSURANCE.md`](baton/ASSURANCE.md) — standard and heightened assurance
- [`baton/CONFORMANCE.md`](baton/CONFORMANCE.md) — observable obligations
- [`operations/`](operations/) — five canonical operations
- [`reference/`](reference/) — the portable receipt, Git, and read-only board kit
- [`conformance/`](conformance/) — portable and autonomous profiles

## License

[MIT](LICENSE)

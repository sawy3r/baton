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
optional when the work needs them.

## Commitment, not inventory

An approved plan commits the delivery to observable behavior, product surfaces,
acceptance, minimum checks, semantic limits, authority, and real product
dependencies. It is not a prediction of every file implementation will touch
or every command evidence will need.

Discovering an ancillary test, oracle, support file, or useful additional check
does not change that commitment. Record the actual paths and check results in
the candidate and evidence, then continue under the same approved plan and
stable slice. A material change to behavior, consumed product, contract,
authority, or an externally owned decision still stops for the appropriate
review or approval.

## Portable operations

Baton ships one client-neutral Agent Skills payload containing exactly five
standalone skills:

- `baton-plan`
- `baton-implement`
- `baton-design-review`
- `baton-verify`
- `baton-merge`

Each skill contains the exact canonical operation text. `baton-plan` also
contains its plan template at `templates/plan.md`; no separate Baton support
directory is required. The board remains a thin read-only repository tool.

## Get started

Ask the agent already running in your tool to install the exact RC11 payload:

```text
Install Baton v1.0.0-rc.11 from
https://github.com/sawy3r/baton.git.

Check out that exact tag and read INSTALL.md. Determine this tool's real user
or project skills directory from current documentation or the live
environment. Show me the complete no-write preview and wait for my approval
before applying it. Do not guess paths, edit instruction files, or install
Sworn. After approval, install the exact payload and prove in a clean context
that all five Baton skills are discovered.
```

The running agent owns destination discovery and the approval conversation.
Baton deliberately has no maintained client list, client-path table, or
installer helper. Approval binds the exact release commit, payload digest,
canonical destination, complete change set, and observed state. The agent
rechecks those facts immediately before effects. See [INSTALL.md](INSTALL.md).

## Revision and recovery

A plan advances at one path under one release identity. Its slices keep stable
identities. A design revision adds a design attempt, a Verifier `FAIL` adds an
implementation attempt, and a plan revision reuses unchanged slices while
invalidating only changed slices and the real dependency closure.

Baton blocks when a trust-critical fact cannot be established. Duplicate
dispatch, stale board output, runner interruption, or a reconcilable Git effect
is operational; an engine reconstructs or retries it without manufacturing
approval, `PROCEED`, `PASS`, or `MERGED`.

## Repository map

- [`skills/`](skills/) — generated five-skill standalone payload
- [`operations/`](operations/) — canonical operation sources
- [`baton/CORE.md`](baton/CORE.md) — five trust principles
- [`baton/PROTOCOL.md`](baton/PROTOCOL.md) — responsibilities, facts, and receipts
- [`baton/ASSURANCE.md`](baton/ASSURANCE.md) — standard and heightened assurance
- [`baton/CONFORMANCE.md`](baton/CONFORMANCE.md) — observable obligations
- [`reference/`](reference/) — portable receipt, Git, and read-only board kit
- [`conformance/`](conformance/) — portable and autonomous profiles

## License

[MIT](LICENSE)

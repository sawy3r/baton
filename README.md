# Baton

Baton is a small, open protocol for delivering software with agents. It gives
the work five clear jobs, saves the important handoffs in Git, and merges only
the version that passed a fresh, independent check.

```text
                                         fresh-context boundary
                                                   ║
                          ┌─────────┐              ║
                          │ Captain │              ║
                          └────┬────┘              ║
                  design ▲     │ PROCEED / REVISE  ║
                         │     ▼                   ║
┌─────────┐ approved plan ┌─────────────┐ proof.md ║ ┌──────────┐ PASS ┌───────┐
│ Planner │──────────────►│ Implementer │──────────╫►│ Verifier │─────►│ Merge │
└─────────┘               └─────────────┘          ║ └──────────┘      └───────┘
                              ▲                    ║      │
                              └────── FAIL ─────────╫──────┘
```

The double bar is the load-bearing boundary: the Verifier starts fresh and
cannot change the work. `REVISE` and `FAIL` go back to the Implementer;
`ESCALATE` and `BLOCKED` go back to the Planner. Only `PASS` can reach Merge.

Baton defines the jobs, handoffs, and checks.
[Sworn](https://github.com/sawy3r/sworn) is the reference engine being built to
keep that loop moving autonomously. Baton does not run models, keep provider
credentials, or choose a model for you.

## The small model

Five principles make completion trustworthy:

1. **Stay inside the agreed work** — start with an approved plan; approve it
   again if its scope, contract, or authority changes materially.
2. **Write down what matters** — repository files and Git outrank chat.
3. **Prove the real result** — test the thing you say you finished.
4. **Use a fresh Verifier** — the builder does not mark its own homework.
5. **Merge only what passed** — changed code or a moved target needs a fresh
   check.

Five roles carry that model: **Planner**, **Implementer**, **Captain**,
**Verifier**, and **Merge**. Their normal work produces four saved
handoffs—`plan.md`, `design.md`, `proof.md`, and `status.json`—using one JSON
Schema.

The five portable operations are:

- `baton-plan`
- `baton-implement`
- `baton-design-review`
- `baton-verify`
- `baton-merge`

Claude Code and Codex expose those operations as generated skills.

The board is a thin, read-only view of the repository. Looking at it cannot
move work forward.

## More than one track

Independent tracks can run at the same time. Inside each track, work stays
one-at-a-time. Tracks whose ordered work has passed can rejoin; a fresh
Verifier then checks the complete release, and Merge lands it only if the code
and target have not changed.

## Get started

The easiest route is to let the coding agent you already use install Baton.
Open Claude Code or Codex and paste:

```text
Install Baton v1.0.0-rc.3 for this coding agent. Clone
https://github.com/sawy3r/baton at that exact tag, read the root INSTALL.md,
and install it for this tool—Claude Code or Codex—at user scope. Run the
matching installer with --dry-run and show me the exact actions first. After I
approve, run the same scope with --yes. Do not edit instruction files directly;
only allow an instruction-file change made by the reviewed installer as part
of its exact audited v0.16 migration. Do not install Sworn or a model, or read
provider credentials. If this host is not supported, stop and tell me.
```

Prefer to do it yourself? Clone the reviewed release, then preview and run the
matching installer:

```sh
git clone --branch v1.0.0-rc.3 --depth 1 https://github.com/sawy3r/baton.git
cd baton

# Claude Code
./install-claude.sh --user --dry-run
./install-claude.sh --user --yes

# Codex
./install-codex.sh --user --dry-run
./install-codex.sh --user --yes
```

Project-local installs are also supported. See [INSTALL.md](INSTALL.md) for
Claude Code and Codex paths, board commands, migration, rollback, uninstall,
and failure behavior.

Then read the [platform-agnostic walkthrough](examples/README.md). It follows
one release from approved Plan through independent tracks, composition,
assembly verification, and exact Merge.

## Guided and autonomous use

Baton works in two modes:

- In **guided use**, a person chooses the next eligible operation and keeps
  responsibility boundaries separate.
- In **autonomous use**, an engine such as Sworn additionally has to prove
  scheduling, writer isolation, fresh context, credential isolation, recovery,
  cancellation, and final-effect behavior.

A driver is only a process adapter to a runner. The same driver can serve every
responsibility; the engine supplies an explicit model string or deliberate
`null` for each invocation. The driver does not pick defaults, retry, fall
back, rotate providers, or turn a model response into a Baton verdict.

## RC3 evidence

The current release candidate is
[`v1.0.0-rc.3`](docs/releases/v1.0.0-rc.3.md). Its portable profile passes 142
Node tests plus strict Python validation, one schema, generated-package parity,
real-Git dogfood, installer isolation, board security and performance, and all
nine measured overhead budgets.

RC3 loads 1,512 fixed words on the normal four-invocation path, or 2.6539% of
the measured Baton v0.16 baseline. Its five canonical operations total 1,504
words, and its largest complete generated Skill is 397 words.

The 12 autonomous-engine cases remain `NOT RUN`. Sworn must exercise them
through its real binary and boundaries before Baton can claim autonomous-engine
conformance. Portable success is not that claim.

## Repository map

- [`baton/CORE.md`](baton/CORE.md) — the five principles
- [`baton/PROTOCOL.md`](baton/PROTOCOL.md) — lifecycle and exact handoffs
- [`baton/ASSURANCE.md`](baton/ASSURANCE.md) — guided and autonomous assurance
- [`baton/CONFORMANCE.md`](baton/CONFORMANCE.md) — observable obligations
- [`operations/`](operations/) — the five canonical operations
- [`schemas/work-status-v1.json`](schemas/work-status-v1.json) — the sole
  authored status schema
- [`reference/`](reference/) — record actions, board, and driver seam
- [`conformance/`](conformance/) — portable and autonomous profiles

## History

RC3 retains RC2’s replacement for RC1’s experimental record model; the
[RC1 release note](docs/releases/v1.0.0-rc.1.md) remains as history. Baton 0.x
is preserved at the immutable
[`v0.16.0`](https://github.com/sawy3r/baton/tree/v0.16.0) tag. RC3 can
transactionally migrate one exact audited Claude v0.16 user installation, but
the RC3 protocol does not reinterpret old delivery records.

## License

[MIT](LICENSE)

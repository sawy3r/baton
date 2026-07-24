# Baton

Baton is a small protocol and portable kit for software delivery whose “done”
claim can be checked. It gives an agent team five clear responsibilities, keeps
the important handoffs in Git, and refuses to merge anything except the exact
candidate that passed independent verification.

```text
approved Plan
  -> Implementer design
  -> Captain
  -> Implementer build and proof
  -> fresh Verifier
  -> exact Merge
```

Baton defines the rules and records. [Sworn](https://github.com/sawy3r/sworn)
is the reference engine being built to coordinate those rules autonomously.
Baton does not run models, host inference, keep provider credentials, or choose
a model for you.

## The small model

Five principles make completion trustworthy:

1. **Bounded authority** — work stays inside an externally approved Plan.
2. **Durable truth** — repository facts and validated records outrank chat.
3. **Real evidence** — proof binds checks to one exact candidate.
4. **Independent verification** — a fresh Verifier checks the builder’s work.
5. **Safe composition** — Merge integrates only the passed candidate against
   the expected target.

Five responsibilities carry that model: **Planner**, **Implementer**,
**Captain**, **Verifier**, and **Merge**. Their normal work produces four
durable handoffs—`plan.md`, `design.md`, `proof.md`, and `status.json`—using one
authored JSON Schema.

The five portable operations are:

- `baton-plan`
- `baton-implement`
- `baton-design-review`
- `baton-verify`
- `baton-merge`

The board is a thin, read-only view of those durable facts. Editing a board
cannot advance delivery.

## More than one track

Independent tracks may move at the same time, while work inside each track
remains serial. When a track passes, Merge freezes its exact head and composes
it into the release line. After every track is composed, Merge prepares one
assembly proof, a fresh Verifier checks the whole product, and release Merge
updates the target only if it is still the expected commit.

## Get started

From this repository checkout, preview and install either host package:

```sh
./install-claude.sh --user --dry-run
./install-claude.sh --user --yes
```

```sh
./install-codex.sh --user --dry-run
./install-codex.sh --user --yes
```

Project-local installs are also supported. See [INSTALL.md](INSTALL.md) for
Claude Code and Codex quick starts, invocation, board commands, migration,
rollback, uninstall, and failure behavior.

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

## RC2 evidence

The current release candidate is
[`v1.0.0-rc.2`](docs/releases/v1.0.0-rc.2.md). Its portable profile passes 132
Node tests plus strict Python validation, one schema, generated-package parity,
real-Git dogfood, installer isolation, board security and performance, and all
nine measured overhead budgets.

RC2 loads 1,512 fixed words on the normal four-invocation path, or 2.6539% of
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

RC2 supersedes RC1’s experimental record model; the
[RC1 release note](docs/releases/v1.0.0-rc.1.md) remains as history. Baton 0.x
is preserved at the immutable
[`v0.16.0`](https://github.com/sawy3r/baton/tree/v0.16.0) tag. RC2 can
transactionally migrate one exact audited Claude v0.16 user installation, but
the RC2 protocol does not reinterpret old delivery records.

## License

[MIT](LICENSE)

# Baton

Baton is a simple way for AI agents to hand software work to one another
without losing track of what was agreed or what actually passed.

> Baton is how the work is handed off. Sworn is the team that carries it.

```text
You approve the work
        |
        v
Implementer explains the approach
        |
        v
Captain checks the approach
        |
        v
Implementer builds it
        |
        v
Fresh Verifier checks the result
        |
        v
Merge exactly what passed
```

The point is straightforward: the agent that builds the work does not get the
final say, and the version that was checked is the version that gets merged.
If a tool crashes or a response is malformed, Baton stops rather than guessing
that the work passed.

[Sworn](https://github.com/swornagent/sworn) runs this loop: it starts agents,
keeps work moving, recovers interrupted runs, connects to different AI tools,
and shows progress. Baton itself is only the shared way of working. It does not
run models, hold provider credentials, or choose a model.

## The five jobs

- **Planner** — turns the goal into small pieces that a person approves.
- **Implementer** — explains an approach, then builds the approved work.
- **Captain** — checks the approach before implementation begins.
- **Verifier** — starts fresh and checks the finished work independently.
- **Merge** — combines and merges only the exact work that passed.

These are responsibilities, not a requirement for five people, five providers,
or five long-running processes.

If the Verifier records `FAIL`, the Implementer fixes the same piece of work.
The same independent Verifier may check the repair under the
[direct-repair rule](baton/PROTOCOL.md#direct-repair-continuation), or a new one
may start fresh. Either way, it checks the whole result again.

## What Baton keeps

Baton keeps only the facts needed to trust the handoff:

- the approved plan;
- the exact work each decision covered;
- a small receipt for each decision or result; and
- the evidence that shows what passed.

The code, tests, diff, commits, and Git history carry most of the detail. Baton
does not require a second pile of design and proof documents.

The plan says what must be true, not every file an agent might touch. Finding a
supporting test, helper, or useful extra check does not restart the work.
Changing the promised behavior, a real product dependency, who may approve
the work, or another externally owned decision does.

## Use Baton in any agent tool

Baton ships five standalone Agent Skills:

- `baton-plan`
- `baton-implement`
- `baton-design-review`
- `baton-verify`
- `baton-merge`

Ask the agent already running in your tool to install the exact RC13 payload:

```text
Install Baton v1.0.0-rc.13 from
https://github.com/sawy3r/baton.git.

Check out that exact tag and read INSTALL.md. Determine this tool's real user
or project skills directory from current documentation or the live
environment. Show me the complete no-write preview and wait for my approval
before applying it. Do not guess paths, edit instruction files, or install
Sworn. After approval, install the exact payload and prove in a clean context
that all five Baton skills are discovered.
```

The agent finds the right skills folder for the tool, shows exactly what it
will change, waits for approval, installs the files, and proves the tool can
see all five skills. See [INSTALL.md](INSTALL.md) for the full safety checks.

## Technical reference

- [`skills/`](skills/) — generated five-skill standalone payload
- [`operations/`](operations/) — canonical operation sources
- [`baton/CORE.md`](baton/CORE.md) — five trust principles
- [`baton/PROTOCOL.md`](baton/PROTOCOL.md) — responsibilities, facts, and receipts
- [`baton/ASSURANCE.md`](baton/ASSURANCE.md) — standard and heightened assurance
- [`baton/CONFORMANCE.md`](baton/CONFORMANCE.md) — observable obligations
- [`reference/`](reference/) — portable receipt, Git, and read-only board kit
- [`conformance/`](conformance/) — portable and autonomous profiles

Plans keep the same release and slice names as work changes. A new design is
another attempt on the same slice; a failed implementation is repaired on that
same slice; and a changed plan keeps completed work whose promise and inputs
did not change. Git preserves the earlier versions.

## License

[MIT](LICENSE)

---
title: Project extensions — repo-specific steps for the role prompts
description: How a project adds setup/teardown or extra checks to Baton's universal role contracts without forking the role prompts.
---

# Project extensions

Baton's role prompts (`role-prompts/{planner,implementer,verifier,captain}.md`) are
**universal** — they describe the protocol, not your repo. But a given project often
needs repo-specific steps the universal contract can't know about: booting a real
server or fixture before tests/screenshots, allocating ports for parallel runs,
seeding a database, or an extra review check.

Rather than fork the role prompts (which then drift from upstream), drop a
project-local extension file and let the role pick it up.

## How it works

Each role prompt, at session start, reads `docs/baton/extensions/<role>.md` **if it
exists** and follows it:

```
docs/baton/extensions/planner.md
docs/baton/extensions/implementer.md
docs/baton/extensions/verifier.md
docs/baton/extensions/captain.md
```

These live in **your repo** (version-controlled, visible to collaborators and CI),
alongside the rest of `docs/baton/`. None is required; a role with no extension file
behaves exactly as the universal contract specifies.

## The contract

- An extension may **add** steps (setup at session start, teardown before the session
  ends in any terminal state, extra checks).
- An extension may **not relax** the role's hard constraints, gates, or verdict
  semantics. On any conflict, the role prompt wins.
- For the **verifier**, reading the extension file is explicitly permitted despite the
  "read only the listed artefacts" rule — it is part of the contract, not slice context.

## Example — boot a real server pair before verifying

`docs/baton/extensions/verifier.md`:

```markdown
# Verifier extension

**Session start:** run `scripts/server-start.sh`. It allocates a free server pair
(atomically, so parallel-track verifiers don't collide), boots API + web, and prints
`API_PORT` / `WEB_PORT`. Run all tests and screenshots against those ports — the
no-mock boundary (Rule 10) requires the real server, not a stub.

**Before emitting your verdict (any outcome):** run `scripts/server-stop.sh` to release
the pair.
```

Mirror the start step in `docs/baton/extensions/implementer.md` so screenshots
(Rule 1 reachability) are captured against the same real infra.

## Notes

- Keep the *allocation* logic in the script, not the prose: a `flock`'d port index that
  reaps dead PIDs and hands out the next free pair makes parallel runs safe without any
  hand-maintained state.
- Extension files are read by whatever drives the role — a human running the slash
  commands, an automation loop, or a product that vendors these prompts — so the same
  file works across all of them.

---
title: Releasing Baton
description: Semver-tag release discipline for the Baton protocol — what bumps major/minor/patch, how a tag is cut, and how downstream tools pin.
---

# Releasing Baton

Baton is versioned with **semver against its _content_** — the rules, role
prompts, templates, brainstorm patterns, and the harness scripts that make
Rules 6–11 enforceable. It is a protocol, not a library: the "API" is the rule
and role contracts adopters build their process on.

The canonical current version lives in the top-level [`VERSION`](VERSION) file
and is mirrored by the matching git tag. Downstream tools pin Baton by **semver
tag** (never a raw commit SHA) and report the pinned version truthfully — e.g.
`on Baton v0.4.2`.

## What bumps what

| Change | Bump | Example |
|---|---|---|---|
| Breaking restructure — a removed or renamed rule, a changed role contract, a reworded rule that changes adoption behaviour, a removed gate script | **major** | drop a rule; rename a role; redefine a slice state |
| A new rule, a new role, a new gate script, a new LLM check type | **minor** | Rules 8–11 + Captain role + gate suite (`v0.5.0`) |
| Wording, clarifications, docs, new templates, new brainstorm patterns, new examples, new architecture rules — anything additive that does not change an existing rule, role, or script contract | **patch** | agent-driven install + roadmap refresh (`v0.4.1`); operational gates promoted into role prompts (`v0.4.2`) |

Tie-breaker between minor and patch: **does an existing adopter have to _do_
anything to stay correct?** If yes, it is at least a minor. If the change only
adds or clarifies without altering an existing contract, it is a patch.

The historical evolution of the rules themselves is recorded in
[`claude/baton/RULES-HISTORY.md`](claude/baton/RULES-HISTORY.md).

## Cutting a release

1. Land every change for the release on `main` via PR.
2. In a single release commit, **bump [`VERSION`](VERSION)** to the new
   `vMAJOR.MINOR.PATCH`.
3. Tag that commit and push the tag:
   ```bash
   git tag -a vX.Y.Z -m "Baton X.Y.Z — <headline>"
   git push origin vX.Y.Z
   ```
   A published tag is **immutable** — never move it. Consumers pin to its SHA;
   moving a tag silently desyncs every pin.
4. Publish a GitHub Release for the tag with notes: highlights plus a
   `https://github.com/sawy3r/baton/compare/vPREV...vX.Y.Z` changelog link.

## Notes for consumers

- **Pin by tag** (`vX.Y.Z`), not by SHA. The `VERSION` file lets you verify the
  pin and report the protocol version you implement.
- `main` runs **ahead of the latest tag** between releases. `VERSION` reflects
  the last cut tag, not `main`'s tip — so vendor from a **tag**, not from
  `main`, when you need a stable pin.
- Adopters who install rather than vendor (`git pull && ./install.sh`) always
  track `main`; the tag/release is a version marker and changelog boundary, not
  the delivery mechanism.

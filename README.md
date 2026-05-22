# baton

> A protocol for agent work that survives session boundaries — plan, implement, and verify in sealed contexts, with proof bundles as the only currency between them.

**The baton is the proof bundle.** Three roles, three sealed sessions, one file on disk that crosses between them.

```
                                  fresh-context boundary
                                        (Rule 7)
                                             ║
   ┌──────────┐   spec.md   ┌────────────┐   ║   proof.md   ┌──────────┐
   │ planner  │ ───────────►│ implementer│ ──╫─────────────►│ verifier │
   └──────────┘             └────────────┘   ║              └──────────┘
        ▲                                    ║                    │
        │             status.json            ║                    │
        └────────────────────────────────────╨────────────────────┘
                            PASS / FAIL / BLOCKED
```

The double bar between implementer and verifier is the load-bearing piece: when the verifier session starts, it is a **brand-new context window** with no inherited transcript, framing, or reasoning from the implementer. It reads only `spec.md`, `proof.md`, and `status.json` from disk, then returns `PASS` / `FAIL` / `BLOCKED`. Without that separation, baton's Rule 7 collapses into "the same LLM marking its own homework" — which is precisely the failure mode it exists to prevent.

The other arrows are read/write traffic through artefacts on disk (`spec.md`, `proof.md`, `status.json`). The status.json loop back to planner is the state machine that tracks each slice's lifecycle (`planned` → `in_progress` → `implemented` → `verified` → `shipped`).

**License:** [MIT](LICENSE) — permissive, attribution-only. Use it in any project, commercial or otherwise.

---

## Why baton

If you've shipped non-trivial work with an LLM coding agent, you may have hit one or more of these:

- **Overclaiming.** Session ends with "implementation complete" and a 90% confidence score. Next session opens the repo and finds half the work missing, the other half wired up wrong, with tests that pass because they only exercise leaf components.
- **Dark code.** A primitive is built, tested with TDD, and never wired into a user-reachable surface. Component renders zero times in production. Discovered weeks later during an audit.
- **Silent deferrals.** Inline `// TODO`, `// deferred`, `// later` markers in committed code — referencing decisions that were never tracked, never acknowledged, and now have no owner.
- **Context loss.** Substantial analysis lives only in chat transcript. `/clear` happens. The reasoning is gone. The next session starts from scratch.
- **Plan / proof drift.** Planning docs say one thing, implementation does another, the divergence is never surfaced.

baton is the minimum-viable protocol that addresses these *specifically* — not a complete engineering methodology. Seven rules, three roles, seven slash commands. The rules are derived from a real release audit where each of the above failure modes was observed and traced to a specific structural gap.

## The seven rules

Each rule has a one-line summary here and a full doc explaining the failure mode, the rule, and why looser variants don't work.

| # | Rule | One-liner | Doc |
|---|------|-----------|-----|
| 1 | Reachability gate | Every UI feature's first failing test renders through the user-path integration point, not the leaf component in isolation. | [reachability-gate.md](claude/baton/reachability-gate.md) |
| 2 | No silent deferrals | Inline "deferred" / "TODO" / "later" requires *why* + *tracking* + *acknowledgement* — all three, surfaced before the comment lands. | [no-silent-deferrals.md](claude/baton/no-silent-deferrals.md) |
| 3 | Capture discipline | Conversation context is the most ephemeral persistence layer; subagent findings and decisions land in durable storage before session ends. | [capture-discipline.md](claude/baton/capture-discipline.md) |
| 4 | Commit messages as capture | Decisions are restated in the commit message body, not "see plan X" — git log becomes the immutable record. | [commit-messages-as-capture.md](claude/baton/commit-messages-as-capture.md) |
| 5 | Session discipline | Sessions anchored to durable trackers (issues, plans); captures at every session boundary, not only at the end. | [session-discipline.md](claude/baton/session-discipline.md) |
| 6 | Proof bundle | Completion claims require a structured proof file written from live repo state, not paraphrased from memory. | [proof-bundle.md](claude/baton/proof-bundle.md) |
| 7 | Adversarial verification | Verification runs in a fresh-context session loaded only with the proof artefacts — never in the implementer's window. | [adversarial-verification.md](claude/baton/adversarial-verification.md) |

Rules 1–5 are advisory text — splice them into your project's `AGENTS.md` / `CLAUDE.md` and they shape every session. Rules 6 and 7 require the Release Mode harness (the slash commands and templates this repo installs) to be enforceable.

## Example artefacts

The protocol's whole pitch is "files between sessions." Here's what those files actually look like.

A `status.json` (the state machine for a single slice):

```json
{
  "slice_id": "S03-account-settings-page",
  "state": "implemented",
  "planned_files": ["src/components/AccountProfileSection.tsx", "e2e/account-settings.spec.ts"],
  "actual_files": ["src/components/AccountProfileSection.tsx", "src/components/useAccountStore.ts", "e2e/account-settings.spec.ts"],
  "test_commands": ["pnpm playwright test e2e/account-settings.spec.ts"],
  "reachability_artifacts": ["e2e/account-settings.spec.ts:24 — user gesture + assertion"],
  "verification": { "result": null, "verifier_was_fresh_context": null, "violations": [] }
}
```

A trimmed `proof.md`:

```markdown
# proof — S03-account-settings-page

## Scope
User can update their profile via the account settings page and see the changes reflected.

## Files changed
3 files; e2e/account-settings.spec.ts is new and exercises the integration point.

## Test results
Playwright suite — 8 tests, all green. Captured output: ...

## Reachability artefact
e2e/account-settings.spec.ts:24 simulates the full user gesture
(click → form fill → submit) and asserts the updated profile renders.

## Delivered
- Form submit updates profile in store
- Dashboard re-renders within 200ms

## Not delivered
- Multi-currency support (deferred to S05; tracked in journal.md, acknowledged 2026-05-12)
```

A `journal.md` accumulates state transitions and verifier verdicts over the slice's lifetime. The full templates live in [`claude/baton/release-mode-template/`](claude/baton/release-mode-template/).

## Quick install

```bash
git clone https://github.com/sawy3r/baton.git ~/projects/baton
cd ~/projects/baton
./install.sh
```

Or preview first:

```bash
./install.sh --dry-run   # show what would be installed without copying
./install.sh --help      # full options
```

Set `CLAUDE_HOME=/custom/path` before running `install.sh` to install under a non-default location (default: `$HOME/.claude`).

Update later with `git pull && ./install.sh` from the same directory.

## What lands where

| Source in repo                         | Installed to                                  | Purpose                                              |
| -------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `claude/commands/*.md`                 | `~/.claude/commands/`                         | User-level slash commands, available in every repo  |
| `claude/baton/`                        | `~/.claude/baton/`                            | Rule docs, role prompts, release-mode templates     |
| `bin/release-verify.sh`                | `~/.claude/bin/release-verify.sh`             | Deterministic first-pass verifier, invoked by abs path |
| `bin/release-board-status.sh`          | `~/.claude/bin/release-board-status.sh`       | Release board — terminal go/no-go verdict (exit 0/1)   |
| `bin/release-board-ui.mjs`             | `~/.claude/bin/release-board-ui.mjs`          | Release board — auto-refreshing HTML dashboard         |
| `bin/lib/release-board.mjs`            | `~/.claude/bin/lib/release-board.mjs`         | Shared branch-aware board reader (used by both above)  |

Nothing under `~/.claude/CLAUDE.md` is touched. Wiring the AGENTS-fragment rules into your global instructions is a deliberate manual step — see the post-install message printed by `install.sh`.

## Per-project setup

Each repo that wants to use Release Mode needs:

1. A `docs/release/` directory at the repo root (the commands create sub-folders here per release). If your docs site renders content from a different location, symlink it to `docs`.
2. The Rule 1–5 fragment from `~/.claude/baton/AGENTS-fragment.md` either appended to the project's `AGENTS.md` / `CLAUDE.md`, OR appended to `~/.claude/CLAUDE.md` once for all projects.

That's it. `/plan-release <YYYY-MM-DD-theme>` from a fresh session bootstraps the release folder from the templates.

## The session loop

For each release:

1. **Planner session** — fresh window. Human pastes `/plan-release <name>`. Conversational discovery; planner writes `intake.md`, decomposes into slices, groups the slices into touchpoint-disjoint **tracks**, writes `spec.md` per slice. No code written here. (Revising a release already in flight is `/replan-release <name>`.)
2. **Implementer session, per slice** — fresh window. Human runs `/implement-slice <slice-id>`. Implementer reads `spec.md`, makes changes, writes `proof.md` from live repo state, runs `release-verify.sh`, stops at state `implemented`. **Never marks `verified`.**
3. **Verifier session, per slice** — *another* fresh window with no inherited context. Human runs `/verify-slice <slice-id>`. Verifier reads only `spec.md`, `proof.md`, `status.json`, and live repo state. Returns `PASS` / `FAIL: <numbered violations>` / `BLOCKED: <reason>`.
4. **Merge a track** — when every slice in a track is verified, `/merge-track <track-id>` lands the track branch on the release assembly branch `release-wt/<name>`.
5. **Merge the release** — when every track is merged, `/merge-release <name>` integrates `release-wt/<name>` back to the integration base.
6. **Mark it shipped** — once the integration branch has actually deployed to production, `/mark-shipped <name>` flips every `verified` slice to the terminal `shipped` state, recording the deployed commit as evidence. Bookkeeping only — it does not deploy.

Tracks run in parallel — one implement/verify session line per track, each in its own worktree. The model is in [`claude/baton/track-mode.md`](claude/baton/track-mode.md). The cost of three sessions per slice is one extra session window. On a flat-rate plan that's effectively free. On metered usage it's still cheaper than the rework cost of an overclaimed slice discovered three sessions later.

## Tracking the board

Two read-only tools report release progress straight from git — no database, no state file. Both resolve every slice's authoritative `status.json` from the `track/*` and `release-wt/*` branches, so the terminal verdict and the dashboard agree by construction:

- `release-board-status.sh [--verbose]` — terminal go/no-go verdict. Exits `0` when every slice is in a terminal state (`verified` / `shipped` / `deferred`), `1` otherwise — scriptable as a ship gate.
- `release-board-ui.mjs [--port N]` — a local auto-refreshing HTML dashboard at `http://localhost:3333`, incomplete releases sorted to the top.

Run either from inside the repo. The release-docs root defaults to `docs/release/`; set `BATON_RELEASE_DIR` to override for custom layouts.

## Path tokens

The slash commands use two runtime tokens the agent resolves on first Bash call:

- **`<REPO_ROOT>`** — output of `git rev-parse --show-toplevel` from the project's primary checkout.
- **`<REPO_BASENAME>`** — `basename "<REPO_ROOT>"`, used to namespace the release worktrees folder (`$HOME/projects/<REPO_BASENAME>-worktrees/`) so multiple projects on the same machine don't collide.

## Caveats

- **Claude Code only today.** The slash commands target Claude Code's directives ecosystem (`~/.claude/commands/`). Cross-tool adapters for Codex, Gemini, and OpenCode are on the [roadmap](ROADMAP.md).
- **Per-project memory is optional.** If your tool maintains per-project persistent memory (Claude Code stores it under `~/.claude/projects/<encoded-cwd>/memory/MEMORY.md`), the planner reads it at session start. On a clean install it doesn't exist; the step skips silently.
- **`release-verify.sh` is opinionated.** It checks for required artefact files, valid JSON in `status.json`, non-empty diff vs the base branch, dark-code markers in changed files, and required `proof.md` sections. It does *not* make subjective calls about whether the diff actually implements the spec — that's the LLM verifier's job.

## Roadmap

baton today ships slash commands for Claude Code only. Cross-tool adapters for OpenAI Codex CLI, Gemini CLI, and OpenCode are next; a Claude Code plugin manifest comes after. See [ROADMAP.md](ROADMAP.md) for the full phased design.

## Contributing

The seven rules are deliberately minimal and deliberately fixed — they're the smallest intervention that addresses the specific failure modes catalogued in the rule docs' `## Provenance` sections. If you want a different rule-set, fork and amend.

For everything else — bugs in the harness, slash-command improvements, adapter contributions for other tools, doc clarifications — issues and PRs are welcome.

## Releases

Versions and release notes live on the [Releases page](https://github.com/sawy3r/baton/releases). Tag the version you want, clone or download, run `./install.sh`.

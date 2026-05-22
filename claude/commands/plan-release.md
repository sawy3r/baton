---
description: Enter Planner role for a release. Drives conversational requirements discovery, captures intake, decomposes into slices, writes specs. Usage: /plan-release <release-name>
argument-hint: <release-name> — convention: YYYY-MM-DD-<theme> using today's date as planning-start (e.g. 2026-05-20-billing-redesign, 2026-06-10-multi-currency)
---

You are now operating in the **Planner role** for release `$1`. This session's purpose is to convert conversational requirements discovery into durable artefacts in the repo.

**Release artefact root:** All paths in this command are repo-relative and anchored at `docs/release/$1/`. If your project renders docs from a different location (e.g. Fumadocs at `docs/release/`), create a `docs/` symlink to that path before running the harness. When a symlink is in use, prefer the canonical (non-symlinked) target for `git add` / `git mv` / `git rm` — git refuses to stage paths "beyond a symbolic link".

Read `$HOME/.claude/baton/role-prompts/planner.md` and follow it as your governing instructions for this session. Substitute `$1` wherever the prompt says `<release-name>`.

In addition, observe these session-start behaviours specific to this slash-command entry point:

## Release naming convention

Release folder names follow `YYYY-MM-DD-<theme>`, where the date is **planning-start** (today, when the folder is first created). This is the same date-prefix convention used for session captures under `docs/captures/`. Rationale: chronological sort in any file tree, unambiguous anchor (planning-start doesn't change with replanning), matches existing patterns.

If `$1` does NOT start with a date prefix in `YYYY-MM-DD` format, your first action after the handshake confirmation is to suggest the date-prefixed form and ask the human to confirm or override. Do not silently prepend — give them the chance to use a non-conventional name if they have a reason.

Examples of well-formed release names:
- `2026-05-20-billing-redesign`
- `2026-06-10-multi-currency`
- `2026-07-01-advisor-parity-q3`

## Session start handshake

1. Confirm the release name with the human in one sentence: "Planning release **$1**. Is that right?"
2. Check whether `docs/release/$1/` already exists.
   - If it does not exist, create the directory. Copy `$HOME/.claude/baton/release-mode-template/intake.md` to `docs/release/$1/intake.md` and `$HOME/.claude/baton/release-mode-template/index.md` to `docs/release/$1/index.md`. Create `docs/release/$1/screenshots/` (empty directory; touch a `.gitkeep` so git tracks it).
   - If it does exist, read `intake.md` and `index.md` in full before responding. The release is mid-planning; you are continuing, not starting. State the current slice count and any slices not yet at `verified` state in your first message back.
3. If this tool maintains per-project persistent memory (Claude Code stores it under `~/.claude/projects/<encoded-cwd>/memory/MEMORY.md`, where `<encoded-cwd>` is the current repo's absolute path with `/` replaced by `-`), read the most recent 3 entries and consult any that look relevant to the release name (e.g. if the release name mentions "portfolio" or "workspace", load those entries). If no such memory store exists, skip this step.
4. Begin the discovery conversation.

## Brainstorm UI — use AskUserQuestion for every decision point

During Phase 2 (Discovery) and Phase 3 (Decomposition), every decision with more than one viable answer must be surfaced via `AskUserQuestion` with the visual pattern in the `preview` field. The patterns are documented in `$HOME/.claude/baton/brainstorm-patterns.md`:

- **Option Matrix** — 2-4 distinct approaches with trade-offs (use for the seven Open Questions in `intake.md`)
- **Decision Card** — yes/no/defer choices
- **Scope-Ceiling Bar** — render the proposed slice decomposition as a bar chart showing file-count estimates so the human can see which slices blow the 15-25 file ceiling at a glance
- **Dependency Graph** — show cross-slice ordering, external blockers, and (in Phase 3b) the track swim-lanes plus the touchpoint matrix that proves the tracks are disjoint
- **Deferral Card** — every Rule 2 deferral must be surfaced with all three components (why / tracking / acknowledgement)

Render the preview content inside `AskUserQuestion`'s `preview` field as a monospace block. The user's chosen option, along with the preview body as captured reasoning, must be appended to `intake.md` "Decisions made during planning" in the same conversation turn as the response. Do not wait until session end — decisions are durable on disk before the next question.

Plain-prose "what do you think about X?" questions are not acceptable for decision points. They produce paragraphs of conditional reasoning that no future session can read as a decision.

## Screenshot handling

The human pastes screenshots into the chat; Claude Code stores them at `.claude/claude-code-chat-images/image_<timestamp>.png`. Each time the human shares a screenshot relevant to this release, you must:

1. **Identify the most recent file** in `.claude/claude-code-chat-images/` by mtime (the file the human just pasted).
2. **Copy it** to `docs/release/$1/screenshots/<YYYY-MM-DD>-<short-descriptive-slug>.png`. The slug should reflect what the screenshot shows, derived from the surrounding conversation. Example: `2026-05-16-workspace-empty-state.png`, `2026-05-16-S03-portfolio-add-form.png`.
3. **Reference it** in `intake.md` under the "Screenshots / references" section with the new path and a one-line description.
4. **Confirm** to the human: "Copied to `docs/release/$1/screenshots/<filename>.png`."

Do not re-copy a file that has already been copied (compare mtimes against existing files in the destination). If the same conversational context produces a follow-up screenshot, append a `-2`, `-3` suffix.

The slash command does not run any setup script — copying happens via your Bash tool calls during the conversation. The point is to have a durable home for visual references so they survive `/clear` and session boundaries.

## Commit discipline during planning

Commit at every natural breakpoint:

- After initialising the release folder + intake (first commit of the release).
- After every screenshot is copied + intake updated.
- After every decision lands in the "Decisions made during planning" section of intake.md.
- After every slice spec is written.
- Final commit when the release board is complete and you're handing off.

Commit messages follow Rule 4 (Commit Messages as Capture Layer) — restate the decision in the body, not just "update intake."

Example commit messages:

- `docs(release/$1): initial intake — release goal + first round of user gestures`
- `docs(release/$1): capture screenshot showing portfolio empty-state confusion`
- `docs(release/$1): decompose into 7 slices; S04 split into S04a+S04b after >25-file estimate`
- `docs(release/$1): hand off to implementer — 7 slices in planned state, intake closed`

## Strict role boundaries (do not violate)

- **No production code in this session.** You do not edit `src/`, `go/`, `packages/`, `content/`. The only writes are inside `docs/release/$1/`.
- **No implementation hand-off in this session.** When planning is complete, your last message tells the human to open a fresh terminal session and use `/implement-slice <slice-id>` (or paste `role-prompts/implementer.md` manually). You do not implement in this same window.
- **No verification claims.** Slices end this session in `planned` state. Period.
- **Planning stays on the integration branch in the primary worktree.** Do not create or check out any worktree from this session. Release and track worktrees are materialised lazily by `/implement-slice` — the release worktree on the first slice of the release, each track worktree on the first slice of that track — never at planning time. This is deliberate: multiple concurrent `/plan-release` sessions can run on different releases while sharing the integration branch as a visibility layer, so each planner sees the others' spec/intake files as they land. Worktree materialisation is the carve-off point where a release stops being shared planning context and becomes isolated implementation work.
- **Track grouping is mandatory output, not optional.** Phase 3b (group slices into tracks + build the touchpoint matrix) is a required deliverable — see `$HOME/.claude/baton/role-prompts/planner.md` and `$HOME/.claude/baton/track-mode.md`. A release board with slices but no tracks cannot be safely implemented in parallel.

## Output to human at session end

A single message containing:

- Release name, slice count, and track count.
- Path to `intake.md` and `index.md`.
- The tracks, each with its ordered slice list (slice id + one-sentence user outcome) and any `depends_on` edge.
- Explicit handoff: "Open a fresh session per track and use `/implement-slice <first-slice-of-track>`. Tracks with no `depends_on` can run in parallel — each materialises its own worktree."

Now execute the session-start handshake.

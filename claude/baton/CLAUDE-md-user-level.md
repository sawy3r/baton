---
title: User-level CLAUDE.md fragment
description: Optional fallback rules to apply across all your projects, regardless of project-level adoption
---

# CLAUDE-md-user-level.md

For individual developers using Claude Code (or equivalent) who want Baton rules to apply across all their projects — even those that haven't adopted the package yet — copy the block below into your `~/.claude/CLAUDE.md` (or equivalent for your tool).

This is **per-user, not per-project**. Project-level `CLAUDE.md` / `AGENTS.md` takes precedence on conflicts; this file fills gaps where the project hasn't spoken.

---

# User-level instructions

## Test discipline — user-reachability gate

For any feature with a user-facing affordance, the first failing test in a TDD cycle must render through the integration point that owns the affordance, not the leaf component in isolation.

- If the integration point can't render the feature yet, THAT failure is the correct TDD red. Build the integration glue first; the leaf falls out.
- Leaf-level unit tests are fine in addition for edge cases. They cannot be the sole proof of life.
- A component imported only by its own test file is a red flag. Investigate before claiming the task done.
- "Pass 1 / Pass 2" splits are acceptable ONLY when Pass 2 is created, tracked, and has a named owner/deadline at the moment Pass 1 lands.

Before marking any phase complete, produce a reachability artefact: a screenshot, an end-to-end test run, or an explicit "open browser, do X, observe Y" smoke step. A green typecheck plus green unit suite is not a reachability artefact.

## No silent deferrals

"Deferred" as an inline code comment is not a decision unless all three are present:

1. Why — concrete reason
2. Tracking — linked issue / plan / punch-list item
3. Acknowledgement — user told in plain text

Without all three, the inline comment is dark code's data-model cousin: looks tracked, isn't. When tempted to write `// deferred` / `// later` / `// future` / `// TODO` on a schema or contract surface, surface the decision first.

## Capture discipline

Conversation context is the most ephemeral persistence layer. Bias every capture decision toward higher-permanence layers (git history > code > docs > issues > memory > conversation). Conversation is a working surface, not a storage surface.

For substantial subagent findings: instruct the subagent to save its output to disk as part of its task, not just return to conversation.

For substantial sessions: write a session handoff capture before the session ends.

## Commit messages as capture

Commits that land a decision restate the decision in the message body, not "see plan X." Use 3-5 line bodies for non-trivial commits. `git log` is permanent; plans move.

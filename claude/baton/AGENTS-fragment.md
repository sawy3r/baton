---
title: AGENTS.md fragment — canonical block to copy
description: The minimal text block to paste into your project's AGENTS.md (or CLAUDE.md, GEMINI.md, etc.) to adopt Baton
---

# AGENTS-fragment.md

Copy the block below into your project's agent-instructions file. Trim or extend project-specific examples; the core rules are minimal by design.

---

## Engineering Process — Baton

This project follows the **Baton** rule-set (see `/docs/baton/` for full rule docs and provenance). Seven rules, listed in priority order:

### 1. Reachability Gate (CRITICAL)

For any feature with a user-facing affordance (UI control, route, form field, API endpoint), the first failing test must render through the integration point that owns the affordance — NOT the leaf component in isolation.

- If the integration point can't render the feature yet, THAT failure is the correct TDD red. Build the integration glue first; the leaf falls out.
- Leaf-level unit tests are fine in addition. They cannot be the sole proof of life.
- A component imported only by its own test file is a red flag. Investigate before claiming task done.
- "Pass 1 / Pass 2" splits are acceptable ONLY when Pass 2 is created, tracked, and owned at the moment Pass 1 lands.

Before marking any phase complete, produce a **reachability artefact**: screenshot, end-to-end test run, or explicit "open browser, do X, observe Y" smoke step. A green typecheck plus green unit suite is not a reachability artefact.

### 2. No Silent Deferrals

"Deferred" as an inline code comment is not a decision unless all three are present:

1. **Why** — concrete reason (framework limitation, blocking dependency, scope cut)
2. **Tracking** — linked issue, plan task, or punch-list item
3. **Acknowledgement** — decision-maker told in plain text

Without all three, the inline comment is rationalisation, not decision. When tempted to write `// deferred` / `// later` / `// future` / `// TODO` on a schema or contract surface, surface the decision first.

### 3. Capture Discipline

Conversation context is the most ephemeral persistence layer. Subagent findings + session decisions must land in durable storage before session ends.

**Durability hierarchy (most to least permanent):**

1. Git history (commit messages)
2. Code itself
3. `/docs/` content
4. GitHub Issues + comments
5. Per-project memory
6. Conversation context

Bias every capture decision toward higher-numbered-permanence layers. Conversation context is a working surface, not a storage surface.

**Subagent output handling:** any subagent dispatch producing a substantial findings doc MUST save its output to `docs/captures/<date>-<topic>.md` as part of the agent's task, not just return to conversation.

### 4. Commit Messages as Capture Layer

Commits that land a documented decision MUST restate the decision in the message body, not just "see plan X."

- Plans get edited and moved; `git log --format="%B"` is permanent.
- Use 3-5 line bodies for any commit landing a decision, even when the diff is small.
- Trailers (Co-Authored-By, etc.) come after rationale, not in place of it.
- Single-line commit messages are fine for trivial mechanical changes.

### 5. Session Discipline

Implementation sessions of non-trivial scope are anchored to GitHub Issues.

- **Session start:** Ask which issue the work belongs to. If none, create one before starting.
- **During the session:** At natural breakpoints, capture key decisions, trade-offs, and progress to the issue.
- **Session end:** Record decisions, completed work, deferred items, next steps. If substantial analysis happened, write a handoff capture at `docs/captures/<date>-<topic>-handoff.md`.

Use GitHub Issues for epics, feature specs, implementation plans, session captures. Use `/docs/` for ADRs, RFCs, operational guides, strategy docs, stable reference material. If the content will become stale as work progresses, it belongs in an issue rather than `/docs/`.

### 6. Proof Bundle (CRITICAL)

Before marking any task, phase, or session complete, the agent must produce a **proof bundle** at `docs/captures/<date>-<topic>-proof.md` (or, for release-mode work, at `docs/release/<release-name>/<slice-id>/proof.md`). The bundle must be generated from live repo state — not recalled from context.

**Required sections:**
- **Scope** — one sentence: what was this task meant to deliver?
- **Files changed** — output of `git diff --name-only <base-branch>`
- **Test results** — output of `cd go && make test` and `pnpm typecheck && pnpm test`
- **Reachability artefact** — path or explicit smoke-step description (see Rule 1)
- **Delivered** — bulleted list with evidence reference (file, test name, artefact path) for each item
- **Not delivered** — bulleted list; each item surfaced as a Rule 2 deferral with why + tracking + acknowledgement
- **Divergence from plan** — any implementation that differs from the plan; empty is valid but the section must be present

**Claiming completion without a proof bundle is a silent deferral of verification and is subject to Rule 2.**

**Continuation handshake:** every session resuming prior work must open by regenerating the "Files changed" and "Test results" sections from live repo state and reconciling against the prior bundle's "Delivered" list before any new implementation begins. Divergences must be surfaced before proceeding.

**Scope ceilings:** subagent dispatches must be bounded to one vertical slice (one user-reachable journey, one API endpoint, one UI section, one migration). Dispatches scoped as "finish the feature" produce reports too broad to verify. Decompose first; each slice gets its own bundle.

### 7. Adversarial Verification (CRITICAL)

No slice may transition to `verified` state without a PASS verdict from a **fresh-context session** loaded only with the slice artefacts (`spec.md`, `proof.md`, `status.json`) and live repo state. The session that implemented the slice is never allowed to certify the slice.

**Separation is about context, not model identity.** Same model, fresh window, artefact-only inputs is sufficient. The verifier must not load the implementer's session transcript, wrap-up message, or any "ready for review" prose.

**Verifier return contract:** exactly one of
- `PASS` — every gate satisfied; slice can move to `verified`
- `FAIL: <numbered concrete violations>` — each tied to a specific spec acceptance check or proof-bundle gate
- `BLOCKED: <reason>` — verification cannot proceed (missing artefact, unrunnable test command, etc.)

**Fail closed.** Absence of evidence is FAIL, not optimistic PASS. The verifier does not propose redesigns, does not edit production code, and does not consult the implementer for clarification.

**Slice state machine:** `planned → in_progress → implemented → [fresh verifier] → verified | failed_verification`. The `implemented` checkpoint exists specifically so no agent can shortcut directly to `verified`.

**Cheap-cost loop:** implementer writes the proof bundle, runs `scripts/release-verify.sh` for deterministic first-pass rejection, then a fresh session with `role-prompts/verifier.md` returns the verdict. One extra session per slice. On Max-plan tooling this is effectively free; on API usage it is still cheaper than the rework cost of an overclaimed slice.

---

Full rule docs with provenance and detailed examples: `/docs/baton/`. Release Mode harness (slice template + role prompts + first-pass script): `/docs/baton/release-mode-template/`, `/docs/baton/role-prompts/`, `scripts/release-verify.sh`.

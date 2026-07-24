# Contributing to Baton

Baton is intentionally small. A useful contribution makes a completion claim
easier to check, closes a demonstrated false-green path, or removes unnecessary
overhead.

## Start with the right repository

Baton owns the protocol, portable operations, records, installers, board,
driver contract, and conformance corpus. Sworn owns reference-engine
orchestration. Provider SDK integration, model selection policy, credentials,
retry strategy, and deployment belong in an engine or project, not in Baton’s
common driver.

## Changing the protocol

Before changing normative text, explain:

1. which of B1–B5 is not enforceable today;
2. the concrete false green or blocked legitimate use;
3. why an existing record rule, deterministic engine invariant, project check,
   or assurance obligation cannot solve it;
4. which positive and negative conformance cases demonstrate the change; and
5. what wording or mechanism can be simplified in exchange.

Keep the distinction between responsibilities and software processes. A person
can coordinate guided use, and one driver can serve every role, but the
required authority and independence boundaries still apply.

## Records and schemas

RC2 has one authored JSON Schema:
`schemas/work-status-v1.json`. Plan metadata is closed strict JSON embedded in
`plan.md`; `design.md` and `proof.md` are exact Markdown handoffs.

Any status or plan change needs:

- a positive fixture;
- a relevant negative fixture;
- cross-record or real-Git coverage when the rule depends on history; and
- a compatibility explanation.

Do not add a writable board or a second source of lifecycle truth. The board is
a read-only projection of captured repository facts.

## Operations and adapters

Canonical operation text lives only in `operations/`. Generated Claude Code and
Codex Skills must be regenerated, never hand-edited:

```sh
node scripts/generate-adapters.mjs
node scripts/generate-adapters.mjs --check
```

Executable release budgets keep every canonical operation at or below 400
words, all five at or below 2,000 words, a complete generated Skill at or below
500 words, and the normal fixed-word ratio at or below 20% of v0.16.

## Run the checks

Use the isolated Python environment described in
[`conformance/README.md`](conformance/README.md), then run:

```sh
.venv/bin/python conformance/check.py
node --test test/records/*.test.mjs test/operations/*.test.mjs test/adapters/*.test.mjs test/install/*.test.mjs test/board/*.test.mjs test/driver/*.test.mjs test/dogfood/*.test.mjs test/release/*.test.mjs
node scripts/generate-adapters.mjs --check
node scripts/measure-overhead.mjs --check
sh -n install-claude.sh
sh -n install-codex.sh
git diff --check
```

The test suite creates temporary repositories and homes; it must never depend
on a contributor’s real Claude, Codex, provider, or credential configuration.

## Pull requests

Keep changes narrow, explain the user-visible effect in plain language, and
state whether normative behavior changes. Preserve release notes, captures, and
the v0 history as historical evidence. Include exact commands and results, and
do not turn an unrun autonomous case into a claim.

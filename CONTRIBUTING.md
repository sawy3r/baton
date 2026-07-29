# Contributing to Baton

Baton is intentionally small. A useful contribution makes a completion claim
easier to check, closes a demonstrated false-green path, or removes unnecessary
overhead.

## Start with the right repository

Baton owns the protocol, portable operations, plan and receipt records,
standalone skill payload, reference action kit, thin board, and conformance
corpus. Sworn owns orchestration and the shared driver layer. Provider
integration, model policy, credentials, retries, and deployment belong in an
engine or project.

## Changing the protocol

Before changing normative text, explain:

1. which trust principle is not enforceable today;
2. the concrete false green or blocked legitimate use;
3. why an existing record rule, engine invariant, project check, or assurance
   obligation cannot solve it;
4. which positive and negative conformance cases demonstrate the change; and
5. what wording or mechanism can be simplified in exchange.

Keep the distinction between responsibilities and software processes. A person
or compatible engine may coordinate guided use; the authority and independence
boundaries still apply.

## Records and schemas

Baton has one authored JSON Schema: `schemas/receipt-v1.json`. Plan metadata is
closed strict JSON embedded in `plan.md`; short machine-written receipts bind
decisions to Git history through the `Baton-Receipt` trailer.

Any plan or receipt contract change needs positive and negative fixtures,
real-Git coverage when history matters, and a compatibility explanation. Do
not add a writable board or second source of lifecycle truth.

## Operations and generated skills

Canonical operation text lives only in `operations/`. The five standalone
skills are generated and must never be hand-edited:

```sh
node scripts/generate-skills.mjs
node scripts/generate-skills.mjs --check
```

Every referenced resource must be bundled within its skill directory and
listed in `skills/.baton-payload.json`. Do not add client names, selectors,
discovery paths, or per-client wrappers to the live product.

Executable budgets keep each canonical operation at or below 350 words, all
five at or below 1,700 words, and normal fixed guidance below the measured
release threshold relative to v0.16.

## Run the checks

Use the isolated Python environment in
[`conformance/README.md`](conformance/README.md), then run:

```sh
.venv/bin/python conformance/check.py
node --test test/records/*.test.mjs test/operations/*.test.mjs \
  test/skills/*.test.mjs test/board/*.test.mjs test/release/*.test.mjs
node scripts/generate-skills.mjs --check
node scripts/measure-overhead.mjs --check
git diff --check
```

Tests use temporary repositories and destination directories. They must never
read or change a contributor's real agent configuration, skills, credentials,
or instruction files.

## Pull requests

Keep changes narrow, explain the user-visible effect in plain language, and
state whether normative behavior changes. Preserve historical release notes,
captures, and tags. Include exact commands and results, and do not turn an
unrun autonomous case into a claim.

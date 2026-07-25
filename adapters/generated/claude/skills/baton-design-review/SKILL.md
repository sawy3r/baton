---
name: baton-design-review
description: "Return the Captain decision over one exact Baton plan revision, slice, and design attempt."
---

<!-- baton-adapter
package-version: 1.0.0-rc.3
operation-version: baton.operation/v2
operation-sha256: sha256:cef3db42acdeca0696e939e5cc58b2628469992dbefaa3b0e2429987903b9381
-->

Treat the free-form invocation text as the operation inputs. Resolve the Baton package root from the current Git project .claude/baton install when present and valid; otherwise use the configured Claude user directory baton install. Read package-relative files from that root.

<!-- BATON_CANONICAL_BEGIN baton-design-review -->
---
operation: baton-design-review
version: baton.operation/v2
---

## Purpose

Make the distinct Captain decision over one exact plan revision, slice, and
design attempt before implementation.

## Inputs

- The applicable approved plan revision and stable slice contract.
- The exact design TL;DR and immutable object it binds.
- Relevant repository facts and the Captain invocation identity.

## Authority

Review only the presented design attempt. The Captain must differ from its
producer and cannot change approved scope, approve a plan, implement, or issue
a delivery verdict.

## Actions

1. Confirm the plan, slice, design attempt, and immutable binding agree.
2. Check acceptance coverage, scope, dependencies, consumed inputs,
   consequential decisions, risks, and proposed evidence.
3. Return exactly one decision:
   - `PROCEED` when implementation may begin;
   - `REVISE` when the same slice needs another design attempt; or
   - `ESCALATE` when an external decision or revised approved plan is needed.

## Required output

Return only the decision, exact bindings, Captain invocation, and concise
reason. Do not write the Captain receipt.

## Stop conditions

Stop without a decision when approval, scope, authority, design identity, or
evidence needed for review is ambiguous. An execution or persistence failure
is operational and creates no Captain decision.

## Next handoff

`PROCEED` returns to `baton-implement`; `REVISE` starts another design attempt
on the same slice; `ESCALATE` hands to `baton-plan`.
<!-- BATON_CANONICAL_END baton-design-review -->

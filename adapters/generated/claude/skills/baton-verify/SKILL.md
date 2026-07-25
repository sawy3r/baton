---
name: baton-verify
description: "Independently verify Baton work or assembly evidence. Use only from a fresh read-only verification context."
---

<!-- baton-adapter
package-version: 1.0.0-rc.3
operation-version: baton.operation/v1
operation-sha256: sha256:a6f0e9b9bf95cb59e5030b7f95f72d8d3545b52ef771c7d20e7be44a20e45bed
-->

Treat the free-form invocation text as the operation inputs. Resolve the Baton package root from the current Git project .claude/baton install when present and valid; otherwise use the configured Claude user directory baton install. Read package-relative files from that root.

<!-- BATON_CANONICAL_BEGIN baton-verify -->
---
operation: baton-verify
version: baton.operation/v1
---

## Purpose

Independently verify either one work candidate or the complete assembled
release against exact approved evidence.

## Inputs

- Scope: `work` with a work identity, or `assembly` without one.
- The admitted plan, authoritative status, exact proof bytes, and candidate.
- Protected clean, read-only dispatch evidence for this invocation.
- Required checks and raw evidence references.

## Authority

Begin in fresh context with read-only candidate access. For work, the Verifier
must differ from the design producer, Implementer, and Captain. For assembly,
it must differ from the Merge proof producer. Verification binds the current
plan, proof, candidate, product tree, and dispatch evidence.

## Actions

1. Re-select authoritative state from captured refs and validate every current
   binding before inspecting the candidate.
2. Read only the approved plan, status, proof, candidate, and necessary live
   repository evidence.
3. Re-run required checks and test each acceptance claim at the boundary it
   describes. For assembly, verify every exact composed component and the
   complete product together.
4. Choose exactly one Baton verdict: `PASS`, `FAIL`, or `BLOCKED`.
5. Construct the exact next status and record that result through
   `recordTransition`.
6. If execution, transport, or persistence fails before a verdict, return
   `NO_VERDICT` operationally and leave durable status byte-for-byte unchanged.

## Required output

Return the scope, verdict, numbered evidence or violations, bound identities,
resulting projection, and action receipt. On operational failure, return the
failure and unchanged-state evidence, not a verdict.

## Stop conditions

Stop on contaminated or writable context, stale bindings, changed candidate,
missing proof, untrusted dispatch evidence, unavailable required evidence, or
any action error. Absence of evidence cannot become `PASS`.

## Next handoff

Work `PASS` hands to `baton-merge track`; work `FAIL` returns to
`baton-implement`; `BLOCKED` or assembly `FAIL` hands to `baton-plan`. Assembly
`PASS` hands to `baton-merge release`.
<!-- BATON_CANONICAL_END baton-verify -->

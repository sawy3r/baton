---
name: baton-verify
description: "Independently check finished work from a fresh, read-only context."
---

<!-- baton-skill
release: v1.0.0-rc.12
generator-version: baton.skill-generator/v1
operation-version: baton.operation/v2
operation-sha256: sha256:2894f5b6f814816815febc7859ce47caebd2b69387937743ab2f633ed8361f74
-->

Use the invoking request as input. Resolve relative files from this directory. This standalone skill needs no shared Baton folder.

<!-- BATON_CANONICAL_BEGIN baton-verify -->
---
operation: baton-verify
version: baton.operation/v2
---

## Purpose

Independently check one finished slice or the complete release against what was
approved.

## Inputs

- One stable slice or the complete release.
- The approved plan and exact candidate.
- The Captain decision when checking a slice.
- Required checks, observable evidence, and proof that this is a fresh,
  read-only verification.

## Authority

Begin in fresh context with read-only access. Differ from the Implementer and
Captain. Bind the decision to the exact plan revision, candidate, product
identity, evidence, and invocation.

Judge the actual candidate against the approved behavioral commitment.
Ancillary support paths and additional checks are evidence, not scope failures
by themselves. They cannot excuse a material behavior, consumed-product,
contract, or authority change.

Product code, build, test, package, deploy, hooks, and runtime MUST NOT read or
depend on reserved `.baton/releases`; verify the candidate preserves it from
its exact implementation base.

## Actions

1. Recheck every fact needed to trust the result from saved evidence that
   cannot quietly change.
2. Inspect the real candidate and complete diff, rerun required checks, use
   helpful extra evidence, and test each acceptance claim where it matters.
3. For assembly, check every composed component and the complete product.
4. Return exactly one verdict:
   - `PASS` when the exact candidate satisfies the contract;
   - `FAIL` when the contract is adequate but candidate or evidence needs
     correction;
   - `BLOCKED` when safe progress requires changed behavior, consumed product,
     authority, contract, or an external decision.

## Required output

Lead with the verdict and plain reason, then say what happens next. Give
numbered evidence or violations. Put scope, exact bindings, and Verifier
invocation under technical details. Do not write the Verifier receipt. On
operational failure, explain the condition and return no verdict.

## Stop conditions

Never return `PASS` with inherited implementation context, writable candidate
access, missing approval, a stale Captain decision, a changed candidate,
unclear evidence, or unavailable required checks.

## Next handoff

Slice `PASS` hands to `baton-merge`; `FAIL` returns the same stable slice
directly to `baton-implement` for another implementation attempt; `BLOCKED`
hands to `baton-plan`. Assembly `PASS` permits final Merge.
<!-- BATON_CANONICAL_END baton-verify -->

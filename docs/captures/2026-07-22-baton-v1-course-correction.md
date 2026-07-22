# Baton v1 course correction

Date: 2026-07-22
Status: ratified
Ratified: 2026-07-22

## Decision

Baton should be a small, platform- and model-agnostic delivery protocol with a
usable reference kit:

1. five plain-language trust principles;
2. five stable workflow responsibilities;
3. one small durable handoff at each responsibility boundary;
4. portable skills and slash-command adapters; and
5. one read-only board oracle shared by terminal and local WebUI views.

Sworn automates this protocol. It does not define it, and it is not required to
use Baton manually.

## The course correction

Baton 1.0 RC1 compressed the wrong thing.

It correctly found the trust kernel: bounded authority, durable truth, real
evidence, independent verification, and safe composition. It also correctly
removed the twelve-rule cascade, universal LLM reviews, and incident-specific
procedures that every agent had to relearn.

But the five-role workflow was not the overhead. It was Baton's useful operating
model. Removing Planner, Captain, Merge, skills, installers, and the thin board
turned Baton from a protocol people could immediately run into an engine-author
specification.

The target is not a return to Baton 0.x. It is the original working loop with the
RC1 trust kernel and without the accumulated rule, schema, prompt, and artefact
burden.

## Archaeological baseline

`fired/baton-install-backup` at its current head is not the baseline. It is the
end of an accretion history.

The strict pre-Sworn cutoff is Fired commit `386d4589` on 14 June 2026, when the
SwornAgent name and the Baton/Sworn product split were first ratified. The final
backup sync before that decision, `b5b996b8`, was already 70 canonical files and
18,984 lines, plus a copied OpenCode surface. Its loop was 2,614 lines and its
single-file WebUI was 1,613 lines. Restoring it wholesale would restore much of
the complexity this correction is intended to remove.

There is no single pristine fork point. The useful lineage is:

- `e984d658` (27 May): earliest complete recoverable five-responsibility loop,
  role prompts, slash commands, Git oracle, terminal board, and read-only
  single-file WebUI;
- `5d836ed6` (29 May): removes tmux and makes each loop responsibility a fresh
  inline dispatch;
- `2c8ce241` (29 May): makes the board a stateless projection, with authored
  plans separated from the sole machine-authoritative work state;
- `0c7b1460` (30 May): adds calibrated autonomous Captain triage; and
- `b7654a30` (10 June): introduces one role-independent runtime-driver contract
  used by every responsibility.

Later pre-Sworn commits remain valuable failure and conformance evidence, but
not source to restore. In particular, the WebUI became an active mission-control
surface, provider implementations grew toward 900 lines each, model rotation
entered the loop, and platform copies duplicated the workflow. The fuller
multi-provider behaviour is visible at `124265bd` (14 June, about an hour before
Sworn was ratified); its compatibility cases are requirements evidence, not a
fork point.

Every useful pre-Sworn checkpoint still had only seven Baton rules and no JSON
Schema catalogue. The later twelve-rule and multi-schema system was therefore
not part of the working essence. The inverse warning also matters: substantial
overhead had already accumulated in prompts, recovery code, UI actions, and
copied platform surfaces before the extra rules arrived. Cutting the rule count
is necessary, but it is not sufficient.

The recovery formula is therefore:

> Rebuild from the May 29 stateless loop and board semantics, add only the June
> 10 common driver boundary, and treat the surrounding code as archaeology.

## The core in ordinary language

1. Stay inside the work that was agreed.
2. Keep durable facts instead of relying on conversation memory.
3. Prove the real result, not a convenient approximation.
4. Have a fresh reviewer try to disprove completion.
5. Merge only the exact work that passed.

The B1-B5 terminology may remain in the technical specification, but this is
the public explanation.

## Workflow responsibilities

Roles are responsibility and authority boundaries. They are not personas,
providers, models, SDKs, or driver implementations. A human, conversational
agent, CLI agent, subagent, or autonomous engine may perform a role so long as
the same contract is honoured.

### Planner

Turns intent into a proposed, bounded delivery plan with outcomes, scope,
acceptance criteria, dependencies, required checks, and consequential
constraints. An external authorizer activates the plan. The Planner does not
implement, approve authority, or certify delivery.

### Implementer

First proposes the design and stops. After Captain review permits it to proceed,
it resumes to build the candidate and present acceptance-linked evidence. It
does not review its own design or certify its own implementation.

### Captain

Reviews the proposed design during the implementation stage. It returns exactly
one of `PROCEED`, `REVISE`, or `ESCALATE`, then hands control back to the
Implementer. It does not become a second planner, implementer, or verifier.

### Verifier

Receives the plan, Captain-reviewed design, exact candidate, and evidence in a
clean context with no inherited implementation conversation. It is read-only
and adversarial. It returns `PASS`, `FAIL`, or `BLOCKED`. A runner or environment
failure produces no verdict and is retried or surfaced separately.

### Merge

Rechecks that the candidate is the exact candidate covered by `PASS` and lands
it only when authority is current and the expected target has not moved. It
records the candidate, verdict, expected target, observed result, and authority
used. Merge is normally mechanical, but it remains a named responsibility and
handoff.

The human or other authorizer remains outside the five-role execution loop and
owns scope, product judgement, consequential decisions, and any standing
authority granted to autonomous execution.

An escalation that changes scope, contract, checks, or authority creates a new
authorized plan revision before the Implementer resumes.

## Canonical flow

```text
Planner -> proposed plan -> authorizer approval
        -> Implementer (design)
        -> Captain
             PROCEED  -> Implementer (build + evidence)
             REVISE   -> Implementer (revised design)
             ESCALATE -> human decision
        -> fresh Verifier
             PASS     -> Merge
             FAIL     -> Implementer
             BLOCKED  -> Planner or human decision
             no verdict -> fresh retry or operational attention
        -> Merge exact passed candidate
```

Captain is a distinct role invocation. Only Verifier freshness carries the
stronger unconditional requirement of a clean context with no inherited
implementation transcript. Baton should not otherwise require cold model starts
as a substitute for responsibility separation.

## Small projection

The board should derive four orthogonal facts instead of inventing a large list
of subtly different lifecycle states:

```text
stage:   plan | design | implement | verify | merge
status:  ready | active | blocked | complete
role:    planner | implementer | captain | verifier | merge
outcome: none | proceed | revise | pass | fail | blocked | no_verdict | merged
```

`BLOCKED` is a verdict requiring a changed decision, scope, or contract; it is
not a synonym for a broken runner. Runtime failures do not manufacture protocol
verdicts. Merge state is derived from Git facts, not asserted by an agent.

The happy-path flow remains Plan -> Design -> Implement -> Verify -> Merge.
Detailed engine events may exist internally, but the protocol and board should
not expose a second, larger state vocabulary unless a real user decision depends
on it.

## Artefact and schema budget

An artefact is mandatory only when the next role or the board consumes it. Baton
should have four logical record shapes at most. They may be separate files for a
multi-work release or co-located for a small change:

1. `plan` — intent, bounded work contracts, acceptance checks, dependencies,
   required checks, and the protected approval reference;
2. `design` — the Implementer's proposed approach and revision, consumed by the
   Captain before implementation;
3. `proof` — the exact candidate, changed paths, check results, and
   acceptance-linked evidence; and
4. `status` — the sole machine-authoritative current projection, including the
   active plan revision, stage, owner, blocker, Captain gate, Verifier gate,
   candidate binding, and Merge result.

The portable reference kit should normally render these as concise Markdown for
`plan`, `design`, and `proof`, plus one small versioned `status.json`. A
multi-work plan may list work items and dependencies in its frontmatter; that is
an authored registry, not another state store. Detailed Captain or Verifier
findings may be referenced when they do not fit in the compact gate payload, but
they do not require parallel Markdown and JSON copies.

`status.json` is validated before every transition. Its gate payloads bind the
Captain decision to a design revision, the Verifier decision to an exact
candidate and proof revision, and Merge to the exact passed candidate and
expected target. The board is derived from this record and Git. It never owns a
second lifecycle state.

The manual kit relies on Git history for record history. It does not require a
generic append-only event stream or hand-written activity log. Sworn may retain
richer immutable engine events for crash recovery, audit, evaluation, and
hosted observability without making those events part of the protocol handoff.

The Implementer presents the candidate and evidence. Small vendor-neutral Baton
tooling independently derives Git identity, changed paths, and check results; an
Implementer's unsupported claim is never proof. An autonomous engine may
produce the same record through stronger containment and attestation.

The standard path must not require separate intake, journal, activity, ack,
RTM, journey, QA-runbook, maintainability-cycle, assurance-policy, dedicated
control-receipt, rendered-board, or narrative-capture artefacts. Projects may
add their own documents, and engines may retain richer internal events and
receipts, but these do not become universal Baton handoffs.

Schemas should validate the few facts that make a gate trustworthy. One work
status schema with small embedded gate payloads is the default budget. It must
not encode a second orchestration engine or every historical incident.

## Rule admission

Baton has five principles, not an expanding rulebook.

A new universal requirement is admitted only when removing it breaks trust on
almost every delivery. An incident should normally result in one of:

- a deterministic implementation check;
- a conformance fixture;
- a clearer field or invariant in an existing record;
- an optional project policy; or
- no permanent mechanism when fresh verification and cheap retry already cover
  it.

It must not result in another document injected into every role by default.

## Portable skills and commands

Baton should ship five canonical, tool-neutral operations:

- `baton-plan`;
- `baton-implement`;
- `baton-design-review`;
- `baton-verify`; and
- `baton-merge`.

Each operation defines only its purpose, inputs, authority, required output,
stop conditions, and next handoff. The canonical operation contains no
Claude-, Codex-, OpenCode-, Gemini-, provider-, model-, memory-, or home-directory
assumption.

Claude Code commands, Agent Skills, OpenCode commands, and other integrations
are thin launch adapters generated from or pointing to that same canonical
operation. They contain no copied workflow logic. Packaging parity tests should
prove that every launcher resolves the same operation version.

The fixed instruction budget should be enforced in CI. As an initial ceiling,
each canonical role operation should stay below 400 words and the complete
five-operation kit below 2,000 words. Rationale and incident history live in
separate reading material and are not required context for every run.

## Thin board

Restore and generalise the proven board behaviour from Fired commits
`e984d658` / `2c8ce241` behind one stable, read-only oracle contract. Preserve
the architecture, not the historical files:

- a small branch-aware `.mjs` oracle resolves authoritative committed
  `status.json` records, authored plan membership, and Git facts;
- JSON, terminal, and WebUI views consume that same projection;
- the single-file local WebUI remains presentation-only, auto-refreshing, and
  dependency-free beyond built-in Node.js;
- the views show work, current stage, responsible role, status, blockers, and
  next action; and
- no board action or edit becomes delivery truth.

The old oracle's sound ownership-over-recency rule, Git-ref reads, dependency
derivation, and shared presentation source should be retained in the Git
reference adapter. Its working-tree fallbacks, malformed-record healing,
project-specific path recovery, unescaped historical UI rendering, and expanded
0.x state vocabulary should not be copied. The later mission-control actions,
worker controls, SSE stream, and cost dashboard belong to Sworn, not Baton's
thin board.

The reference kit needs one documented default record location, with a local
configuration override. Directory layout and Node.js are not protocol
conformance requirements; they are choices of the portable reference kit.

The board requires no Sworn installation, provider account, API key, hosted
service, or selected model.

## Explicit non-goals

Baton does not provide or broker inference. Managed inference, model resale,
proxy credits, and provider aggregation are outside the product direction.

Baton also does not define:

- a role-specific driver;
- a bundled or default model;
- a project-management methodology;
- a universal LLM-review cascade;
- deployment or production-operation policy; or
- tool-specific copies of the workflow.

Model and runner selection are execution configuration. Implementations may
select a runner and optional model for each role through one common driver
layer, but that configuration does not change Baton.

## Conformance focus

Portable workflow conformance should test behavior at the handoffs:

- plan approval and bounded scope;
- matching design revision and Captain decision before implementation;
- evidence bound to the exact candidate and acceptance criteria;
- a clean, read-only Verifier run that cannot certify its own work;
- correct routing of pass, fail, blocked, and no-verdict outcomes; and
- Merge refusing a changed or unverified candidate.

Autonomous-engine conformance should additionally retain RC1's machine-level
safety cases for authority isolation, subprocess and credential containment,
write-once identity, persistence failure, durable effect recovery, resource
bounds, and compare-and-swap Merge. These are executable guarantees, not prose
that every role must read, and therefore add no model-token tax.

Conformance should not depend on prompt bytes, provider behavior, command names,
directory layout, or Sworn internals.

## Release consequence

`v1.0.0-rc.1` remains an immutable and useful experiment, but it is not the
final Baton product contract. With this responsibility, artefact, and recovery
baseline ratified, final `v1.0.0` requires:

1. revising Core, Protocol, Assurance, Conformance, schemas, and public language;
2. restoring the portable skill/command kit;
3. restoring the shared oracle, terminal board, and single-file WebUI;
4. dogfooding the complete manual workflow without Sworn;
5. publishing a new release candidate; and only then
6. requiring Sworn to pin and conform to that Baton release candidate before its
   engine proceeds; Sworn's evaluation system and hosted product scope remain
   explicit product decisions in Sworn.

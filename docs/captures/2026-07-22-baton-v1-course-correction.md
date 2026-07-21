# Baton v1 course correction

Date: 2026-07-22
Status: proposed for ratification

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
should have four small authored record shapes at most:

1. `plan` — Planner's proposed delivery and work contracts, required checks,
   heightened review policy when applicable, and protected approval reference;
2. `handoff` — one compact append-only per-work stream carrying design revisions,
   Captain decisions, operational control results, Verifier dispatch, and Merge
   result;
3. `submission` — the exact candidate, changed paths, check results, and
   acceptance-linked evidence; and
4. `verdict` — Verifier's result bound to that submission.

Every accepted handoff is immutable; a role appends a new event rather than
rewriting history. The board is derived from these facts and Git, not another
authored state file. A concise design body can live in or be referenced by its
handoff; it does not need a second design schema or duplicated review report.
The Merge handoff binds the expected target and observed Git result, while Git
independently proves the recorded repository fact.

The Implementer presents the candidate and evidence. Small vendor-neutral Baton
tooling independently derives Git identity, changed paths, and check results; an
Implementer's unsupported claim is never proof. An autonomous engine may
produce the same record through stronger containment and attestation.

The standard path must not require intake, journal, RTM, journey, QA-runbook,
maintainability-cycle, assurance-policy, dedicated control-receipt,
rendered-board, or narrative-capture artefacts. Projects may add their own
documents, and engines may retain richer internal events and receipts, but these
do not become universal Baton handoffs.

Schemas should validate the few facts that make a gate trustworthy. They should
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

Restore and generalise the proven Baton board architecture from
`fired/baton-install-backup` behind one stable, read-only oracle contract:

- the original branch-aware `.mjs` oracle is the reference implementation and
  resolves authoritative committed records and Git facts;
- JSON, terminal, and WebUI views consume that same projection;
- the single-file local WebUI remains presentation-only, auto-refreshing, and
  dependency-free beyond built-in Node.js;
- the views show work, current stage, responsible role, status, blockers, and
  next action; and
- no board action or edit becomes delivery truth.

The old oracle's sound ownership-over-recency rule, Git-ref reads, dependency
derivation, and shared presentation source should be retained in the Git
reference adapter. Coupling to old frontmatter parsing, historical recovery
hacks, and the expanded 0.x state set should be removed.

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
final Baton product contract. Before final `v1.0.0`:

1. ratify this responsibility and artefact model;
2. revise Core, Protocol, Assurance, Conformance, schemas, and public language;
3. restore the portable skill/command kit;
4. restore the shared oracle, terminal board, and single-file WebUI;
5. dogfood the complete manual workflow without Sworn;
6. publish a new release candidate; and only then
7. require Sworn to pin and conform to that Baton release candidate before its
   engine proceeds; Sworn's evaluation system and hosted product scope remain
   explicit product decisions in Sworn.

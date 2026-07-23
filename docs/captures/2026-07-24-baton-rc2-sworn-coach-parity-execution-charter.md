# Baton RC2 and Sworn Coach-parity execution charter

Date: 2026-07-24
Status: active
Authority: Brad's 2026-07-24 instruction to continue autonomously until the
complete goal is achieved

## Goal

Deliver two dependent outcomes:

1. finish, dogfood, publish, and install the course-corrected Baton v1 RC2; and
2. build Sworn against that immutable contract until it reaches functional
   parity with the original Coach loop, while retaining the leaner Baton trust
   model and the new Sworn release-cockpit direction.

The goal is not satisfied by plans, mocks, schemas alone, isolated components,
or a partially autonomous demo. It ends when the real tools complete
representative multi-track delivery through planning, design review,
implementation, independent verification, assembly verification, and exact
integration, with truthful recovery and user-visible projections.

## Governing decisions

- [Baton v1 course correction](./2026-07-22-baton-v1-course-correction.md)
- [Baton v1 RC2 rebuild plan](./2026-07-22-baton-v1-rc2-rebuild-plan.md)
- [Sworn agentic orchestration interface decision](./2026-07-24-sworn-agentic-orchestration-interface-decision.md)
- [Sworn v1 architecture decision](./2026-07-19-sworn-v1-architecture-decision.md)

When an older capture conflicts with these decisions, the newer ratified
decision governs. Live repository, Git, installed-binary, and runtime facts
govern over narrative status.

## Durable execution discipline

Conversation and subagent context are coordination aids, not project memory.
All load-bearing scope, requirements, decisions, evidence, deviations, and
handoffs are committed to the relevant repository.

Every implementation stage has:

1. a **scope and requirements capture before edits**;
2. implementation and tests on isolated worktrees;
3. an **evidence and outcome capture before promotion**; and
4. an updated stage status stating what is complete, what changed, and what
   remains.

A stage scope capture records:

- objective and user-visible outcome;
- included and excluded scope;
- inherited requirements and explicit non-goals;
- authority and safety boundaries;
- interfaces and owned touchpoints;
- dependencies and parallel tracks;
- measurable acceptance criteria;
- required unit, integration, conformance, recovery, and dogfood evidence; and
- the exact handoff required by the next stage.

An outcome capture records:

- exact branch and commit identities;
- implemented behavior;
- tests and real commands run, including failures;
- screenshots or fixtures where presentation is material;
- conformance and parity evidence;
- deviations from scope and their authority;
- unresolved risks or follow-up work; and
- the promotion or publication decision.

Important facts must not exist only in a Captain log, chat response, task plan,
or subagent message.

## Worktree and parallelism policy

Each repository uses one release/integration worktree plus track worktrees for
parallel-safe slices:

```text
target branch
  -> release/integration worktree
       -> track worktree A: serial work owned by one active agent
       -> track worktree B: serial work owned by one active agent
       -> track worktree C: serial work owned by one active agent
```

Rules:

- a track begins from the exact current release/integration head;
- only one agent writes in a track worktree at a time;
- independent tracks may run concurrently;
- shared contracts land before consumers branch from them;
- shared-touchpoint changes are serialised or assigned to one owner;
- agents do not edit another track's worktree;
- composition happens in the release/integration worktree;
- conflicts are resolved against the approved scope, never by discarding a
  track silently; and
- tests run in the owning track before composition and again after composition.

Subagents receive bounded, independently verifiable tasks. They return exact
paths, commits, test output, and risks. The primary agent owns cross-track
decisions, reads the governing captures directly, and verifies composed work.

The purpose of parallelism is lower elapsed time, not more generated artefacts
or speculative implementation.

## Stage B1 — Baton contract and records

### Outcome

Baton expresses the restored five-responsibility workflow and Coach topology in
plain language and one small durable record model.

### Requirements

- five public trust principles;
- Planner, Implementer, Captain, Verifier, and Merge authority boundaries;
- Implementer design stop and Captain `PROCEED | REVISE | ESCALATE` handoff;
- clean-context, read-only, adversarial Verifier;
- `release-wt/<release>` and `track/<release>/<track-id>` ownership;
- ordered slices serial within a track and independent tracks parallel;
- release composition followed by separate assembly verification;
- one validated `work-status-v1` projection with exact bindings for plan,
  design, candidate, evidence, verifier, assembly, target, and Merge;
- deterministic transition and branch-head compare-and-set validation;
- malformed, stale, foreign-track, and cross-record inputs fail closed; and
- guided/manual and autonomous-engine conformance remain distinguishable.

### Exit evidence

Schema, semantic validator, positive and negative fixtures, transition tests,
Git-ref ownership tests, and a concise public protocol that agree on the same
state model.

## Stage B2 — Operations, adapters, and installation

### Outcome

A person can install Baton and immediately run the same five operations in
Claude Code or Codex without platform-specific workflow forks.

### Requirements

- canonical `baton-plan`, `baton-implement`, `baton-design-review`,
  `baton-verify`, and `baton-merge` operations;
- concise plan, design, and proof templates;
- each operation declares purpose, inputs, authority, actions, output, stop
  conditions, and next handoff;
- operations remain vendor-, model-, memory-, and home-directory neutral;
- generated Claude commands and Codex Agent Skills bind to identical canonical
  operation bytes and versions;
- generated adapters contain no independently maintained workflow logic;
- installers support dry-run, user and project scope, non-interactive approval,
  safe repeat execution, and exact ownership manifests;
- uninstall or replacement removes only Baton-owned paths and instruction
  blocks;
- the Claude migration retires the legacy eight commands, v0.16 package, and
  twelve-rule global block without touching unrelated configuration;
- the Codex installation creates the five skills and their shared Baton support
  package; and
- packaging parity tests prove every installed launcher resolves the same
  operation version and digest.

### Exit evidence

Isolated-home install, reinstall, upgrade-from-v0.16, dry-run, project-scope,
user-scope, and manifest-preservation tests for Claude and Codex.

## Stage B3 — Reference board and driver boundary

### Outcome

Baton is immediately useful without Sworn and exposes one truthful,
platform-agnostic view of delivery.

### Requirements

- one branch-aware oracle chooses records by authored ownership and composition
  facts rather than newest timestamp;
- JSON, terminal, and dependency-light single-file WebUI consume the same
  projection;
- the WebUI is GET-only, escaped, loopback-safe, auto-refreshing, and contains
  no delivery mutation path;
- views show release, tracks, slices, stage, status, responsible role, outcome,
  blocker, source ref, and next operation;
- no working-tree fallback or malformed-record healing;
- one role-independent one-dispatch driver contract;
- role configuration, not the driver abstraction, selects a runner and optional
  model;
- runner failure and `no verdict` remain operational outcomes rather than Baton
  verdicts; and
- fake-driver and board fixtures exercise the full handoff model.

### Exit evidence

Oracle ownership and dependency tests, deterministic renderer fixtures,
security tests for the WebUI, driver contract cases, and a real manual
multi-track Baton delivery ending in assembly verification and exact Merge.

## Stage B4 — Baton publication and local cutover

### Outcome

RC2 is immutable, documented, measurable, installed locally, and safe for Sworn
to pin.

### Requirements

- complete conformance and dogfood evidence;
- measured operation-word, artefact, invocation, and failure-path budgets
  compared with Baton v0.16;
- public documentation and release notes match delivered behavior;
- Baton website content reflects the plain-language protocol and reference kit;
- Claude and Codex installers pass dry-run against the real user environment;
- the legacy Claude installation is recoverably archived or manifest-retired;
- both global installations pass launcher, digest, schema, and smoke tests;
- RC2 branch, PR, tag, and release notes identify exact tested commits; and
- Sworn pins an immutable RC2 object only after publication.

## Stage S1 — Sworn vertical loop

### Outcome

Sworn completes and recovers one real single-track release through every Baton
responsibility and final integration.

### Requirements

- one transactional command, event, effect, and receipt authority;
- immutable plan and operation inputs;
- exact repository identity and isolated worktrees;
- bounded role execution through installed native agent CLIs;
- Implementer design stop, Captain decision, resumed implementation, clean
  Verifier, assembly verification, and exact Merge;
- engine-owned Git observation and mutation;
- no agent-written Sworn state;
- idempotent claim, effect, completion, and recovery;
- crash tests at every external-effect boundary;
- retry exhaustion and operational `no verdict` without manufactured protocol
  outcomes; and
- a truthful read-only run projection.

## Stage S2 — Coach topology and driver parity

### Outcome

Sworn provides the original Coach loop's autonomous release behavior without
its Bash scaling limits or accumulated Baton overhead.

### Requirements

- release worktree plus authored track worktrees;
- dependency-ready tracks execute concurrently;
- at most one current slice and one writer per track;
- claim and prepare transactionally, execute outside the global scheduling
  mutex under a store-issued lease, and complete idempotently;
- bounded machine-wide concurrency;
- owner-aware oracle state across release and track refs;
- safe track-head composition and post-composition assembly verification;
- pause, resume, cancel, retry, escalation, and interactive takeover;
- common role-independent drivers;
- per-role runner and model selection with no bundled defaults or silent
  fallback;
- full concrete driver coverage for:
  - Codex CLI;
  - Claude Code CLI;
  - OpenAI-compatible inference endpoints;
  - DeepSeek;
  - Gemini; and
  - Amazon Bedrock;
- real compatibility with the materially supported Coach behaviors identified
  by the committed archaeology parity matrix;
- Codex CLI execution uses the verified non-interactive, unrestricted-workspace,
  and ephemeral/no-memory flags required by the role, especially Verifier;
- Claude Code and Codex retain their own tool-use and provider evolution;
- OpenAI-compatible, DeepSeek, Gemini, and Bedrock integrations expose their
  capabilities honestly rather than causing Sworn to grow an implicit,
  provider-specific coding runtime;
- every driver reports a common identity, configured model, transport outcome,
  usage when available, structured-output support, context-freshness behavior,
  and workspace-mutation capability;
- role dispatch rejects a driver whose declared capabilities cannot perform the
  selected operation;
- DeepSeek may reuse an OpenAI-compatible transport internally, but has named
  configuration and compatibility fixtures so support is not merely assumed;
- credentials, profiles, regions, base URLs, and model identifiers are explicit
  local configuration and are not copied into Baton records or hosted events;
- live conformance may load provider secrets from
  `~/.config/coach/env` and `~/.config/sworn/credentials.json`; secret values
  are passed only to the exact driver subprocess or client that requires them
  and are never printed, committed, captured, placed in prompts, or persisted
  in Sworn events;
- credential files must be owner-readable only before use, and test reports
  record provider presence and pass/fail without key material;
- Bedrock uses the standard local AWS credential and region resolution chain
  rather than copying AWS credentials into Sworn's provider JSON;
- one shared conformance corpus runs through every driver adapter, with
  credential-gated live smoke tests in addition to deterministic fake-server
  tests; and
- no managed inference, provider marketplace, or in-engine coding runtime.

## Stage S3 — Operator surfaces and release cockpit

### Outcome

An operator can understand, monitor, and safely supervise autonomous delivery
from terminal or browser without creating another source of truth.

### Requirements

- stable run snapshot, typed resumable event stream, and closed command/receipt
  contract;
- truthful terminal board;
- responsive embedded local WebUI with the ratified branching Baton-line
  interaction model;
- visibly separate Baton delivery and Sworn runtime planes;
- role-primary rows with driver/model, tools, time, tokens, cost, retries, and
  logs as secondary runtime detail;
- factual progress through Plan, tracks, assembly verification, and Merge;
- read-only evidence, diff, design, verdict, blocker, and audit drill-down;
- authenticated local operational controls that cannot manufacture Baton truth;
- exact next-operation copy/open and safe interactive takeover;
- reconnection and event-gap recovery from durable state;
- machine-global multi-run discovery;
- generic webhook/outbox and secure self-hosting foundations; and
- hosted projection remains metadata-minimised and read-only until its separate
  security gate.

The GUI may not claim parallelism, recovery, verification, or integration that
the real engine has not proved.

## Final parity gate

The work finishes only when a committed parity matrix demonstrates that every
material original Coach capability is:

- reproduced by Baton or Sworn;
- deliberately superseded by a safer equivalent; or
- rejected as accumulated complexity by an explicit user-ratified non-goal.

Required end-to-end proof includes:

1. install Baton into clean isolated Claude and Codex homes;
2. run the guided protocol manually through both surfaces;
3. run Sworn unattended on a representative multi-track repository;
4. run the common driver corpus against Codex CLI, Claude Code CLI,
   OpenAI-compatible, DeepSeek, Gemini, and Bedrock adapters, including
   credential-gated live smoke tests where the configured services are
   available;
5. complete representative delivery with at least two different driver
   families and different configured models across roles;
6. inject process death, timeout, stale target, failed verification, blocked
   specification, and composition conflict scenarios;
7. reconnect terminal and WebUI projections during the run;
8. prove final assembly verification covers the composed release candidate;
9. integrate only the exact passed candidate;
10. compare elapsed time, model invocations, protocol tokens, artefacts, retry
   cost, and success quality with the Coach/Baton v0 baseline; and
11. publish exact commits, fixtures, logs, and release notes.

## External authority and stops

Autonomous work may create worktrees, branches, commits, tests, local
installations, pushes, and review-ready pull requests within these repositories.

The primary agent requests Brad's action only when an external protected action
cannot be completed locally, including:

- approving or merging a protected pull request;
- changing repository branch or tag protection;
- publishing through credentials or accounts unavailable to the agent;
- ratifying a material scope, authority, security, or commercial change; or
- accepting a parity exception.

An approval wait does not stop independent safe work on later preparation,
fixtures, documentation, or another repository when the dependency can be
isolated honestly.

## Explicit non-goals

- restoring Baton 0.x wholesale;
- restoring the twelve-rule cascade or schema catalogue;
- making subagent transcripts into project state;
- using parallel agents on shared mutable touchpoints;
- generating artefacts that have no downstream consumer;
- role-specific provider drivers;
- default models or silent provider fallbacks;
- managed inference or provider aggregation;
- a second Sworn scheduler or mutable delivery state;
- a generic workflow canvas; and
- declaring parity from mocked adapters or presentation-only demos.

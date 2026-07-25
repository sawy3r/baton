# Sworn agentic orchestration interface decision

Date: 2026-07-24
Status: ratified
Ratified: 2026-07-24
Authority: [Baton v1 course correction](./2026-07-22-baton-v1-course-correction.md)
and [Baton v1 RC2 rebuild plan](./2026-07-22-baton-v1-rc2-rebuild-plan.md)

## Decision

Sworn's primary agentic-orchestration interface should provide the clarity and
control of Claude Code Dynamic Workflows, adapted to Baton's deterministic
software-delivery protocol.

The interface is a release cockpit, not a general workflow builder:

> Approve one delivery plan, watch it fan out across independent tracks, inspect
> every role's work and evidence, intervene safely, and then converge through
> final verification and exact integration.

Sworn should borrow the interaction hierarchy of a workflow goal, aggregate
progress, phases, parallel workers, drill-down, operational telemetry, and
resumable execution. It must not copy Claude branding or make a generated
workflow script, chat transcript, browser state, or GUI click into delivery
authority.

Baton defines the approved topology and durable delivery truth. Sworn executes
and supervises it. The GUI projects both without becoming a second scheduler,
state machine, or source of truth.

## 2026-07-26 amendment — one relay, one team

The shared product model is:

> Baton is how the work is handed off. Sworn is the team that carries it.

Baton's browser board defaults to a direct, read-only visualisation of the
approved delivery graph. Its visual metaphor is a relay: the plan is the start,
tracks are lanes, slices are legs and exchange points, dependency and
consumption edges are cross-lane feeds, assembly is the final exchange, and
Merge is the finish. It is not a conductor's baton, editable DAG canvas,
Kanban board, or collection of generic dashboard cards.

Sworn reuses that exact topology and adds the operational team: assigned
agents, drivers and role-selected models, active invocations, timing, retries,
budgets, observations, and typed controls. A Sworn agent is “sworn in” to one
bounded invocation containing the exact plan, responsibility, slice,
candidate, capabilities, driver/model selection, and budget before it carries
that relay leg.

This language creates no new Baton state, receipt, role, gate, or ceremony.
“Sworn in” is the human product description of the runtime claim and dispatch
envelope the engine already requires. The resulting interface should feel like
an intentional editorial race and timing instrument, not medieval world
building or a generic generated application.

## Product definition

The interface should make an autonomous release understandable at a glance:

- what outcome was approved;
- what repository and target are in scope;
- which tracks may proceed independently;
- which slice is current in each track;
- which Baton responsibility is active;
- which common driver and role-selected model are executing it;
- what has durably passed, failed, blocked, or integrated;
- what is merely running, retrying, disconnected, or awaiting persistence;
- why progress stopped; and
- what safe action is available next.

The workflow remains Baton's fixed responsibility model:

```text
Plan
  -> Delivery
       -> independent tracks in parallel
       -> ordered slices serially within each track
       -> Implementer design -> Captain -> Implementer build -> Verifier
  -> compose completed track heads on release-wt
  -> fresh final assembly verification
  -> Merge exact passed release candidate
```

Roles are not drivers. Sworn has one common driver layer for speaking to each
supported runner. Configuration selects a driver and optional model for each
role. The GUI may display, for example, `Verifier · Codex CLI · selected model`,
but it must not imply that a separate Codex Verifier driver exists.

## One interface, three planes

The GUI combines three deliberately separate planes.

| Plane | Authority | GUI treatment |
| --- | --- | --- |
| Baton delivery | Approved plan, owning-ref records, evidence, verdicts, and observed Git facts | Durable delivery truth |
| Sworn runtime | Transactional commands, events, effects, workers, leases, logs, and budgets | Clearly labelled live overlay |
| Presentation | Layout, filters, expanded rows, pins, and local preferences | Client-only state with no delivery meaning |

The interface must never collapse runtime activity into delivery truth.
Every displayed delivery fact must have an identifiable owning record, Git
observation, or runtime source. Missing or malformed authoritative Baton state
is an error; Sworn must not reconstruct or heal it from runtime events.

```text
BATON · candidate recorded · verification required
SWORN · verifier effect running · 02:14 · 18k tokens
```

`Worker exited successfully` is an operational fact, not a Baton `PASS`.
`Merge effect completed` is not `integrated` until the durable record and Git
facts agree. Green success treatment is reserved for durable Baton outcomes.
When Baton and Sworn disagree, the UI shows both and reports that reconciliation
is required; it never heals or advances Baton from a runtime event.

## Interaction model

### Preflight

Before an autonomous run starts, show:

- release goal, repository, target, and approved plan revision;
- release, track, and slice topology;
- worktree isolation;
- role-to-driver and role-to-model routing;
- concurrency, retry, token, cost, and time budgets;
- required authority and assurance; and
- the operations that will be permitted.

The operator confirms this bounded run. Confirmation does not create authority
that is absent from the approved plan.

### Live release view

The primary screen has:

1. a header containing the release goal and factual aggregate counts;
2. a left rail showing Plan, Delivery, Final Verification, and Merge;
3. Delivery expanded into tracks with passed/total slice counts;
4. a main pane showing active and recent role invocations for the selected
   phase or track; and
5. a detail drawer for objective, inputs, events, recent tool activity, diff,
   design, evidence, verdict, blockers, logs, and audit.

```text
 Release v0.3.0 — Complete autonomous multi-track delivery
 7/12 passed · 3 agents active · 42m · budget status

 ┌ Baton route ───────────┬ Active work ─────────────────────────────┐
 │ ✓ Plan                 │ T1 / S03 · Verifier                     │
 │ ▾ Delivery             │ Codex CLI · selected model · 18k · 2:14 │
 │   ✓ Track A       3/3  │                                          │
 │   ● Track B       2/4  │ BATON · candidate ready · verification   │
 │   ◐ Track C       1/2  │ SWORN · verifier effect running          │
 │ ○ Final verification   │                                          │
 │ ○ Merge                │ Objective · Events · Diff · Proof · Logs │
 └────────────────────────┴──────────────────────────────────────────┘
```

Counts must be factual, such as `7/12 slices passed`; inferred completion
percentages and agent counts must not masquerade as delivery progress. Long
transcripts and tool streams stay behind drill-down rather than dominating the
release view. `All slices passed` is not `release ready`: track composition,
final assembly verification, and release Merge remain visible gates. Dependency
waiting, a Baton `BLOCKED`, a Verifier `FAIL`, and an operational `no verdict`
remain visibly distinct.

The Baton responsibility is the primary label for active work. Driver and model
are secondary execution details.

### The Baton relay graph

The signature navigation element is a branching and rejoining delivery graph:

- Plan begins the line;
- Delivery branches into the authored tracks;
- each track forms a relay lane with serial slices and at most one current leg;
- independent tracks may visibly advance in parallel;
- declared dependencies and consumed slice outputs remain visible as graph
  edges;
- track heads rejoin at release composition;
- final assembly verification follows composition; and
- Merge is the finish.

This is the actual approved topology rendered as structural navigation, not a
decorative graph. Baton defaults to its read-only relay view. Sworn adds
runtime and control overlays without becoming an arbitrary node canvas,
generic Kanban board, or DAG editor.

### Responsive and asynchronous use

Runs continue independently of an attached browser. Reopening the interface
reconstructs the view from durable state and resumes the event stream.

Desktop should be a calm, dense execution instrument. Mobile should prioritise
release health, active work, blockers, alerts, evidence summaries, and the exact
next operation. Hosted mobile begins read-only; privileged remote controls
require a separate security decision.

## Commands and authority

All mutations flow through one closed, typed Sworn command service. The GUI
never edits Baton records, invokes arbitrary shell commands, or injects generic
events.

Safe operational controls may include:

- start or resume an already approved plan;
- pause scheduling at a safe boundary;
- cancel an active effect or the whole run without manufacturing a verdict;
- retry a transport failure or no-result invocation with immutable inputs;
- restart a role as a new invocation and effect;
- take over interactively by pausing the track and acquiring an operator writer
  lease;
- copy or open the exact next Baton operation; and
- return control after a full Git and record rescan.

Protocol decisions may be exposed only as exact, capability-bearing commands:

- Captain `PROCEED`, `REVISE`, or `ESCALATE`, bound to the reviewed design;
- a new plan revision with separate authorizer proof; and
- integration of the exact passed candidate when current authority, target, and
  candidate bindings all revalidate.

A Captain decision is normally the result of a distinct Captain invocation. The
GUI must not relabel it as an operator acknowledgement. If a human explicitly
performs the Captain responsibility, the same exact design-bound decision
contract applies.

The interface must never offer:

- direct edits to plans, status, design, evidence, verdicts, or merge receipts;
- `mark passed`, `clear blocker`, `force merge`, or bypass-current-target paths;
- reuse of a verdict after candidate or target movement;
- drag-and-drop changes to track ownership, ordering, scope, or acceptance
  criteria;
- prompt editing, chat injection, or steering of an active clean-context
  Verifier;
- an arbitrary command or Git mutation endpoint; or
- saved generated orchestration as standing execution authority.

A browser login proves identity, not Baton authority. A mutation is accepted
only after local Sworn rereads Baton and Git truth, validates the actor's scoped
capability, rejects stale revisions and digests, persists an idempotent command
receipt, and reconciles the resulting effect.

The client does not optimistically advance protocol state. It shows
`command pending` until a durable receipt and refreshed projection exist.
Timeout means `outcome unknown; reconciling`, not permission to assume success.

## Baton board versus Sworn cockpit

Baton still ships its small, platform-agnostic, read-only graph board:

- one branch-aware oracle;
- JSON, terminal, and dependency-light local WebUI projections;
- a relay view of the plan's tracks, slices, ordering, dependencies,
  consumption, assembly, and Merge;
- no runner, account, Sworn installation, or hosted service required; and
- no mutation routes.

Sworn's cockpit is the richer execution surface:

- active workers and invocations;
- drivers and role-selected models;
- budgets, timing, tools, logs, retries, and leases;
- transactional operational controls;
- evidence and audit drill-down;
- multi-run and, later, multi-node aggregation.

Both consume the same Baton semantics. Sworn adds a runtime plane; it does not
replace or reinterpret Baton's durable plane.

## Open and hosted boundary

The complete local engine, operations API, responsive WebUI, generic
webhook/outbox, and secure self-hosting capability remain open and MIT licensed.

The hosted product sells operation, not an artificially withheld interface:

- secure outbound node enrolment;
- managed identity and remote access;
- fleet and team aggregation;
- durable notifications and audit retention;
- upgrades, availability, and support; and
- later, separately authorised remote controls.

The local agent remains final repository and command authority. Hosted services
receive safe events and submit typed, short-lived requests; they never directly
write Git or Baton state. Source, prompts, diffs, evidence, paths, and raw logs
remain local by default. Model brokering and managed inference remain outside
the product direction.

This public capture fixes the architecture boundary. The separately ratified
private hosted-control decision remains authoritative for commercial packaging.

## Engine prerequisite

The interface may not advertise parallel execution until Sworn implements
honest concurrency:

```text
claim transaction -> execute outside the store/controller lock
                  -> completion transaction -> derive eligibility again
```

A stateless release coordinator should repeatedly derive eligible tracks from
the committed Baton plan and current records, atomically claim and prepare at
most one current effect per track, execute under a store-issued lease without
holding the global scheduling mutex, bind and persist completion idempotently,
and then rederive. It enforces one writer per track and a bounded machine-wide
concurrency limit.

Sworn should not add a second scheduler database, generated workflow scripts,
durable workflow cursor, or port of the legacy scheduler. Its existing
transactional command/event/effect kernel remains the runtime authority.

## Delivery sequence

1. Finish and dogfood Baton RC2, including its thin board and generated
   platform adapters.
2. Pin RC2 and replan Sworn against its exact records and topology.
3. Close one single-track release end to end through all five Baton
   responsibilities, assembly verification, and release Merge.
4. Split claim, external execution, and completion so concurrency is real.
5. Add the minimal dependency-aware release coordinator and release/track/slice
   read model.
6. Publish one stable run snapshot, resumable typed event stream, and
   command/receipt contract.
7. Build the read-only embedded local workflow interface against recorded real
   runs.
8. Add authenticated local pause, cancel, retry, and interactive-takeover
   commands.
9. Add protected authority and exact-integration command flows.
10. Add generic webhook/outbox and hardened self-hosted access.
11. Project a metadata-minimised form of the same contracts into read-only
    hosted fleet and mobile views.

The first GUI milestone is valuable without mutation: truthful monitoring,
evidence, blockers, driver/model routing, and exact next-operation handoff.

## Acceptance gates

The direction is realised only when:

- a multi-track release visibly fans out while each track remains serial;
- the UI distinguishes durable Baton state from live Sworn activity everywhere;
- reconnecting reconstructs the same release state without browser-owned truth;
- no UI action can manufacture a Baton transition;
- every mutation is typed, idempotent, revision-bound, locally revalidated, and
  durably receipted;
- a clean-context Verifier cannot be steered by the implementation session;
- the exact passed candidate and current target are rechecked at integration;
- the local WebUI is complete and useful without the hosted service; and
- the interface remains understandable without prior knowledge of Sworn's
  internal engine vocabulary.

## Explicit non-goals

This decision does not create:

- an arbitrary business-workflow or BPM platform;
- a visual workflow authoring language;
- a transcript-first chat interface;
- generated orchestration as authority;
- another lifecycle store or reducer;
- per-role provider drivers;
- bundled model defaults;
- managed inference or model resale;
- direct hosted repository control;
- bespoke chat integrations or a native mobile application in the first GUI
  milestone;
- a mock interface claiming concurrency or autonomy before its engine boundary
  exists; or
- a return to Baton's former artefact and rule cascade.

## Design references

The interaction reference is Anthropic's
[Dynamic Workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
and its
[dynamic harness explanation](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code).
These are references for information hierarchy, fan-out visibility,
drill-down, and asynchronous operation. Baton's approved topology and Sworn's
typed authority model remain the governing architecture.

This decision supersedes the June 2026 proposal to deliver the WebUI and
multiple notification channels in one release. It retains the useful
machine-global view, embedded local server, responsive interface, shared
event/command core, and interactive handoff, but sequences those capabilities
behind a proven Baton RC2 loop.

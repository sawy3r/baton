# Baton B3 board and driver scope

Date: 2026-07-24
Status: implemented and corrected; awaiting independent re-review and composition
Stage: B3 / RC2 R5-R7
Integration branch: `release/v1.0.0`
Track branch: `track/v1.0.0/B3-board-driver`
Authority: [execution charter](./2026-07-24-baton-rc2-sworn-coach-parity-execution-charter.md)

## Objective

Restore Baton's immediate-value read surface and publish its small
role-independent process-driver seam:

1. one owner-aware, branch-aware oracle;
2. pure terminal and secure GET-only WebUI renderers over that oracle; and
3. one `info` / `run` driver contract with a deterministic fake.

B3 may run in parallel with B2 after the exact B1 commit is composed. It must
consume B1's parser, validator, record-root, Git identity, ownership-transfer,
and topology helpers rather than reimplementing them.

## Source ownership

```text
reference/
  board/
    oracle.mjs
    terminal.mjs
    web.mjs
  driver/
    contract.md
    fake-driver.mjs
test/
  board/
  driver/
conformance/fixtures/
  board/
  driver/
docs/captures/2026-07-24-baton-b3-board-driver-*
```

B3 adds no JSON Schema. Board and driver messages are compact versioned
contracts validated by code and fixtures.

## Oracle contract

The oracle:

1. discovers exact local `refs/heads/release-wt/*` release refs;
2. captures each release head and reads its approved plan;
3. obtains authored order, ownership, dependencies, target, and declared track
   refs only from that plan;
4. snapshots those exact ref heads and target;
5. retries once if the release ref moves, then returns
   `REF_SNAPSHOT_UNSTABLE`;
6. reads blobs through captured object IDs, never moving names;
7. selects release baseline before materialisation, mandatory owner state while
   active, and release state only after exact composition plus matching
   authority transfer;
8. validates every selected record and Git binding through B1;
9. derives dependency readiness and the first incomplete work in each track;
10. exposes every independently actionable track; and
11. treats assembly verification and release Merge as distinct final gates.

The oracle never:

- reads launch-working-tree state;
- scans arbitrary sibling branches;
- chooses a maximum lifecycle enum or newest timestamp;
- heals malformed records;
- treats missing/deleted refs as Merge proof;
- swallows Git failures into an empty board;
- invents `active`, `no_verdict`, workers, retries, cost, or logs; or
- declares completion from track counts before assembly Merge.

Repeated projection over identical object IDs is byte-identical.

## `baton.board/v1`

The compact deterministic projection contains:

- schema version, repository identity, overall validity, and diagnostics;
- releases in deterministic order;
- plan digest, release/target ref names and captured heads;
- release status;
- authored tracks, exact refs/heads, dependencies, blockers, materialisation,
  composition, and frozen head;
- ordered work with stage, durable status, next role, outcome, blocker, and
  selected source mode/ref/head;
- assembly as a distinct release-owned item;
- one deterministic `baton-merge / assembly` next operation when every track
  is transferred but the assembly proof and status do not yet exist; and
- structured next-operation descriptors.

Next operations identify operation, scope, release, track, and work. They are
not shell command strings.

Invalid authoritative state produces stable diagnostics, `valid:false`, no
derived next operations, and no partial green release. Other independently
valid releases may still render, while overall validity becomes false.

No timestamps, absolute paths, runtime facts, or model/provider data enter the
projection.

Exit codes:

- `0` — valid projection, including ordinary incomplete or blocked delivery;
- `2` — invalid repository or authoritative Baton state; and
- `64` — invalid invocation.

## Terminal renderer

The terminal is a pure function over `baton.board/v1`:

- no Git or independent lifecycle logic;
- release → tracks → ordered work → assembly hierarchy;
- stage, status, role, outcome, blocker, selected source ref/head, and next
  operation;
- `--color auto|always|never`;
- sanitization of ANSI, C0/C1, bidi, multiline, and overlong repository text;
- deterministic bytes with no regeneration timestamp; and
- no "ready to ship" before exact assembly Merge.

Golden fixtures prove rendering.

## Single-file local WebUI

`web.mjs` is one dependency-free Node file serving:

```text
GET /             static HTML shell
GET /app.js       client renderer
GET /style.css    stylesheet
GET /api/board    baton.board/v1
GET /favicon.ico  optional 204
```

It:

- binds numeric `127.0.0.1` by default and optionally exact `::1`;
- refuses wildcard and hostname binds;
- requires the exact numeric loopback Host and actual port;
- returns `421` for invalid Host and `405` with `Allow: GET` for every other
  method;
- rejects query strings and unknown or encoded paths;
- has no CORS or action route;
- contains no inline scripts/styles/handlers or server interpolation;
- inserts repository values only through `createElement`, `textContent`, and
  safe properties;
- bans HTML/parser/code-generation sinks;
- never lets request data choose a repo, ref, Git argument, subprocess, or
  operation; and
- imports no `child_process`; only the fixed oracle may reach B1's allowlisted
  read-only Git plumbing.

Required headers include a restrictive self-only CSP, `nosniff`, no-referrer,
same-origin resource policy, and `no-store`.

The client polls `/api/board` every 10–20 seconds. Refresh failure retains the
last view with a visible stale marker. It never silently claims freshness.

## Driver contract

Commands are exactly:

```text
driver info
driver run < request.json > result.json
```

`info` reports only contract version and driver ID/version.

`run` request binds:

- invocation ID;
- Baton role;
- exact canonical operation ID/version/digest/instructions;
- explicit selected model or deliberate `null`;
- absolute workspace and `read_only | read_write` access;
- named record inputs with repo-relative paths and raw digests;
- fresh-context requirement; and
- timeout/output limits.

Result binds invocation and driver identity, observed model, duration, optional
usage, result text, and exactly one transport status:

```text
completed | transport_error | timeout | cancelled | runner_error
```

`completed` means only that the runner returned a final response. It is not a
Baton outcome, verdict, Merge fact, or proof of freshness.

The driver emits exactly one result JSON object to stdout and bounded
diagnostics to stderr. Exit `0` means a valid result was emitted, including a
typed operational failure. Non-zero means the process could not honor the
driver protocol.

There is no default driver/model, fallback, tier, retry, cost policy, event-file
contract, `complete` command, result-interpreter model, provider code, or
provider-specific lifecycle logic in Baton.

The fake driver accepts only built-in deterministic profiles:

```text
completed | transport_error | timeout | cancelled | runner_error
```

It cannot execute an arbitrary command or fixture path.

## Acceptance criteria

### Oracle

- three-track real Git fixture with serial work and dependency gating;
- multiple independent actionable tracks;
- baseline, owner, and composed authority selection;
- foreign stale copies never win;
- missing/malformed mandatory owner fails visibly;
- exact frozen-head plus authority-transfer composition;
- assembly and observed target govern final completion;
- ref movement retries once then fails deterministically;
- identical object snapshots yield identical JSON bytes; and
- Git invocations scale with refs, not work items.

### Performance

- 100 authored work items across 20 refs project below one second median warm;
- bounded plan/status/diagnostic/string sizes;
- at most two snapshots;
- one tree/batched blob read per selected ref; and
- bounded ancestry checks.

### Terminal and WebUI

- both consume and expose the same fixture facts;
- injection corpus covers script/SVG/event payloads, quotes, ANSI, C0/C1,
  bidi, Unicode separators, and multiline values;
- exact security headers and CSP;
- no unsafe DOM/executable sink;
- Host, bind, method, traversal, query, stale-refresh, and malformed-oracle
  cases;
- every non-GET request leaves refs/object identities unchanged; and
- no renderer makes Git calls or derives lifecycle state.

### Driver

- every transport status;
- all five roles through the same fake executable;
- strict request JSON including duplicate/trailing/unknown/oversized cases;
- wrong invocation, missing result, crash, timeout, cancellation, and stderr
  noise;
- completed response never becomes a Baton verdict; and
- fresh-context requirement remains an engine dispatch obligation.

## Baton versus Sworn

Baton projects approved plan, committed record state, refs/commits, ownership,
dependencies, proof/verdict/Merge bindings, and next canonical operation.

Sworn later joins workers, active/no-verdict overlay, events, logs, attempts,
leases, retry/pause/cancel, runner/model/usage/cost, evals, alerts, and hosted
operations through stable identities. It never writes through or forks the
Baton board.

## Explicit non-goals

- working-tree fallback or malformed-record recovery;
- UI actions, shell commands, workers, SSE, or model/cost data;
- independent terminal/WebUI discovery;
- a second plan/status parser;
- another schema;
- concrete provider drivers; or
- any dependency beyond Node built-ins and Git.

## Handoff

B3 produces one exact board/driver commit and a concise outcome capture with
oracle selection, renderer parity, WebUI security, fake-driver, and performance
evidence.

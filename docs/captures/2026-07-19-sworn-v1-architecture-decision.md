# Sworn v1 architecture decision

Date: 2026-07-19
Status: conditional GO; Sworn repository cutover not yet performed

## Decision

Build Sworn v1 as a greenfield implementation **in Sworn's existing remote
repository, on a disconnected orphan branch created from a fresh separate
clone**.

1. Inventory every local ref, linked worktree, dirty path, ignored runtime store,
   and remote ref before selecting the exact v0 archival head. Preserve all refs
   in a mirror bundle and each worktree's index, staged, unstaged, untracked, and
   selected ignored state separately; a single tag is not a full archive. Digest
   the complete archive, copy it to a user-selected durable location outside the
   source clone and its worktrees, and prove restoration in a fresh scratch clone.
2. After authorizer confirmation, protect the chosen head with a legacy branch,
   annotated non-release tag, and remote branch/tag rules. Record and verify the
   exact local and remote object IDs.
3. Create the orphan v1 branch in a fresh clone of the same remote. Do not add
   another linked worktree to the current clone: linked worktrees share Git
   configuration, refs, objects, hooks, and the common directory even when their
   checked-out files are separate.
4. Install v1-specific CI on the orphan branch from its first commit. Do not
   change the repository default branch until the recovery proof has passed.
5. Preserve issues, captures, and selected black-box failure fixtures.
6. Port invariants and failure knowledge, not production packages.

This is not an incremental refactor. It is also not a second repository by
default. The existing remote preserves provenance, issues, release identity, and
the Go module path. An orphan branch gives v1 a real code-history boundary rather
than a giant delete commit or an accidental merge path back to v0.

The same remote still shares operational state: Actions, tags, releases, branch
rules, issues, and the default branch. Those surfaces require an explicit
cutover. Use a separate repository if v0 must remain actively maintained, v1
changes product identity or language, existing consumers require the old module
API indefinitely, or repository settings cannot isolate the two generations.

The live `release/v0.2.0` checkout is currently at `303dc1d2`, three commits
ahead of `origin/release/v0.2.0`; `origin/main` is a different, older head. The
clone currently has 40 linked worktrees, 17 local branches not merged into that
release head, and at least one substantially dirty linked worktree containing
both modified and untracked files. The remote has no existing tags, v1 branch,
branch protection, or tag ruleset. Phase 0 must resolve which exact commit is
the canonical archive while preserving the other archaeology; it must
not infer one from a branch name, discard unmerged refs, clean worktrees, or
capture only the first dirty path. A tag matching `v*` also triggers the current
release workflow, so use a non-release archival tag such as `legacy/v0-final`
unless publishing a final v0 release is intentional.

The architecture is a conditional GO for greenfield implementation after Baton's
schema, strict-JSON, canonicalization, and cross-record model suite passes, an
immutable Baton v1 commit or tag exists, and the v0 archive manifest is reviewed.
The authority, containment, persistence, and exact-integration boundaries below
are implementation gates. Repository cutover and unattended use remain a NO-GO
until their real-binary recovery proofs pass.

At this review point the local Baton suite passes 7 strict-JSON cases, 2
canonicalization vectors, 46 schema fixtures, and 99 executable cross-record
cases. Its 18 real-boundary engine cases are correctly not yet run. That passing
result is necessary but not a pin: Sworn still waits for the immutable Baton v1
commit or tag.

## Why the current control plane should not be repaired

The live checkout contains 50,087 production Go lines, 60,268 test lines, 45
top-level internal packages, and 68 files under `cmd/sworn`. A normal cached
build produced a 54 MB binary and used about 668 MB peak RSS. Embedded prompt
Markdown alone contains 53,955 words.

Size is not itself the defect. The problem is that the code encodes several
competing ownership models:

- `board.json` and Git refs describe the plan and repository assembly;
- mutable `status.json` combines state, proof, routing, design decisions, and
  economics (`internal/state/state.go:462`);
- `.sworn/sworn.db` holds a second track-state vocabulary, events, decisions,
  and circuit failures (`internal/db/db.go:27-64`);
- event storage can move to a release-specific database while the TUI reads the
  main database (`internal/supervisor/supervisor.go:237-256`);
- pause is a process-local Go map despite comments claiming CLI/TUI/MCP sharing
  (`internal/scheduler/pause.go:5-60`); and
- at least seven production files rewrite whole `status.json` records without an
  expected revision or idempotency key.

Terminal state is not atomic with the effect it claims. Several paths discard
status, event, commit, or push errors. `blocked` is simultaneously a verdict
field, an error-string sentinel, a track side channel, and supervisor `failed`.
A schema-valid state can be unknown to the Go state machine and route as
terminal-complete. `INCONCLUSIVE` is typed separately but deliberately follows
the same implementation retry path as `FAIL`
(`internal/orchestrator/triage.go:65-124`).

Verification is not bound to the integrated candidate. The current verifier
input and verdict omit immutable base/head/submission identity
(`internal/verify/verify.go:176`, `internal/verdict/verdict.go:26`), while later
integration consumes a mutable branch. Freshness is stamped true rather than
proved by a dispatch receipt. Predicted `planned_files`, not the actual diff,
can authorize parallel composition.

The driver retrofit found the right process seam but left two execution systems.
Task planning and standalone verification can still construct model clients
directly, while the loop uses the driver registry. The driver result mixes
transport state, Baton outcomes, provider taxonomy, cost, tokens, model identity,
and structured output. Provider SDKs and the duplicated in-process coding-agent
runtime remain in the engine.

The prompt/engine boundary is worse: raw manual-era prompts still tell agents to
discover worktrees, mutate status, commit, push, forward-merge, route slash
commands, and create proof even though the engine tries to own those operations.
Some retain unsubstituted `<slice-id>` and `<release-name>` placeholders. A normal
slice injects roughly 12,000 static system-prompt words across design, Captain,
builder, and verifier before the work payload.

Repairing this means replacing state ownership, persistence, orchestration,
drivers, prompts, records, adapters, and integration semantics while keeping
compatibility paths and tests that encode the old behavior. That is a rewrite
with a harder proof burden.

## Product definition

Sworn v1 should be:

> A small deterministic delivery engine that turns an approved Baton plan into
> exact candidates, obtains fresh independent verdicts, recovers external
> effects safely, and exposes a truthful board.

Sworn is not an LLM runtime, provider marketplace, project methodology, or
general workflow framework. Native coding-agent CLIs own tool use, provider
evolution, and context management. Sworn still owns the trust boundary around
them: workspace isolation, sandbox requirements, credential exposure, process
lifetime, immutable inputs, and Git authority.

## First product surface

- `sworn init` — detect available subprocess runners, write one small runtime
  config containing the immutable repository identity and target backend,
  scaffold an interactive authority source bound to a separately configured
  authorizer verification capability, and scaffold a strict `assurance-policy-v1`
  at `sworn.policy.json`;
- `sworn run --plan <path>` — validate a plan, resolve its authority, obtain any
  required exact-digest approval, then start or resume its delivery;
- `sworn revise <run> --plan <path> --expected-revision <n>` — attach an
  authorized plan revision after a pre-submission control stop or `SPEC_BLOCK`;
- `sworn retry <run> --expected-revision <n>` — open one new bounded retry epoch
  after an implementation or verification budget is exhausted, without changing
  the plan or manufacturing a verdict;
- `sworn board [<run>] [--json]` — render the read-only projection;
- `sworn integrate <run> --expected-revision <n>` — release the local manual
  latch and execute a pending integration only when the approved plan already
  grants it; and
- `sworn doctor` — check config, Git, authority capability, policy and check
  digests, runners, schemas, isolation, and recovery health.

Standalone verification is not an initial mutation surface. A later reproduction
command may run read-only and emit an advisory assessment, but it cannot select a
verdict or change a run. Every routing verdict is scheduled by the one command
core.

The kernel milestone consumes a `delivery-plan-v1` whose `authority.ref` can be
resolved; the engine still creates the approval receipt before activation.
Before a public v1, add `sworn run --task <text>` as a thin planning dispatch
that emits the same plan shape, presents it for approval, and then calls the same
run command. It must not become a second orchestration architecture.

Every accepted run command returns a durable run ID. Repeating the same plan
digest for the same repository and target resumes its sole non-terminal run;
ambiguity fails closed rather than creating duplicate delivery.

At most one non-terminal run may own a `(repository_id, target_ref)` pair in the
serial kernel. Another delivery fails as target-busy with the owning run ID. For
that run's `delivery_id`, `sworn run` presented with a different plan digest
fails with the existing revision; only `sworn revise` may attach that plan. A
terminal delivery identity is immutable history. Repeating its plan returns the
terminal receipt, while genuinely new work requires a new `delivery_id`.

The walking skeleton first admits a deliberately small Baton subset: one work
contract, Standard assurance with no packs, component or assembled evidence that
the local policy can produce, and a direct fast-forward target. Before any public
release or conformance claim, the same kernel must also enforce arbitrary
selected assurance-pack definitions and multiple work units delivered serially.
These are protocol-generic reducer paths, not plugins or extra model roles. A
schema-valid plan outside the capability set active at that milestone is rejected
before runner dispatch with an explicit unsupported-capability control result;
it is never partially executed or silently weakened. `live` evidence, parallel
work, and protected targets requiring pull-request, squash, or merge-commit
workflows remain later capabilities.

## Internal shape

```text
cmd/sworn/          thin command adapters
internal/protocol/  Baton records, validation, canonical digests
internal/engine/    sole command service, reducer, retry policy
internal/store/     one transactional command/event/effect/record store
internal/effects/   checks, external-effect execution, reconciliation
internal/repo/      Git workspaces, exact candidates, compare-and-swap integration
internal/executor/  sole contained subprocess and process-lifetime boundary
internal/adapter/   runner-specific argv construction and result decoding
internal/policy/    authority resolution, checks, assurance selection
internal/board/     read-only projection
internal/config/    runners and local execution restrictions
```

There is no separate router, scheduler, orchestrator, supervisor, mutable state
package, or provider/model layer. If the serial walking skeleton needs dozens of
packages or materially exceeds 8–10k production lines, stop and reassess.

`internal/protocol` embeds one immutable Baton schema and conformance snapshot at
build time. `sworn version` reports its source commit or tag and snapshot digest.
Sworn implementation does not begin against an uncommitted protocol working
tree: the pin is admitted only after Baton's schema, strict-JSON,
canonicalization, and cross-record model cases pass and its engine cases are
enumerated with immutable fixtures. Sworn must then pass those engine cases
through its real binary before claiming conformance. There is no runtime
protocol fetch, global installer, vendored prompt manual, or dual-version reader.

## Executable authority

Schema validity is not approval. Sworn activates a plan only after an authority
resolver accepts its `authority.ref` and the command service records approval of
the exact canonical plan digest. Merely invoking `sworn run --plan` is not
approval: an autonomous caller must not become its own authorizer.

The initial resolver supports two modes over a pre-existing, strict authority
source named by `authority.ref`:

- **interactive** — the source names a separate authorizer capability or public
  verification key. Approval is a detached signature or equivalent capability
  proof over the exact canonical plan digest, authority-source digest,
  repository, target, requested grants, assurance, and approval nonce. That
  capability is unavailable to the autonomous caller and is never mounted into a
  runner. A TTY may display the consequences and collect the proof as user
  experience, but `isatty`, a PTY, keystrokes, and the caller's OS identity are
  not approval; or
- **standing** — the source contains one closed delegation predicate that may
  approve a plan without a prompt. It names the permitted authenticated task or
  plan issuer, repository and target, literal include/exclude scope ceiling,
  protected paths, grant ceiling, assurance floor, required and allowed pack
  versions, validity period, and revocation mechanism. Unknown predicate fields
  fail closed. A bare plan file without the required signed or engine-authenticated
  issuer provenance cannot use standing authority.

In both modes the source artifact is outside runner write scope, binds its
authorizer identity, and is authenticated by authorizer signing material or a
capability unavailable to the autonomous caller. A caller may present source or
proof bytes but cannot forge valid replacements. The engine resolves and digests
the source, evaluates every requested plan dimension against the closed predicate
or verifies the exact-plan approval proof, and stores the proof bytes as a
separate content-addressed artifact bound by the immutable approval event. The
exact resolved source bytes are also retained in the artifact store under their
digest for historical validation. The strict Baton authority receipt remains
unchanged and records only its defined
source, plan, grants, target, authorizer, and approval bindings. Non-interactive
execution requires a standing source. A broad action name such as `edit` does not
imply repository-wide scope, permission to change a protected path, or
permission to lower assurance. The engine re-resolves the receipt, source digest, signature or
delegation facts, validity, and revocation state before builder dispatch, verifier
dispatch, accepting `PASS`, and integration. An unreadable, expired, revoked,
changed, signature-invalid, runner-writable, or non-matching source fails closed.

For every effect, effective authority is the intersection of:

1. actions requested by the immutable plan;
2. actions accepted by the resolved authority record; and
3. local execution policy.

Configuration may narrow this set but never enlarge it. When the plan contains
the exact integration grant, `integration: manual` stops a valid `PASS` at
`ready_to_integrate`; `sworn integrate` records a revisioned latch-release
command. It exercises existing authority and does not create it. Without that
plan grant, the row remains `verified` and `sworn revise` must attach a new
authorized plan digest. The exact integration grant covers only the named product
target. It does not authorize another branch, a metadata ref, a release, a
package publication, a deployment, or an arbitrary external write. Local policy
may further forbid remote integration.

`sworn revise` verifies that the new plan names the same delivery, repository,
and target, records its own approval receipt, and creates a new plan record and
command. It never rewrites the contract bound to an existing submission or
verdict. Facts may be banked only when their earlier plan and authority remain
valid and every fact they bind is unchanged; otherwise the engine creates a new
attempt. A revision that changes the work contract, assurance policy, or grants
cannot reuse an old verdict. It may reuse unchanged candidate bytes as an input,
but the engine must construct a new submission and obtain a fresh verdict under
the new plan and receipt.

## One control truth

Use one embedded transactional SQLite store for operational recovery. SQLite is
not the current flaw; multiple authorities and unchecked effects are. Building
locking, crash-safe append, revisions, idempotency, and truncation recovery over
JSONL would recreate a weaker database.

A minimal schema begins with:

```text
commands(command_id, idempotency_key, run_id, expected_revision, request_digest,
         kind, payload, state, receipt, created_at)
events(seq, run_id, revision, kind, payload, created_at)
effects(effect_id, idempotency_key, run_id, caused_by_seq, kind, payload,
        state, attempt, result, timestamps)
records(kind, digest, canonical_json, created_at)
```

`commands.kind` is likewise closed: `run_start`, `plan_revise`, `retry_epoch`,
and `integration_release`. Read-only board and doctor calls are not commands.
`effects.kind` is a closed v1 enum: `builder_invoke`, `candidate_capture`,
`check_invoke`, `verifier_invoke`, and `target_integrate`. Evidence producers use
`check_invoke`; they do not create a generic task effect. Phase 5 may add exactly
`planner_invoke`. Adding any other kind is an explicit architecture change, not a
runtime plugin or string convention. Each admitted kind has one strict local
payload/result schema and one named reconciliation function; unknown fields or
kinds fail before scheduling.

Use SQLite's schema version mechanism and explicit forward migrations. At
minimum, enforce uniqueness of `(run_id, idempotency_key)`, `(run_id, revision)`,
effect idempotency keys, and `(kind, digest)`. A duplicate command is looked up
before stale-revision rejection: an identical request returns its original
receipt, while the same idempotency key with different bytes fails closed. One
transaction accepts a mutating command, advances the run by exactly one revision,
appends exactly one aggregate event for that revision, and schedules its effects.
Each later effect observation likewise advances one revision and appends one
aggregate event in its own transaction. If event granularity later needs
expansion, add an explicit ordinal; do not make revision semantics depend on an
accidental number of rows.

The control root is resolved from
`git rev-parse --path-format=absolute --git-common-dir`, never from the current
worktree. The database lives at `<git-common-dir>/sworn/v1/control.db`, artifacts
at `<git-common-dir>/sworn/v1/artifacts/sha256/<hex>`, runtime configuration at
`<git-common-dir>/sworn/v1/config.json`, and the OS lock in that same root. This
gives every linked worktree of one local repository one writer and one truth.
The runtime configuration uses the string discriminator
`"schema_version": "sworn-config-v1"` and is the sole home of the opaque
repository ID and its immutable local-or-remote backend binding. The root-level
`sworn.policy.json` is a strict, reviewable, tracked `assurance-policy-v1`; it does
not contain the repository ID or runtime backend. There is no automatic v0
migration.

The event history plus immutable records is the sole operational truth. One
local engine process holds the repository-scoped OS-released lock for mutation
and effect execution; board readers open SQLite read-only. Runner children never
write the store. There are no worker leases, fencing tokens, scheduler ownership,
or distributed completion paths. The board is a projection, and there is no
writable `status.json`.

Every mutating command carries an expected revision and idempotency key. The
initial run key is derived from the plan digest, repository ID, and target;
revisioned commands bind kind, run, expected revision, and request digest.
Repeating an identical terminal run returns its existing receipt rather than
creating a second delivery unless a future explicit new-run command says
otherwise.

Every external operation follows:

```text
accepted -> reconciling
              | already observed -> completed
              + not observed -> executing -> observed -> completed
```

Effect completion is recorded before a success projection is possible. Each
effect kind has one idempotency and reconciliation rule. In particular, after an
uncertain integration the engine reads the exact target before considering any
retry. A runner or check crash quarantines its disposable workspace; because the
child cannot write the store, no late completion can alter truth.

Referenced logs and evidence are copied into the content-addressed artifact
store using write, fsync, atomic rename, and directory fsync. Only after the bytes
are durable and their exact raw-byte digest has been rechecked may a transaction
record the artifact pointer. A crash may leave an unreferenced artifact, which is
safe to collect; it must never leave a committed pointer to absent bytes. Sworn
rechecks stored bytes on every read and immediately before `PASS` or integration.
Ephemeral workspace paths are not evidence.

SQLite and its content-addressed artifacts are the kernel's only durable control
and decision state. Local candidate refs retain Git object bytes, and the target
ref is an observed external fact; neither is an alternate reducer history. There
is no Git audit branch and no second recovery authority. Database loss fails
closed; the engine does not reconstruct decisions from branch names or candidate
commits. A later `sworn export` may emit a content-addressed, append-only run
bundle to an explicitly chosen destination, but export is a one-way observation.
It cannot change a run, authorize integration, or become an alternate board
source.

## Git candidate and integration mechanics

`sworn init` records one explicit repository ID in runtime configuration. Sworn
maps that exact opaque ID to the current Git common directory and one target
backend: the local repository or one explicitly selected remote. For a remote,
the binding includes its resolved endpoint identity rather than trusting a
mutable alias alone. Exact repository-ID equality is required across plan target,
integration grant, submission base, and candidate.

That ID-to-backend binding is immutable once initialized. A local-to-remote,
remote-to-local, common-directory, remote-endpoint, or equivalent backend change
is not a configuration edit: it requires a new repository ID and newly approved
plans. Existing receipts and history retain the old binding. Sworn never guesses
that an SSH URL, HTTPS URL, filesystem path, or remote alias denotes the same
repository, and `doctor` fails on mapping drift. Full target refs are additionally
validated with Git's own `check-ref-format`; schema validity alone is not enough.

The run receipt binds repository ID, full target ref, and expected commit. The
builder receives read-only Git metadata and cannot own repository refs or its
index. The engine inspects workspace bytes against the immutable base using a
sanitized Git environment and derives actual changed paths from Git objects using
Baton's normative literal-prefix scope rules. When the tree changed, the engine
creates the candidate commit itself with the exact base as parent. When the diff
is empty because the base already satisfies the contract, the candidate is the
base commit and no artificial commit is created; checks and fresh verification
still run, and authorized integration reconciles as `already_observed`.

Before recording a candidate, Sworn retains it under an engine-generated local
ref such as `refs/sworn/v1/candidates/<safe-hex>`. It creates and verifies that ref
before committing its DB pointer. A crash may leave an unreferenced candidate
ref, which reconciliation can collect; the database must never refer to an
unreachable candidate. Every recorded submission keeps its candidate ref for as
long as that record is retained. V1 performs no automatic candidate garbage
collection. Candidate refs are local engine state, never pushed, and never use
plan-supplied text in their names.

Integration updates the product target to the exact verified candidate. A local
update uses `git update-ref <target> <candidate> <expected>` only when the target
is not checked out in a user worktree. A remote update must be a direct
fast-forward with an explicit expected old object and exact readback. If branch
policy requires a pull request, squash, merge commit, publication branch, or any
other write, the kernel stops without performing it or claiming integration.
The integration effect payload and receipt bind the admitting event revision,
exact submission digest, and current verdict digest. Re-verification creates a
new write-once verdict in event order; it cannot inherit an older effect receipt,
and any pending effect bound to a superseded verdict fails stale before execution.

If readback shows the target equals the candidate or Git proves that candidate
is an ancestor of the target, the engine reconciles the uncertain effect as
completed; later serial work must not erase banked integration. If the target is
neither the candidate nor its descendant, target movement invalidates integration
authority under Baton B5. The engine does not keep retrying the old verdict: it
constructs a new attempt from the new target, creates a new candidate, and
requires a new submission and fresh verdict. A protected-branch rejection that
leaves the target unchanged remains `ready_to_integrate` with a durable refusal
reason, not success.

## Candidate checks and evidence

The strict Baton assurance policy names content-addressed baseline check
definitions and assurance packs. Its initial portable source is a canonical
`sworn.policy.json` read from the exact base commit. The plan's
`assurance_policy.ref` must resolve that exact `assurance-policy-v1` blob and its
digest must match. Sworn resolves and digests every baseline check definition
and each selected pack definition before dispatch. A check definition is
data: identifier, argv array, repository-relative working directory, timeout,
environment allowlist, deterministic trigger, maximum evidence boundary, and the
acceptance or pack claims it can support. Sworn never executes a shell command
string supplied by config or a model.

`sworn.policy.json` is a built-in protected control path even when ordinary work
scope includes `.`. A delivery may change it only when the plan separately names
that literal path and an independent exact-plan approval capability explicitly
authorizes the protected-policy change; standing delegation cannot do so. The
engine uses the immutable base policy for the entire delivery, including review
of that change, and never adopts candidate policy bytes mid-attempt. A newly
integrated policy is revalidated and becomes eligible only for a later approved
plan. Runtime configuration and authority sources remain outside candidate write
scope entirely.

Capability admission happens before a runner starts. For each acceptance
criterion, the engine must have at least one registered check or observation
producer capable of reaching its requested boundary; this is a mechanical
boundary-capability test, not a claim that the producer semantically proves the
criterion. The builder report may request those producers and map their IDs to
acceptance IDs; it cannot supply an argv, elevate a boundary, or turn its prose
into evidence. The engine runs the registered producer against the immutable
candidate, captures the bytes and environment, and constructs the evidence
entry. The independent verifier, not the engine or builder, decides whether that
evidence actually supports the criterion. If no executable boundary route exists,
the run stops at `attention` rather than dispatching work that can never produce a
valid `PASS`.

After a builder exits successfully, the engine:

1. inspects the workspace from trusted, read-only Git metadata and rejects
   forbidden effects and out-of-scope paths;
2. creates the exact candidate commit itself;
3. materializes that immutable candidate afresh without inherited remotes,
   object alternates, hooks, or host Git configuration;
4. runs every policy-required check and requested registered evidence producer
   through the same contained executor, then stores receipts and artifacts; and
5. constructs `submission-v1` from Git facts, dispatch receipts, check receipts,
   and digest-verified evidence.

A failed deterministic check routes directly to a builder repair attempt; it is
not mislabeled as a verifier `FAIL`. If actual diff facts trigger a stronger pack,
the engine does not mutate the attempt's assurance. It stops for `sworn revise`,
which may record the new approved plan digest, assurance-policy digest, and
authority receipt. The initial Standard-only kernel then remains at `attention`
with an unsupported-pack reason; it does not create or relabel a submission until
that pack is implemented. Unknown or unavailable required packs stop safely.

All engine Git commands run with an isolated HOME and system/global configuration
disabled. Hooks, credential helpers, configured clean/smudge filters, implicit
submodule fetches, and other checkout-time execution are disabled. The fresh
candidate materialization contains only bound Git objects; no object alternate,
worktree-local file, or inherited remote is evidence.

## Reducer semantics

The engine accepts typed commands, appends facts, and schedules effects. Internal
effect phases such as `building`, `checking`, and `verifying` are not writable
delivery state. The Baton board projects only canonical meanings:

```text
waiting -> ready -> active -> reviewable
                    |          | PASS without grant -> verified -> revise
                    |          | PASS with grant + manual latch
                    |          |        -> ready_to_integrate -> integrating -> integrated
                    |          | PASS with grant + auto -> integrating -> integrated
                    |          | FAIL -> repair -> new submission
                    |          | SPEC_BLOCK -> blocked
                    |          | INCONCLUSIVE -> retry -> same submission
                    | plan or authority concern -> attention
                    + check failure -> next builder attempt, no verdict
```

`active` means the current implementation attempt is still before submission;
the engine may internally be running its builder or candidate checks.
`reviewable` means an immutable submission exists, including while its fresh
verifier is running. The projection is a pure function of events, records, and
repository facts; its semantic content is reproducible. The strict board has no
render-time field; a UI may show local clock data only outside the protocol
record.

For the one-work kernel, top-level aggregation is explicit:

| Work row | Top-level state |
| --- | --- |
| `waiting` | `planned` |
| `ready`, `active`, `reviewable`, `repair`, `retry` with an open budget | `active` |
| `attention`, `blocked`, or any exhausted actionable row | `attention` |
| `verified` | `verified` |
| `ready_to_integrate` | `ready_to_integrate` |
| `integrating` | `integrating` |
| `integrated` | `integrated` |

The exhaustion event is therefore part of the aggregation input even when the
work row remains `reviewable`, `repair`, or `retry`. Before Phase 3 exits, Sworn
must implement and test Baton's deterministic multi-row aggregation rules for
serial work.

Exact routing:

- builder transport failure -> quarantine that invocation workspace and retry
  the builder within its transport budget;
- a builder's pre-candidate contract or authority concern -> typed control stop
  projected as `attention` for the authorizer, not a fabricated `SPEC_BLOCK`
  verdict; `sworn revise` is the recovery path;
- deterministic check failure -> retain the engine-stamped receipt and schedule
  a new builder attempt without manufacturing a submission or verdict;
- verifier transport failure -> retain `reviewable`, record the transport fact,
  and start a fresh verifier over the same immutable submission within budget;
- current authority or policy loss after submission -> preserve the factual row,
  raise delivery-level `attention`, admit no `PASS`, and schedule no new effect;
- `INCONCLUSIVE` -> project `retry` and start a fresh verifier over that same
  submission within budget;
- `FAIL` -> builder repair with typed findings and a new attempt;
- `SPEC_BLOCK` -> stop for an authorized `sworn revise` command;
- `PASS` without the plan's exact integration grant -> `verified`, then
  `sworn revise` and a new submission and verdict;
- `PASS` with that grant but a local manual latch -> `ready_to_integrate`, then
  `sworn integrate`;
- `PASS` with that grant and automatic local policy -> start the authorized
  integration effect;
- target readback equals or descends from the candidate -> reconcile integration
  as complete and retain its exact receipt;
- target readback is neither the candidate nor its descendant -> invalidate the
  old integration path and start a new candidate/submission/verdict attempt from
  the moved target.

Builder implementation attempts, builder transport retries, and verifier retries
have separate counters and bounded epochs. An exhausted pre-submission builder,
check, or transport budget returns the work row to `ready`; exhausted verdict
repair remains `repair`; exhausted verifier transport remains `reviewable`; and
exhausted `INCONCLUSIVE` remains `retry`. In every case the top-level state is
`attention`, the row carries a durable exhaustion reason, and automatic dispatch
stops.
Only a revisioned, idempotent `sworn retry` command can open one new bounded
epoch under the unchanged plan and authority. It never synthesizes a verdict.
The engine never schedules that command itself. Local policy sets a hard maximum
epoch count and may require a separate authorizer proof; a TTY prompt alone is
never that proof, and standing retry delegation cannot exceed the source and
local ceilings. There are no error-string sentinels or inferred provider error
taxonomies.

## Runner boundary

Sworn v1 is subprocess-only, and every subprocess crosses one contained executor.
Adapters describe a native CLI invocation and decode its output; they cannot
launch processes themselves.

```go
type Input struct {
    Name   string
    Path   string
    Digest string
}

type Invocation struct {
    ID            string
    Role          string
    Workspace    string
    Inputs        []Input
    Instructions string
    ResultSchema json.RawMessage
    Timeout       time.Duration
}

type ExecSpec struct {
    Argv []string
}

type Adapter interface {
    Prepare(Invocation) (ExecSpec, error)
    Decode(RawCompletion) (json.RawMessage, *Usage, error)
}

type Executor interface {
    RunContained(context.Context, Invocation, ExecSpec) (RawCompletion, error)
}
```

The sole executor owns workspace mounts, input digest checks, environment,
process lifetime, bounded stdout/stderr capture, timeout, and exit status. An
adapter owns only stable CLI argv and structured-result decoding. Neither layer
has a Baton outcome, provider taxonomy, pricing table, capability matrix, model
default, repository mutation, or routing decision. The command engine records
start/completion times, adapter identity, input digests, exit status, and the
immutable dispatch receipt.

The model emits small engine-local reports, not canonical Baton records:

```text
builder-report-v1:
  candidate_ready | plan_attention, summary, registered evidence requests

verifier-assessment-v1:
  outcome, summary, acceptance results, assurance results, findings
```

These are two small strict engine-local schemas, not a second public protocol or
state vocabulary. The engine validates those reports, derives all repository
facts, and stamps `submission-v1` and `delivery-verdict-v1`. A model never
supplies authoritative run IDs, timestamps, candidate fingerprints, or
`fresh_context`; freshness is proved by the verifier dispatch receipt created
after submission immutability.

The walking skeleton ships a test-only fake JSON adapter and one real adapter,
Codex. Codex is the only runner-adapter gate for public v1. Claude, OpenCode, and
any later adapter earn admission independently after the Codex path passes; their
absence or rejection does not delay the first conforming release. Configuration
should be no larger than:

```json
{
  "schema_version": "sworn-config-v1",
  "repository": {
    "id": "repo-01",
    "target_backend": {
      "kind": "remote",
      "name": "origin",
      "endpoint": "ssh://git.example/sworn.git"
    }
  },
  "runners": {
    "builder": { "kind": "codex" },
    "verifier": { "kind": "codex" }
  },
  "execution": {
    "max_builder_attempts": 2,
    "max_transport_retries": 1,
    "max_verifier_attempts": 2,
    "max_retry_epochs": 1,
    "integration": "manual"
  }
}
```

If no model is configured, the native CLI's own configuration decides. Sworn
does not collect API keys or create an account.

Builder instructions should be at most about 250 words; verifier instructions
about 400. Both point to digest-checked input records rather than embedding a
manual. The clean Standard path is two model-role invocations—one builder and
one verifier—not necessarily two underlying model turns inside those agentic
CLIs. Deterministic producers remain bounded subprocesses, not model roles.

Each invocation runs in a new disposable materialization with read-only Git
metadata and no writable remote, target ref, engine candidate ref, or Git
publication credential. The verifier is created only after submission
immutability and receives no builder transcript or reusable CLI session. It runs
from an empty neutral control workspace, while the exact candidate is mounted
read-only at a separate non-project path with separately digest-checked record
inputs. Native CLI project discovery is rooted in the neutral workspace.
Candidate-local instruction, MCP, plugin, callback, hook, and runner-configuration
files remain visible as candidate bytes for review but are never loaded as
verifier control. Any authorizer-selected project guidance is supplied explicitly
as a digest-checked input instead of being auto-discovered. After the process
exits, Sworn rechecks candidate identity and bytes before accepting its assessment.

Fresh process creation alone is not containment: a same-user process can reach
parent paths, credentials, and other repositories. A conforming built-in runner
must therefore use the one proven executor backend and pass parent-write,
credential-read, ref-write, network-effect, resource-exhaustion, candidate-config,
and background-child escape fixtures. The initial conforming stack is Linux with
Bubblewrap for mount/user namespace containment and a cgroup-v2 transient service
managed by the user systemd instance. Each invocation has non-disableable ceilings
for runtime, memory, swap, tasks/PIDs, CPU, retained output, file size, and total
writable temporary bytes; project configuration may narrow but never remove them.
The service uses at least `KillMode=control-group`, `RuntimeMaxSec`, `MemoryMax`,
`MemorySwapMax`, `TasksMax`, `CPUQuota`, and `LimitFSIZE`, while writable mounts are
size-limited. A small
executor shim is that service's main process and monitors an engine-owned pipe;
engine death closes the pipe, the shim exits, and systemd kills the
whole cgroup. Minimum tool and kernel versions are pinned in CI and checked by
`sworn doctor`. Another OS or Linux host without that stack is unsupported until
an equivalent backend passes the same real-binary corpus. A generic JSON adapter
may aid development but cannot produce a conforming `PASS` when containment
cannot be enforced.

Bubblewrap is always invoked with `--die-with-parent`, `--new-session`,
`--unshare-user`, and `--unshare-pid`; its private mount namespace exposes only
explicit bindings. The real Git common directory and control root are hidden;
the invocation receives only isolated read-only Git metadata and digest-checked
inputs. Only the scoped builder workspace, a temporary HOME, and size-limited
temporary output paths are writable; the verifier's candidate mount is read-only.
Deterministic checks additionally use `--unshare-net`, with any declared local
test services launched inside that same namespace. A model CLI needs provider
transport, so its adapter must enable the native CLI's proven tool-network
sandbox; inability to separate provider transport from model tool network makes
that adapter nonconforming.

The executor launches only an argv array, never a shell string; supplies a
minimal allowlisted environment; drains stdout and stderr independently with
bounded retention; and treats non-zero output only as diagnostics. It kills the
complete child process scope on timeout and ensures an engine crash cannot leave
a billable child mutating an old workspace. An adapter that cannot prevent
model-directed external effects is nonconforming. Only the minimum native-CLI
authentication material is exposed read-only, never Git publication
credentials. Each adapter uses an isolated CLI configuration with no resumed
session, inherited MCP or plugin server, callback, user hook, or mutable global
memory.

This threat model protects against accidental and model-directed
out-of-authority effects. Defending against a privileged host administrator is
outside scope. Unsupported containment or credential isolation fails `doctor`
rather than silently weakening assurance.

## Measurement and observability boundary

Sworn measures from control truth; it never makes telemetry another truth. The
command, event, effect, and immutable dispatch records retain every fact needed
for exact local reporting and the Phase 4 corpus: engine-observed timestamps,
attempts, retries, outcomes, containment results, adapter and installed-CLI
identity, candidate and policy digests, recovery and compare-and-swap results,
and runner-reported usage. Usage is explicitly `reported` or `unknown`; zero is
not a synonym for unknown. Sworn neither estimates tokens nor owns a model
pricing table. Any reported monetary amount is retained only with its currency
and source receipt.

OpenTelemetry is the one optional observation boundary. A bounded asynchronous
adapter may project accepted engine facts as traces and low-cardinality metrics
over OTLP. Export is disabled by default, lossy, and read-only: exporter failure,
delay, duplication, sampling, or absence cannot reject a command, change a
revision, schedule or retry an effect, select a verdict, authorize integration,
or alter the board. The engine and its recovery tests run identically with the
no-op adapter. OpenTelemetry semantic-convention mappings are internal and
version-pinned; they are not Sworn or Baton record contracts.

Use one process-activation trace correlated by the durable Sworn run ID, with
child spans for work and individual effect attempts. A resumed process creates a
new trace segment rather than pretending a span survived the crash. High-cardinality
identifiers belong on spans, not metrics. Sworn records only what it can observe:
an aggregate native-agent subprocess is not represented as a model call unless
the runner supplies a trustworthy structured model-operation receipt.

No prompt, completion, source, diff, evidence body, filesystem path, credential,
or native-CLI argv is exported by default. An explicit local configuration may
permit selected content, but no assurance level requires remote export. An
OpenTelemetry Collector or any compatible backend may receive OTLP. LangSmith is
an optional dogfood and evaluation destination, never a kernel dependency;
LangChain and LangGraph own no Sworn execution, checkpoint, retry, model, tool, or
state semantics. Evaluation data may inform adapter admission, but any result
used by policy is first captured as an immutable local artifact and admitted by
the normal command path. Sworn never queries an observability backend while
deciding a live run.

The OpenTelemetry Go API/SDK and OTLP exporter may be proposed as the narrow
instrumentation dependency before Phase 4. Their exact packages, versions,
binary impact, shutdown behavior, and bounded-queue configuration require a
v1-local dependency ADR and failure-path tests. A LangSmith SDK belongs, if ever
needed for dataset administration, in separate evaluation tooling rather than
the production kernel.

## Explicit v1 non-goals

Do not initially build:

- TUI, MCP, web UI, or a remote control mutation API;
- account, billing, login, proxy, hosted Sworn telemetry, telemetry-backed
  control, notifications, or model pricing;
- provider SDKs or an in-process coding-agent loop;
- mandatory Captain or model-based gate cascade;
- requirements/design/journey/architecture commands;
- memory, induction, benchmarking, or project discovery systems;
- parallel tracks, distributed scheduling, or multi-host control;
- a Git audit branch, bidirectional portable replica, worker leases, or fencing;
- pull-request creation, protected-branch bypass, squash/merge composition, or
  publication and deployment adapters;
- v0 migration, aliases, or dual-read paths; or
- a generic workflow or plugin framework.

The board starts as text and JSON. Additional interfaces are read-only clients
until the single command core is proven.

## Proof order

### Phase 0 — freeze and extract

Generate a machine-readable manifest of every local and remote ref, linked
worktree and HEAD, index and staged state, unstaged, untracked and selected
ignored path, upstream divergence, existing tag, workflow trigger, and repository
rule. Every preserved HEAD object must be reachable from a bundled ref or an
explicit archive ref. Preserve all refs and reachable objects in a mirror bundle,
and capture each dirty worktree's index and file bytes separately without cleaning
or modifying it. Record SHA-256 digests for the bundle, every capture, and the
manifest that relates them.

Copy that checksummed archive to a user-selected durable location outside the
source clone and all linked worktrees. Restore it into a fresh scratch clone,
run object-integrity checks, and mechanically compare every ref, worktree HEAD,
object ID, dirty-state classification, and captured-path digest with the manifest.
The restore report is itself checksummed and reviewed by the authorizer. The owner
then selects the canonical v0 archival head and any local-only state that must be
promoted.

Only after that resolution and successful external restore proof, create and push
a protected legacy branch and non-release annotated tag, install branch/tag rules
that make them effectively immutable, and verify their remote object IDs. Create
the orphan v1 branch in a fresh separate clone, with v1 CI matching that branch
from its first commit.
Keep the current default branch and scheduled workflows unchanged until the
recovery proof is complete. Turn confirmed failures into a compact black-box
corpus by copying fixture bytes, never by merging v0 production history. Do not
copy production packages wholesale.

### Phase 1 — deterministic kernel

First require the immutable Baton v1 pin gate to pass. Then prove strict JSON,
schema and cross-record validation, canonical digests, strict assurance-policy
and content-addressed baseline-check resolution, authority source and receipt
resolution, exact-plan signature verification, every field of the closed standing
delegation predicate, protected-policy approval, repository ID and full-ref
admission, immutable repository-backend binding, normative path-scope matching,
supported-capability admission, active-target ownership, reducer replay, one
aggregate event and revision per accepted transition, stale revisions,
duplicate-command idempotency, schema migration, the closed effect enum, effect
reconciliation, durable artifact ordering, safe candidate-ref retention, exact
record binding, and reproducible board semantics without a model. A simulated PTY
without the separate approval capability, a standing plan outside any one
predicate ceiling, a protected policy edit under standing authority, and a
backend remap under an existing repository ID must each fail closed.

### Phase 2 — real-binary walking skeleton

The first executable milestone builds the real binary and creates a cold
temporary repository plus bare remote. It launches an external fake builder in a
contained disposable materialization, has the engine create and retain the exact
candidate, runs an engine-owned deterministic check and registered evidence
producer through the same executor, durably stores their artifacts, launches a
separately contained fake verifier over the immutable submission, constructs a
`PASS` verdict, and integrates by expected target revision. It crashes and
restarts from the Git-common-dir SQLite store at selected boundaries, reconciles
the target, and renders the same board. A second linked worktree must observe the
same store and lock. No in-process fake may replace the CLI, executor, subprocess,
SQLite, artifact, candidate-ref, Git, or persistence boundaries.

### Phase 3 — adversarial recovery

Inject crashes before and after every dispatch, artifact rename, candidate-ref
creation, DB record, verdict, target update, and integration receipt boundary.
Prove `FAIL -> repair -> PASS`, `SPEC_BLOCK -> revise`, pre-submission
`attention -> revise`, `INCONCLUSIVE`, timeout, kill, budget exhaustion followed
by exactly one revisioned retry epoch, stale candidate, dirty or
out-of-scope diff, selected-pack enforcement, serial multi-work delivery,
duplicate command,
idempotency-key collision, competing plan and target ownership, unknown
command/effect rejection, target movement followed by a new candidate and fresh
verdict, and crash after integration but before receipt. Also prove:

- a hostile fake cannot change engine Git metadata, update target or candidate
  refs, push, invoke a configured Git hook/filter, read publication credentials,
  write a parent path, make an undeclared network effect, or leave a background
  child alive;
- candidate-local agent instructions, MCP/plugin configuration, callbacks, and
  hooks cannot become verifier control even though their bytes remain reviewable;
- fork bombs, memory or swap pressure, CPU loops, oversized output, file growth,
  and temporary-storage exhaustion hit their invocation ceilings without
  destabilizing the engine or host;
- an autonomous caller with a synthetic PTY but no separate signature or
  capability cannot approve its own plan, while each standing-delegation ceiling
  is enforced through the real resolver;
- an uncertain external write is reconciled before any retry;
- a target checked out in a user worktree is refused safely;
- a PR-only, squash-only, merge-only, or otherwise protected target is refused
  without a false integration claim;
- a required baseline check failure banks its receipt, creates no submission or
  verdict, and causes zero verifier invocations before builder repair;
- already-satisfied work records `candidate == base` and `changed_paths == []`,
  still passes real checks and fresh verification, and reconciles integration as
  `already_observed` without creating an empty or unrelated commit;
- every selected assurance-pack definition and result is bound and enforced,
  while unavailable unselected packs do not block Standard work;
- two dependent work units execute serially, the second builder starts only
  after the first `PASS`, its base contains the first candidate, both effect
  receipts remain valid after target advancement, and multi-row board replay is
  deterministic;
- a schema-valid but unsupported live-evidence, parallel-work, or
  protected-target plan is rejected before runner dispatch;
- missing DB, artifact bytes, candidate objects, or authority sources fail
  closed; and
- v0 config and database files cannot be mistaken for v1.

Do not switch the repository default branch, publish v1, or rely on Sworn for
unattended delivery before this phase passes on the supported OS matrix.

### Phase 4 — real-agent dogfood

Run a fixed corpus through the real Codex argv/decoder adapter using the same
contained executor. Measure dispatch count, fixed prompt tokens, orchestration
wall time, repair rate, verifier disagreement, false greens, false reds, and
recovery. The clean Standard target is exactly two model-role invocations and
zero Sworn-added model judgments for routing, status, checks, authority, or
integration.
Exercise the actual installed CLI version; mocked envelope tests do not establish
adapter compatibility. Claude, OpenCode, and later adapters run this same corpus
independently and are advertised only after they pass; they are not public-v1
release dependencies.

### Phase 5 — task-to-plan public UX

Add `sworn run --task <text>` as one planning runner invocation that produces
`delivery-plan-v1`. Validate it, show the authority and assurance consequences,
obtain approval, and pass the exact digest into the existing run command. Ship a
plan template and actionable validation errors as the non-model fallback. This
milestone makes v1 approachable without adding another control plane.

Only after Phases 3–5 pass should v1 become the default branch and public
release.

### Phase 6 — optional parallelism, then interfaces

Serial multiple-work delivery is already a public-v1 gate. Parallelism earns
admission only after actual diff overlap, stale-base rejection, partial-progress
banking, conflict handling, and deterministic restart are proven. A later
one-way `sworn export` may produce a portable content-addressed terminal bundle,
but it never becomes operational truth or an authority source. Add read-only
interfaces later; all controls must submit the same revisioned commands.

## What to salvage

Preserve as invariants and black-box tests:

- the four-way typed verdict;
- fresh contained subprocess isolation and immutable verifier inputs;
- repository identity, full-ref, candidate, and target assertions;
- Git object and ancestry inspection;
- JSON Schema validation;
- the plan/board separation; and
- the architecture reviews and incident corpus.

Do not port mutable status records, router/scheduler/supervisor packages, sentinel
errors, PID ownership, provider SDKs, in-process tools, prompt manuals, planned
file safety, legacy fallbacks, or adapter-owned mutations.

The governing maxim is:

> Greenfield code; inherited knowledge. Port tests and invariants, not packages.

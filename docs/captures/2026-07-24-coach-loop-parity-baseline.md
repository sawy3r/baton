# Coach-loop parity baseline

Date: 2026-07-24
Status: binding requirements baseline
Authority: [Baton RC2 and Sworn Coach-parity execution charter](./2026-07-24-baton-rc2-sworn-coach-parity-execution-charter.md)

## Purpose

This capture defines what "parity with the Coach loop" means for the Baton RC2
and Sworn rebuild. It prevents parity from being inferred later from a UI,
single-slice demo, driver stub, or remembered conversation.

Parity means reproducing the useful behavior of the last pre-Sworn system while
replacing its Bash process substrate and accumulated Baton ceremony with the
ratified lean architecture.

## Archaeological boundary

The primary checkpoints are in the Fired repository:

- `e984d658` — earliest complete recoverable five-responsibility loop, commands,
  Git oracle, terminal board, and local WebUI;
- `5d836ed6` — fresh inline responsibility dispatch without tmux;
- `2c8ce241` — authored plan separated from per-slice mutable state; stateless
  board projection;
- `0c7b1460` — calibrated autonomous Captain design review;
- `b7654a30` — one common runtime-driver contract; and
- `124265bd` — fullest substantive pre-Sworn multi-provider behavior.

The strict product split begins at `386d4589`. Commits after the useful
checkpoints are failure evidence, not source to restore wholesale.

The backup grew from about 9,000 lines at the earliest complete point to almost
19,000 lines before Sworn, then beyond 30,000 lines with the later twelve-rule
system. Line count is not the parity target.

## Binding capability matrix

| Capability | Coach behavior to preserve | New owner and requirement | Historical machinery to reject |
| --- | --- | --- | --- |
| Planning | Planner authors release goal, work, tracks, dependencies, scope, and acceptance before implementation | Baton plan operation and record; external authority activates exact plan bytes | Planner creating worktrees or code; heavyweight requirements cascade |
| Implementer design stop | First slice dispatch writes a proposed design and stops | Baton Implementer hands exact design to Captain before build | Treating design review as an after-the-fact check |
| Captain | Distinct design-review invocation returns proceed, revise, or escalate | Baton Captain returns `PROCEED`, `REVISE`, or `ESCALATE`, bound to current plan and design | Captain as scheduler; file-mediated human ack choreography as protocol |
| Implementation | Implementer resumes after approval, changes code, runs checks, and presents proof | Baton Implementer produces exact candidate and acceptance-linked evidence | Agent-authored lifecycle state or unsupported completion claims |
| Verification | Fresh clean-context Verifier alone returns pass, fail, blocked, or no result | Baton Verifier is read-only and adversarial; Sworn proves fresh dispatch and containment | Builder self-certification; collapsing failure, blocked scope, and runner failure |
| Track Merge | All ordered slices in a track pass before its frozen head composes into the release worktree | Baton Merge checks exact passed head; Sworn serialises release-worktree mutation | Concurrent assembly writers; merging mutable or merely claimed heads |
| Release Merge | All tracks compose before release lands on target | Baton RC2 adds a fresh assembly Verifier over the composed candidate, then exact release Merge | Treating per-slice PASS as authority to ship an unverified composition |
| Recovery | Resume from committed refs and records; dirty or wrong worktree fails closed | Sworn transactionally claims, journals effects, reconciles, and resumes from durable state | Transcript recovery, PID-file truth, heuristic phantom-state healing |
| Intervention | Pause, resume, kick/retry, inspect logs, and take over interactively | Sworn typed commands and leases; Baton board remains read-only | UI writing lifecycle files; arbitrary shell endpoint |

The final assembly Verifier is a deliberate safety improvement over the
historical release merge, not a parity exception.

## Topology and concurrency

The required topology is:

```text
target branch
  <- release-wt/<release>
       <- track/<release>/<track-id>
```

- The release worktree is materialised once before track fan-out.
- The approved plan assigns ordered slices to each track.
- A track has at most one current slice and one writer.
- Independent dependency-ready tracks may execute concurrently.
- A track is created from the release worktree only after its declared
  dependencies are composed there.
- Shared release-worktree composition is serial.
- Track branches are durable recovery and handoff anchors, not disposable
  per-slice sandboxes.
- Unexpected overlap or conflict blocks composition for repair or replan; it is
  never silently resolved by discarding work.

The following are not parity:

- one global serial loop;
- a generic slice worker pool;
- one worktree per slice;
- multiple concurrent workers in one track; or
- a scheduler that ignores authored track ownership.

## Oracle and board behavior

Plan membership and ownership come from the committed release-worktree plan.
Each materialised slice is read from its owning track ref until exact
composition transfers authority to the release ref.

The oracle:

- reads committed refs rather than launch-directory files;
- selects by authored ownership and composition provenance;
- derives the first actionable nonterminal slice in each dependency-ready
  track;
- derives track and release merge readiness;
- treats a missing or malformed authoritative record as an error; and
- never chooses an arbitrary copy merely because its state appears newer.

The historical shorthand "most advanced state" means the most forward
authoritative owner state. It does not authorize an enum maximum across stale
sibling-branch copies because delivery transitions can move backward after
review.

Baton supplies the thin JSON, terminal, and GET-only WebUI projection. Sworn
supplies the richer runtime board and release cockpit. Both consume one Baton
truth model.

## Driver parity

The original useful architecture had one driver boundary used by every role.
Role configuration selected a model; the driver was not specialised per role.

Sworn must provide one common contract and these concrete adapters:

| Driver family | Required behavior |
| --- | --- |
| Codex CLI | Native agentic CLI execution, non-interactive operation, role-selected model, ephemeral/no-memory Verifier, structured result and usage where available |
| Claude Code CLI | Native agentic CLI execution, non-interactive operation, role-selected model, fresh Verifier session, structured result and usage where available |
| OpenAI-compatible | Configurable base URL, credentials, model, structured output, tool calls, usage, timeout, cancellation, and normalized transport result |
| DeepSeek | Named configuration and compatibility suite even when sharing OpenAI-compatible transport; tool and reasoning-content compatibility |
| Gemini | Native Google transport semantics, model selection, structured output, function calls, usage, timeout, and cancellation |
| Amazon Bedrock | Standard AWS credential/region chain, model selection, Converse-compatible messages/tool use, usage, timeout, and cancellation |

Every adapter reports capabilities. A role dispatch fails before inference when
the selected driver cannot perform its operation.

Full driver capability means every named family can perform every
model-executed Baton responsibility, including the workspace-mutating
Implementer, when its selected model supports the required tool contract.
Remote inference adapters share one small, auditable driver-side workspace tool
runtime. Provider adapters translate their wire protocols; they do not each
grow a separate coding agent or lifecycle implementation. This self-hosted
driver capability is distinct from selling managed inference as a hosted
product.

There are:

- no driver-per-role implementations;
- no bundled model defaults;
- no silent provider fallback or rotation;
- no nested result-interpreter model call;
- no managed-inference resale; and
- no secret material in Baton records or Sworn events.

The committed driver corpus and credential-gated live smoke suite define
support. Merely accepting a provider-shaped configuration does not.

## Command-surface parity

Historical user-facing delivery commands map to the five Baton operations:

| Historical commands | New operation |
| --- | --- |
| `plan-release`, `replan-release` | `baton-plan` |
| `implement-slice` | `baton-implement` |
| `review-tldr` and design decision | `baton-design-review` |
| `verify-slice` | `baton-verify` |
| `merge-track`, `merge-release` | `baton-merge` with explicit scope |

Historical loop-administration behavior maps to Sworn:

- run, status, next, and dispatch;
- pause, resume, cancel, and retry;
- logs, workers, terminal board, and WebUI;
- escalation and interactive takeover; and
- exact track and release integration.

`mark-shipped` is post-delivery bookkeeping, not a core Baton responsibility.
It does not gate Coach-loop parity unless a consuming product explicitly adopts
it.

## Recovery and trust parity

The real implementation must prove:

- repository, branch, worktree, and candidate identity;
- dirty-worktree fail-closed behavior;
- one writer per track;
- idempotent command and effect handling;
- crash recovery before dispatch, during execution, after result, during
  persistence, and during Git mutation;
- bounded retries and progress-based escalation;
- semantic `FAIL`, contract/authority `BLOCKED`, and operational `no verdict`
  remain distinct;
- a missing worker result cannot become success;
- one parked track does not stop independent tracks; and
- release-worktree and target compare-and-set gates reject movement.

Sworn replaces Bash polling, sleeps, process scans, inherited locks, mtime
heartbeats, and signal trees with leases, effect receipts, process containment,
and transactional reconciliation.

## Presentation parity

At minimum an operator can:

- see release, tracks, ordered slices, dependencies, and current roles;
- identify why a track is waiting, failed, blocked, or operationally stalled;
- inspect design, evidence, verdict, candidate, logs, and exact next operation;
- see active workers and elapsed/usage data;
- reconnect without losing truth;
- pause or take over without creating a second writer; and
- distinguish all-slices-passed from assembly-verified and merged.

Sworn's ratified release cockpit supersedes the large Coach mission-control UI.
It preserves its operational value without making browser state authoritative.

## Historical test gap

The earliest system had no automated lifecycle suite. The fullest pre-Sworn
backup had tests concentrated around driver dispatch and a small amount of
release-worktree setup, but no adequate automated coverage of:

- the complete Captain-to-Implementer loop;
- owner-aware divergent-ref selection;
- full multi-track lifecycle;
- parallel coordination;
- Merge and recovery; or
- terminal/WebUI parity.

New parity therefore requires real tests rather than replaying the old suite:

1. complete reducer transition table;
2. three-track fixture with serial slices, dependencies, and independent
   parallel progress;
3. divergent-ref owner-aware oracle fixture;
4. crash/restart/idempotency injection at every effect boundary;
5. all concrete driver adapters, required CLI arguments, and clean Verifier
   behavior;
6. `FAIL` versus `BLOCKED` versus operational `no verdict`;
7. serialized track composition and exact candidate binding;
8. final assembly verification and exact release Merge;
9. one snapshot/event/command contract across terminal and GUI; and
10. unattended dogfood in a real repository.

## Final classification rule

At final review, every materially useful Coach capability must be classified as
one of:

- **PARITY** — reproduced with real evidence;
- **SUPERSEDED** — replaced by a safer capability with real evidence; or
- **REJECTED** — intentionally omitted by a ratified non-goal.

Unimplemented, mocked-only, undocumented, or assumed behavior is **MISSING** and
prevents the parity goal from completing.

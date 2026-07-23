# Baton Core 1.0

Baton is a small protocol for delivering software autonomously without treating
an agent's confidence as proof. It keeps five trust boundaries stable while
leaving tools, models, prompts, storage, and scheduling to the people and
systems using it.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## B1 — Stay inside the agreed work

Autonomy begins with an exact plan approved by an external authorizer. The plan
states the outcome, included and excluded scope, acceptance criteria,
dependencies, required checks, constraints, target, and integration authority.

The Planner may propose or revise that plan but cannot approve it. An
Implementer, Captain, Verifier, Merge invocation, or autonomous engine MUST NOT
silently widen the approved work. A material change to scope, contract,
constraints, checks, ownership, or authority requires a newly approved plan
revision.

Approval evidence MUST bind the exact plan bytes and be protected from the
delivery actors that rely on it. A caller-controlled label or an agent's claim
that approval happened is not approval.

## B2 — Keep durable facts

Facts that decide what happens next MUST survive the conversation that produced
them. Baton carries an approved plan, an Implementer design, candidate proof,
and one validated status projection. Git supplies their history and the
repository facts they name.

Chat transcripts, mutable dashboards, timestamps, and recollection are not
delivery truth. A board is a read-only projection of committed records and Git;
editing it cannot advance work.

Runtime facts such as workers, retries, leases, tokens, and cost may be stored by
an autonomous engine. They do not become a second Baton lifecycle.

## B3 — Prove the real result

Proof identifies the exact candidate and links every acceptance claim to
falsifiable evidence. The evidence MUST exercise the boundary named by the
claim. A leaf test cannot prove an assembled journey, a mock cannot prove a real
integration, and an Implementer's unsupported statement is not evidence.

Repository identity, base, candidate, tree, changed product, required checks,
and evidence references are independently observable facts. Missing, stale,
fabricated, or unreachable evidence cannot support completion.

## B4 — Use a fresh independent Verifier

No Implementer certifies its own work. Verification runs in a clean context
with no inherited implementation conversation, no authority to change the
candidate, and read-only access to the exact candidate and its handoffs.

The Verifier tries to disprove completion and returns exactly `PASS`, `FAIL`, or
`BLOCKED`. A runner crash, timeout, cancellation, or malformed response creates
no Baton verdict.

`PASS` binds the approved plan, Captain-reviewed design, proof, and exact
candidate. Changing any of them invalidates it.

## B5 — Merge only what passed

Merge is a named, normally mechanical responsibility. It rechecks current
authority and integrates only the exact candidate covered by `PASS`, against an
expected target head.

A moved target, changed candidate, unexpected history or merge tree, conflict,
or persistence failure stops without claiming success. A track becomes eligible
only when every ordered work item has its own `PASS`; its final passed candidate
and later record-only commits define the frozen head. Eligible tracks may be
composed only through the approved release topology. Their assembled result
requires a separate fresh verification before release Merge.

## The useful minimum

The normal chain is:

```text
approved plan
  -> Implementer design
  -> Captain decision
  -> Implementer candidate and proof
  -> fresh Verifier
  -> exact Merge
```

Independent tracks may run that chain concurrently. Work remains serial inside
each track: one work's `PASS` admits the next, but does not compose the track.
After all work passes, the exact frozen track heads rejoin for assembly
verification.

Everything beyond these five boundaries must earn its cost as a deterministic
check, project policy, engine mechanism, or optional heightened review.

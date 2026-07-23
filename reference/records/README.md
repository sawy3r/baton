# Baton reference records

The supported mutation entry point is `createBatonActions` from `actions.mjs`.
It binds one admitted plan, repository, execution profile, protected-evidence
resolver, and record-root policy:

```js
const actions = createBatonActions({
  repo,
  plan,
  profile: 'autonomous',
  resolveEvidence,
  resolveBehavioralInertness,
});
```

The returned object has seven methods:

- `installApprovedPlan({ approvalDigest })`
- `reboundPristinePlan({ previousPlan, approvalDigest })`
- `recordTransition({ scope, workId, result, nextStatus, handoffs })`
- `materializeTrack({ trackId })`
- `composeTrack({ trackId })`
- `prepareAssembly({ proofBytes, producerInvocation })`
- `integrateRelease()`

Callers provide authored durable facts only. The facade derives record paths,
authority refs, expected heads, Git topology, and commit messages from the
admitted plan. It validates prepared commits before compare-and-set, applies
the complete effect in one ref transaction, and returns a deeply frozen
receipt. An exact retry returns `changed: false` without another commit.
That result is admitted only after the same predecessor, lifecycle,
candidate/assembly-history, and exact-effect checks as the original action; an
existing status with a matching projection is not an idempotency proof.
Install begins only when the plan's release namespace is absent. Rebound
requires both its predecessor and result namespaces to contain exactly the
plan plus planned baseline statuses; stale handoffs, assembly records, and
unknown extras fail before mutation. Composition and integration retries also
recompute their canonical deterministic commits, so a structurally equivalent
sibling OID is not accepted as the engine's effect.

The lower-level modules also export explicitly named `unsafe*` primitives for
the facade implementation and adversarial fixtures. They are not a substitute
for the admission, lifecycle, prospective-state, and atomic-effect checks above.

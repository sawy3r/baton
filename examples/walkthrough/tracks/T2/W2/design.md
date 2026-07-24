# Approach

Add one short recovery runbook that tells an operator where to find the
checkout retry key, how to retry, and when to stop and escalate.

# Surfaces

- `docs/runbooks/checkout-recovery.md`
- this work item’s Baton handoffs

# Consequential decisions and risks

The runbook names only controls already present in the service. The main risk
is an unsafe repeated retry; the stop condition is explicit and tested.

# Evidence plan

A2 runs the documentation link and required-section check, then records the
rendered runbook review.

# Revisions

None.

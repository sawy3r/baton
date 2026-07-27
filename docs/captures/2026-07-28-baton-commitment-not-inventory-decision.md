# Commitment, not inventory

Date: 2026-07-28
Status: ratified
Authority: Brad, through the protected Baton RC6 plan approval
Target: Baton v1.0.0-rc.6
Plan blob: `621860d80ab3d4423a43e9e9f5525b264552f498`

## Decision

Baton constrains the trusted delivery commitment, not every intelligent step an
Implementer or Verifier may discover.

The approved commitment contains:

- observable behavior and product surfaces;
- acceptance and minimum required checks;
- semantic and safety limits;
- hard exclusions;
- authority and externally owned decisions; and
- actual delivery dependencies and consumed product.

Predicted file lists, ancillary tests and oracles, support-file discovery,
additional focused checks, evidence notes and corrections, scheduling, retries,
worktrees, and bookkeeping are operational facts. Their actual paths, outputs,
and identities belong in the candidate, evidence, Git history, or engine
records. They do not revise an otherwise unchanged plan.

## Repair routing

- An Implementer repairs clerical, procedural, support, and evidence omissions
  within the approved outcome.
- A Captain may return `PROCEED` with bounded corrections that do not alter the
  contract.
- A Verifier `FAIL` returns the same stable slice directly to implementation
  for another candidate attempt.
- A material design change crosses to Captain.
- A material behavior, consumed-product, contract, authority, or
  external-decision change crosses to Planner or the external authorizer.

Release and slice identities remain stable throughout ordinary repair.

## Assurance retained

This decision does not weaken protected external approval, exact immutable
bindings, distinct Captain judgement, fresh read-only adversarial verification,
fail-closed missing trust facts, consumed-product pins, or exact-candidate
Merge. Hard exclusions remain hard.

The reference reducer already represented the required routing: Captain
`PROCEED`, `REVISE`, and `ESCALATE` remain distinct, and Verifier `FAIL` already
returns the same slice to implementation. RC6 therefore clarifies the protocol
and operations and adds an executable real-Git regression; it does not add a
role, lifecycle state, receipt, schema family, or orchestration mechanism.

## Regression boundary

The positive journey uses one approved plan whose product scope names only the
observable product, then discovers ancillary test, oracle, and maintenance
paths, runs an additional focused check, corrects evidence after `FAIL`, and
reaches fresh verification without replacing the plan, release, or slice.

The negative journey proves that a material behavioral change still produces
Captain `ESCALATE` and cannot record an implementation candidate until revised
authority exists. Existing consumed-product, contract, approval, exact
candidate, and Merge adversarial cases remain part of the complete suite.

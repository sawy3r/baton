# Baton Assurance 1.0

The five core principles and five responsibilities apply to every delivery.
Assurance adds evidence or external judgement when the work's risk warrants it;
it does not create another universal loop.

## Standard

Standard delivery requires:

- one exact externally approved plan;
- an Implementer design reviewed by a distinct Captain;
- an exact candidate and acceptance-linked proof;
- the project's required deterministic checks;
- a fresh, read-only, adversarial Verifier;
- exact track composition and fresh assembly verification; and
- expected-target Merge or an honest stop when Merge is not authorized.

Projects decide which checks are relevant to their product. A check name in a
plan is not proof it ran; proof must link its observable result to the exact
candidate.

## Heightened assurance

A plan or repository policy MAY require additional checks, evidence boundaries,
review questions, or external decisions for risky work. Examples include
security, privacy, money, data migration, public contracts, deployment,
regulated behavior, and hard-to-reverse architecture.

Heightened policy is local and explicit. It SHOULD define:

1. the deterministic trigger or plan selection;
2. the exact required checks or observations;
3. the stronger evidence boundary;
4. the additional questions the Verifier must answer; and
5. any decision that remains with an external authorizer.

The selected requirements are written into the approved plan and therefore
covered by its raw digest. They cannot silently appear, disappear, or change
meaning during implementation.

An engine or Verifier may request stronger assurance but cannot weaken the
approved requirements. If the current plan is insufficient, the truthful result
is `BLOCKED` followed by a newly approved plan revision.

## Admission rule

A proposed universal requirement belongs in Baton Core only when removing it
would break trust for nearly every delivery. Otherwise it belongs in:

- a deterministic reference or engine invariant;
- a repository check;
- explicit heightened policy; or
- nowhere, when fresh verification and cheap retry already contain the risk.

Incident history is valuable test evidence. It is not, by itself, another
document every future responsibility must read.

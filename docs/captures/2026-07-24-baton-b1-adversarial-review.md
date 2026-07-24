# Baton B1 adversarial review

Date: 2026-07-24
Status: failed
Reviewed head: `65cd466814457dfa8449a9562531007301338be0`
Reviewed contract commit: `b65b6b893cb468a22165c2c11ab992a9dd1ab2fa`
Track: `track/v1.0.0/B1-contract-records`
Prior outcome: [B1 contract and records outcome](./2026-07-24-baton-b1-contract-records-outcome.md)

## Verdict

Independent Captain and Verifier review rejected the B1 completion claim.

The reviewed head passed its published 36 Node tests and portable conformance
suite, but those tests did not prove six load-bearing boundaries. The prior
outcome is therefore superseded as a completion verdict. Its measurements and
test results remain historical facts about the failed head.

## Findings and reproductions

### F1 — Approved scope was described but not enforced

Plan validation admitted work paths outside the owning track's touch surfaces
and did not reject effective work overlap between nominally disjoint tracks.
Proof validation established candidate identity but did not derive the exact
base-to-candidate Git changes or compare them with work include, exclude, and
track scope. A product commit could also be inserted before a first work
candidate or after an earlier passed candidate. Caller-selected record roots and
an optional `recordRootConsumed` boolean made the inert-root exception a claim
rather than trusted admission.

Reproduction: construct a schema-valid plan whose work includes `src/shared`
under a track limited to `src/alpha`, or prove an off-scope add/delete/rename
whose candidate remains reachable from the owner head. Structural and Git proof
validation accepted both at the reviewed head.

### F2 — Materialisation mixed moving refs with uncaptured dependencies

`MATERIALIZE` changed only `authority_ref`. It did not persist one exact release
base and dependency-head set shared by the track. Dependency validation resolved
the release and track names repeatedly, so a later ref movement could satisfy a
dependency that was absent from the head from which the dependent track was
actually created.

Reproduction: create a dependent track before its dependency is composed, later
advance the release ref and dependency transfer records, then validate against
the moving names. The reviewed helper observed the later state rather than one
materialisation snapshot.

### F3 — Owner selection did not close absent/deleted-owner cases

When the owning track ref was absent, selection accepted any valid-looking
release status with release authority. It did not require the pristine approved
baseline. A never-created work could therefore appear terminal, and deleting an
owner ref could make a fabricated release copy authoritative. Repeated named-ref
reads also permitted snapshot mixing.

Reproduction: omit or delete the track ref and place a completed status with a
plausible frozen head on `release-wt`. The reviewed selector could return the
release copy without proving the authored owner lineage.

### F4 — Git execution was not fully engine-owned

The helper scrubbed Git environment variables but still selected `git` through
inherited `PATH`. Deterministic merge-tree calculation could load repository
attributes and a locally configured external merge driver. That driver could
execute arbitrary code or make the claimed deterministic result depend on
untrusted repository-local configuration.

Reproduction: prepend a fake `git` executable to `PATH`, or commit a
`.gitattributes` custom driver and configure its command locally. The reviewed
head did not prove that the fake binary or driver could not influence
composition.

### F5 — Assembly had no durable `FAIL` repair projection

Work `FAIL` returned to its Implementer, but assembly has no Implementer and the
schema rejected that projection. The protocol documented assembly `PASS` and
`BLOCKED` only, leaving an ordinary implementation/evidence defect without a
truthful durable next state distinct from an external block.

Reproduction: apply Verifier `FAIL` to a valid assembly proof. Structural
validation rejected the resulting state instead of preserving the proof and
finding for Planner-authorized repair or replan.

### F6 — External trust claims had no required resolver seam

Status carried approval and Verifier-dispatch references, digests, and boolean
claims, but structural validation did not resolve the referenced bytes or
establish protected approval and clean/read-only exact-candidate provenance.
A syntactically valid record could therefore be mistaken for autonomous
admission.

Reproduction: use an unresolved approval reference, substitute another reference
with the same claimed digest, provide wrong dispatch bytes, or assert false
provenance while keeping the status shape and internal digests consistent. The
reviewed structural parser could not distinguish those records from trusted
ones.

## Bounded correction

B1 reopens only to:

1. enforce plan-to-track scope and exact Git deltas from durable materialisation
   and prior-candidate bases;
2. bind materialisation to one release object and exact dependency heads, then
   validate only captured objects;
3. make owner selection consume one ref snapshot and fail closed for
   absent/deleted or fabricated owner lineage;
4. use one trusted absolute Git executable and an engine-owned merge context
   that never invokes repository-local external drivers;
5. add a distinct assembly `FAIL` projection and authorized recovery path;
6. separate structural record validity from guided/autonomous admission through
   a required external evidence resolver; and
7. add input bounds, stricter refs, and record-root mutation guards discovered
   during the same boundary review.

The correction retains one schema, five principles, five responsibilities, and
the existing Baton/Sworn ownership seam. It does not add provider drivers,
scheduling, retries, leases, events, a second lifecycle, or another universal
role manual.

No corrected completion claim is valid until the expanded suite is green on a
new immutable head and that head receives fresh independent review.

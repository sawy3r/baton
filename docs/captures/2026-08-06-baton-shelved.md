# Baton shelved — 2026-08-06

## Status

**Baton is parked as a separately published protocol.** It is not abandoned and
it is not deleted. Its ideas move into Sworn; its repository becomes a reference
archive.

Last release: `v1.0.0-rc.15.3` (tagged). Five tags are pushed with no GitHub
release — `rc.14`, `rc.15`, `rc.15.1`, `rc.15.2`, `rc.15.3`. The last published
release is `rc.13`. **None of the unpublished tags should now be published.**

## Why

A protocol with one implementation, authored by that implementation's author, is
a specification of that implementation. The published apparatus — conformance
profiles, immutable release identities, byte-exact payload digests, word
budgets, a second website — served interop between implementations that do not
exist. It consumed the majority of the effort and none of it was sellable.

Two further facts settled it:

1. **Claude Code dynamic workflows now supply the orchestration layer**, as do
   several open-source orchestrators. Competing there is competing on their
   ground.
2. **Workflows have no durable state.** Intermediate results live in script
   variables and resume works only within one session. The durable, Git-bound
   evidence layer is the actual gap — and that is Baton's contribution, which is
   better delivered inside Sworn than as a specification Sworn conforms to.

The full reasoning is in
[`2026-08-05-baton-pre-sworn-lessons.md`](./2026-08-05-baton-pre-sworn-lessons.md),
which remains the most valuable document in this repository.

## What moves into Sworn

The trust rules, unchanged in substance:

- the five principles;
- role separation, and that no builder certifies its own work;
- a fresh Verifier thread, read-only on every invocation;
- merge only the exact candidate covered by `PASS`;
- operational failure produces no verdict;
- direct-repair continuation and the bounded exact-head refresh;
- a normal target advance does not restart approved work; and
- **the compact Git-bound receipts**, which are the likely commercial wedge —
  see `sworn-internal/docs/strategy/2026-08-06-custody-evidence-commercial-thesis.md`.

None of these stop being true because they live in Sworn's code rather than in a
document Sworn conforms to. The document simply stops needing maintenance.

## What is retired

The separate brand, repository as a live product, release cadence, published
specification, conformance suite, schema endpoints as public API,
`baton.sawy3r.net`, and the release apparatus — immutable tags, byte-exact
payloads, generated-payload digests, and the overhead word budgets.

The word budgets deserve a specific note: two of them were ratchets set exactly
at the current measurement, and they demonstrably cost semantic content. RC15.3
deleted roughly as many words of RC15's planning semantics as it added for its
new feature, including "never repository facts" — the release's own headline
behaviour. **Do not carry that mechanism into Sworn.** Guard against regression
with the ratio-to-v0.16 measure, which has 7.5x headroom, and report the rest.

## Before the site goes

`schemas/receipt-v1.json` declares
`$id: https://baton.sawy3r.net/schemas/receipt-v1.json`, and any receipt already
written references it. **Keep `/schemas/*` serving those exact bytes** even after
the marketing site is retired. That is a redirect rule, not a project.

`baton-web` was never updated past RC13 and should not be. The alignment work
scoped on 2026-08-05 is void.

## Open work, deliberately not done

`fix/touchpoint-slice-ordering` is pushed and unmerged. It corrects a real defect
in the RC15.3 touchpoint matrix — the ordering test compared each track's first
slice rather than the slices that actually share the path, so declaring the
optional matrix could reject an otherwise valid plan. It carries a
mutation-proven regression test and no release ceremony.

**Merge it if the validator migrates to Sworn.** The fix and its test are worth
keeping regardless of what happens to this repository. Do not cut a release
for it.

## What this repository is now

A reference archive. `docs/captures/` is the asset — particularly the pre-Sworn
lessons review, the streamlining review, and the contract-edge findings, which
diagnosed a failure class that later reappeared in getfired.au and was diagnosed
there independently before anyone remembered it had been solved once already.

Archive it on GitHub rather than deleting it. Archiving costs nothing and
protects against a decision made on a tired evening.

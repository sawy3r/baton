# Baton B4 publication and local cutover scope

Date: 2026-07-24
Status: queued; blocked on B4 integrated conformance and dogfood
Stage: B4 / RC2 R9
Baton integration branch: `release/v1.0.0`
Baton track branch: `track/v1.0.0/B4-publication-cutover`
Website base: `baton-web` `origin/main`
Authority: [execution charter](./2026-07-24-baton-rc2-sworn-coach-parity-execution-charter.md)

## Objective

Publish one coherent, plain-language RC2 product surface; perform a
transactional real-machine Claude Code and Codex cutover; and create an
immutable prerelease that Sworn can safely pin.

Publication starts only from the exact B4/R8 release head whose integrated
dogfood and measurements passed.

## Repository documentation

The publication track updates:

```text
README.md
INSTALL.md
baton/README.md
CONTRIBUTING.md
ROADMAP.md
RELEASING.md
conformance/README.md
schemas/README.md
examples/
.github/workflows/conformance.yml
docs/releases/v1.0.0-rc.2.md
docs/captures/2026-07-24-baton-b4-publication-cutover-*
```

Public writing begins with the simple flow:

```text
approved Plan
  -> Implementer design
  -> Captain
  -> Implementer build and proof
  -> fresh Verifier
  -> exact Merge
```

It then explains parallel tracks, one serial worker in each track, track
composition, fresh assembly verification, and release Merge. It uses five
principles, five responsibilities, one status schema, four handoffs, five
operations, and one thin board. It distinguishes Baton durable facts from Sworn
runtime orchestration.

The docs contain:

- Claude Code and Codex user/project quick starts;
- dry-run, migration, rollback, uninstall, and failure behavior;
- slash/skill invocation and board usage;
- guided versus autonomous assurance;
- the common role-independent driver seam and per-role model selection;
- no managed-inference or bundled-model claim; and
- measured RC2 overhead and conformance results.

RC1 release notes, old captures, and `docs/history/v0-protocol.md` remain
unchanged. Current examples are replaced with one coherent RC2 walkthrough
covering plan, design, proof, work status, composition, assembly, and Merge.

## Continuous integration

One dependency-light workflow uses full Git history and runs:

- Node 22 and 24;
- Python 3.12 with `conformance/requirements.txt`;
- shell syntax checks for both installer launchers;
- every B1-B4 unit, integration, security, install, dogfood, and release test;
- deterministic regeneration and digest parity;
- the v0.16 overhead comparison;
- the board performance budget; and
- a clean-tree assertion after generators and tests.

Install tests use isolated temporary homes. CI never reads or mutates a real
agent configuration and never uses live provider credentials.

## Website rewrite

The website track branches from the current canonical `baton-web`
`origin/main`, not the stale local branch. It retains the Astro static shell,
brand system, drafting-grid visual language, responsive behavior, favicons,
robots, and sitemap.

Navigation becomes:

```text
Get started | How it works | Board | Docs | GitHub
```

The home page presents:

1. “Done is a claim. Make it checkable.”
2. one casual definition of Baton;
3. the five-responsibility Baton line;
4. tracks branching and rejoining for assembly verification;
5. Claude Code and Codex install commands;
6. five plain-language principles;
7. JSON, terminal, and local-WebUI board views;
8. Baton versus Sworn; and
9. exact current release/conformance status.

The site:

- rewrites every RC1 primary page rather than patching isolated claims;
- adds the byte-identical current `work-status-v1.json`;
- preserves every previously published schema URL as a labelled archive;
- treats `baton.board/v1` as a projection contract, not another schema;
- removes unused React/shadcn code and dependencies;
- adds a static branching Baton-line component and board documentation;
- checks stale terminology, internal links, sitemap coverage, tag links, and
  schema digest parity;
- links normative content to the immutable tag after publication; and
- makes no Sworn capability claim that Sworn has not yet passed.

Website acceptance includes clean install/build, desktop/mobile visual review,
keyboard focus, reduced motion, internal links, production HTML, sitemap,
current and archived schema endpoints, and deployed version.

## Real-machine cutover

The frozen package is first exercised with both user-scope `--dry-run`
commands. Complete managed-tree hashes must remain unchanged.

Claude cutover recognizes only the exact audited v0.16 installation:

- eight known Baton commands;
- the exact 79-file support package;
- the exact legacy global Baton block; and
- preserved unrelated commands and the untouched instruction prefix.

Any fingerprint mismatch stops before mutation.

The cutover then:

1. snapshots known managed paths and unrelated-file/prefix hashes;
2. installs Claude with explicit noninteractive confirmation;
3. verifies the full recoverable legacy archive and unrelated preservation;
4. installs Codex with explicit noninteractive confirmation;
5. code-validates both `baton.install/v1` manifests;
6. proves exactly five skills per host and identical support-package digest;
7. proves RC2 operation/version/digest identity;
8. proves only recognized legacy files/block were retired;
9. repeats install and dry-run to prove a true no-op; and
10. runs one read-only, no-persistence discovery smoke per CLI in a temporary
    Git repository.

No permanent global `CLAUDE.md` or `AGENTS.md` block is installed. Credential
files are neither needed nor read for installation smoke. Captures record
digests and transaction/archive identities, never configuration contents.

## Publication sequence

1. Commit publication/docs/examples/CI and website changes on isolated tracks.
2. Compose them and rerun all release and website gates.
3. Perform dry-run and real global cutover from the exact frozen package.
4. Open or update `release/v1.0.0 -> main` and require CI plus adversarial
   review.
5. Stop for the external merge authority if branch protection requires it.
6. After merge, rerun all gates on the exact resulting `main` commit.
7. Prove the source/package tree matches the tested release candidate.
8. Create annotated tag `v1.0.0-rc.2` on that exact `main` commit.
9. Publish a GitHub prerelease from the committed RC2 release note.
10. Verify the public website and immutable schema/tag links.
11. Record the exact immutable Baton object that Sworn may pin.

The tag is never moved. A failure after merge but before tagging blocks the
release; it does not produce a best-effort tag.

## Exit gate

B4 exits only when:

- repository and website documentation match delivered RC2 behavior;
- CI and adversarial review pass on the exact publication candidate;
- both global installations and rediscovery smokes pass;
- the release PR is merged;
- `v1.0.0-rc.2` and its GitHub prerelease identify the exact tested main
  commit;
- production site/schema/version checks pass; and
- the immutable Baton pin is recorded for Sworn.

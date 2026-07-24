# Baton RC2 plain-language amendment

## Why

The compact ASCII delivery line that originally opened Baton's README made the
protocol understandable at a glance. The RC2 README reduced it to a list, and
the public site still explains too much of the machinery before the idea is
clear.

## Approved scope

- Restore a compact README diagram derived from the May 2026 Baton diagram.
- Show the current five responsibilities without reviving the old numbered
  rules or command-heavy lifecycle.
- Keep the Captain review loop, clean Verifier boundary, repair loop, and exact
  Merge visible.
- Rewrite Baton website copy in direct, conversational language while keeping
  the protocol repository authoritative.
- Make agent-led self-install the primary route, with the reviewed shell
  installers as the explicit manual option.
- Preserve exact release, test, schema, installer, and Sworn-status claims.
- Do not change protocol behavior, package bytes, schemas, or the site's
  established visual system.

## Acceptance

- A casual reader can explain Baton after the README opening or homepage hero.
- Public overview pages lead with the problem and the delivery loop, not record
  internals.
- Technical detail remains available in the documentation where it is useful.
- README, site workflow, and Baton RC2 normative documents agree.
- Repository and site validation remain green.

## Authority and safety

The user requested this release amendment after the RC2 protocol PR had merged
to `main`. It may clarify the README, installation path, release note, and
public site; it may not change protocol behavior or claim that Sworn has passed
the autonomous-engine profile.

The agent-led prompt must pin the immutable RC2 tag, preview the reviewed
installer before applying it, avoid provider credentials and unrelated
software, and permit only the installer's exact audited Claude v0.16
instruction-file migration. Publication must stop until the tag and GitHub
prerelease exist.

## Repositories and exact starting refs

- Baton repository: `sawy3r/baton`
- Baton branch: `docs/restore-readme-flow`
- Baton starting commit: `ebf3b1bce624b3ac514dad9442b022ad57908c18`
- Baton target: `main` at the same commit when this amendment began
- Website repository: `sawy3r/baton-web`
- Website branch: `release/v1.0.0-rc.2`
- Website starting commit:
  `bcd4677d41db5ab61c29b982860417cd9e6ef740`
- Website target: `main`

## Implemented behavior

- Restored the compact Planner → Implementer → fresh Verifier → Merge diagram,
  with Captain review and repair routes visible.
- Rewrote the README opening around five jobs, five principles, four kinds of
  handoff, the read-only board, and fresh verification.
- Made the agent-led install prompt the first route in `README.md` and
  `INSTALL.md`; retained complete Claude Code and Codex command pairs as the
  manual route.
- Added the install route to the RC2 release notes.
- Reworked the public site in the existing visual system, keeping protocol
  detail on dedicated pages and making the self-install prompt primary.
- Kept site board, terminal, status, and schema fixtures byte-identical to the
  reviewed RC2 sources.

## Evidence

The Baton amendment is commit
`05d97aca04d07c85bd71b0e2960317fd2d14157c`. On that candidate:

- `.venv/bin/python conformance/check.py` passed 7 strict JSON cases, the
  Draft 2020-12 schema, 2 positive status fixtures, and 6 negative fixtures.
- The complete `node --test` portable command passed 132 of 132 tests,
  including the three-track real-Git lifecycle.
- `node scripts/generate-adapters.mjs --check` confirmed 10 adapters from 5
  operations and unchanged package digest
  `sha256:676c630c6a4ef3f752d604efaa5e51958adec0d8580b74cec7fb1e689b1d3436`.
- `node scripts/measure-overhead.mjs --check` passed all 9 budgets at 2.6539%
  of the v0.16 fixed-word baseline.
- `sh -n` passed both installer launchers and `git diff --check` passed.
- Independent review passed the diagram, terminology, install safety, release
  note, and this outcome capture.

The website candidate is commit
`fb13c781fe1dbb610dd5cfa77f1bd220dbdf2130`:

- `npm run build` produced all 12 static routes.
- The built-site audit checked 258 internal links with 0 missing and all 12
  route URLs in the sitemap.
- The current schema remained byte-identical at
  `sha256:70219641e954afefa35fe20cf702eeabac3ce7c9290d09d5ce29082bf4a497c1`.
- Board and terminal fixtures remained byte-identical at `c473182f…` and
  `c0756abc…`; the status example was unchanged.
- All 12 routes at 375 × 812 had meaningful content, no page overflow, and no
  blocking overlay. Desktop and mobile homepage screenshots were inspected;
  their SHA-256 prefixes are `c52df30e…` and `c8365e05…`.
- Axe WCAG 2 A/AA reported 0 violations on the homepage, How it works, and Get
  started. The normal background-gradient contrast checks remained
  indeterminate rather than violations.
- Independent review passed the exact committed head.

The reviews found and closed real defects before promotion: an unsafe mixed
host command pair, an over-broad instruction-file ban that contradicted the
audited migration, several protocol wording drifts, and low-contrast host
labels inside highlighted shell blocks.

## Risks and handoff

- Until `v1.0.0-rc.2` is an annotated remote tag with a GitHub prerelease, the
  pinned clone and source links intentionally do not resolve. The website must
  not publish first.
- The Claude v0.16 migration is narrow and audited. Generic instruction-file
  editing remains forbidden.
- The site is an explanation of Baton, not a second authority. Future Sworn
  capability claims require evidence from the Sworn binary.
- After the Baton amendment merges and is tagged, push the reviewed website
  candidate, merge it through its existing PR, and verify
  `https://baton.sawy3r.net`.

## Status and promotion decision

Status: **candidate evidence PASS** in both repositories.

Promotion decision:

- Baton amendment: **READY FOR PR AND MERGE**.
- Baton tag and GitHub prerelease: **HOLD** until the amendment reaches exact
  `main` and every release gate passes there.
- Website merge and deployment: **HOLD** until that immutable tag and
  prerelease exist. Only then may the site publish links to them.

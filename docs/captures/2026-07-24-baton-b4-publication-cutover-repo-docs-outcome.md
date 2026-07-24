# Baton B4 publication cutover repository outcome

Date: 2026-07-24
Status: PASS; ready for composition and final install audit
Stage: B4 / RC2 R9 repository slice
Source release head: `d8c907ea696f901cacb67122b0911b82813ad803`
Track branch: `track/v1.0.0/R9-repo-docs`
Authority: [publication scope](./2026-07-24-baton-b4-publication-cutover-scope.md)

## Outcome

The repository now presents one coherent RC2 product:

- README, protocol index, contribution, roadmap, and release guidance describe
  Baton as the small protocol and portable kit, with Sworn as the reference
  engine;
- `INSTALL.md` covers Claude Code and Codex user/project installation,
  invocation, the read-only board, dry-run, exact migration, rollback,
  uninstall, recovery, and failure behavior;
- public language consistently uses five principles, five responsibilities,
  four durable handoffs, five operations, one status schema, and one thin
  board;
- guided and autonomous assurance, the common role-independent driver,
  explicit per-invocation model choice, and the absence of managed inference
  are stated without making a Sworn conformance claim;
- the disconnected RC1 examples are superseded by one internally bound,
  platform-agnostic two-track walkthrough through composition, assembly
  verification, and exact release Merge;
- the dependency-light GitHub workflow runs the full profile with full history,
  Python 3.12, and Node 22/24; and
- the RC2 release note reports the delivered portable evidence and the
  autonomous `NOT RUN` boundary.

Normative documents, the RC1 release note, old captures, and v0 history were not
rewritten.

## Final package identity

Updating installed `baton/README.md` changes the support-package bytes. Generated
Claude Code and Codex packages remain identical at:

```text
version: 1.0.0-rc.2
digest:  sha256:6be0e7548087df663fd27316f9c8a197cfa116a2dc29fcfc17dafe0f9ef36dd7
```

The earlier B4 dogfood capture remains truthful evidence for its pre-publication
`sha256:eccd974741429df0bc82d5ba95e4d09cdb54af8ec47a7eb6a2b8a05b44df032d`
package. Publication and real-machine install qualification must use the final
R9 digest above.

## Evidence

```text
python3 conformance/check.py
  PASS: 7 strict JSON cases, 1 schema,
        2 positive status fixtures, 6 negative fixtures

node --test test/records/*.test.mjs test/operations/*.test.mjs \
  test/adapters/*.test.mjs test/install/*.test.mjs \
  test/board/*.test.mjs test/driver/*.test.mjs \
  test/dogfood/*.test.mjs test/release/*.test.mjs
  PASS: 132/132 on Node v24.14.0

node scripts/generate-adapters.mjs --check
  PASS: 10 adapters, 5 operations
  package sha256:6be0e7548087df663fd27316f9c8a197cfa116a2dc29fcfc17dafe0f9ef36dd7

node scripts/measure-overhead.mjs --check
  PASS: all 9 deterministic budgets

walkthrough strict Plan/status and raw handoff digest check
  PASS: plan sha256:8649847c7cf51a21dedc3daab721c805703f5affa380008d233a9ab7637c752d
        3 strict statuses and exact approval/design/proof digests

public Markdown local-link check
  PASS: 10 entry documents

all repository JSON parse
sh -n install-claude.sh
sh -n install-codex.sh
git diff --check
  PASS
```

Local Python was 3.12.3. The committed workflow supplies the required Node 22
and 24 matrix and Python 3.12 environment.

## Remaining publication boundary

This slice does not claim a global installation, final real-machine cutover,
release-branch composition, merge to `main`, tag, GitHub prerelease, website
deployment, or Sworn pin. The next qualification must rerun dry-run, install,
manifest, no-op, rollback/recovery, and rediscovery checks against the exact
final package digest before publication.

# Baton B2 operations and installation scope

Date: 2026-07-24
Status: implemented; awaiting composition and independent verification
Stage: B2 / RC2 R3-R4
Integration branch: `release/v1.0.0`
Track branch: `track/v1.0.0/B2-operations-install`
Authority: [execution charter](./2026-07-24-baton-rc2-sworn-coach-parity-execution-charter.md)

## Objective

Make Baton immediately usable through five concise canonical operations and
generated, digest-identical Agent Skills for Claude Code and Codex. Installers
must support clean user/project installs and safely migrate the live legacy
Claude v0.16 installation without touching unrelated configuration.

B2 begins only after B1's exact protocol, record, transition, and helper
contract is composed into `release/v1.0.0`.

## Included scope

```text
operations/
  baton-plan.md
  baton-implement.md
  baton-design-review.md
  baton-verify.md
  baton-merge.md
templates/
  plan.md
  design.md
  proof.md
adapters/generated/
  claude/skills/baton-*/SKILL.md
  codex/skills/baton-*/SKILL.md
  generated-manifest.json
legacy/v0.16.0/
  install-manifest.json
  claude-global-block.md
scripts/
  generate-adapters.mjs
  install.mjs
  lib/
install-claude.sh
install-codex.sh
test/operations/
test/adapters/
test/install/
```

Node built-ins own generation and installation. Shell wrappers resolve their
own source directory and execute the shared Node installer; they contain no
workflow or mutation logic.

## Canonical operation contract

The five files under `operations/` are the only authored workflow sources.
Each contains lightweight tool-neutral metadata and exactly these headings:

1. Purpose
2. Inputs
3. Authority
4. Actions
5. Required output
6. Stop conditions
7. Next handoff

Each operation is at most 400 words and all five total at most 2,000 words.
Exact UTF-8/LF/final-newline bytes are the operation identity.

Canonical operation text contains no provider, model, host, home directory,
memory product, host UI, positional shell argument, or duplicated rationale.

### Required behavior

- `baton-plan` covers new plans and authorized replans. It writes the strict
  byte-zero plan metadata and concise Markdown, binds external approval, creates
  baseline statuses, and never approves its own proposal.
- `baton-implement` follows authoritative status. It either writes/revises
  design and stops for Captain, or—after current `PROCEED` or Verifier
  `FAIL`—builds the candidate and proof and stops for Verifier.
- `baton-design-review` is a distinct invocation and records exactly
  `PROCEED`, `REVISE`, or `ESCALATE` against current plan/design bytes.
- `baton-verify` has explicit `work` and `assembly` scopes, requires fresh
  read-only context, and records only `PASS`, `FAIL`, or `BLOCKED`. Operational
  failure records no verdict.
- `baton-merge` has explicit `track`, `assembly`, and `release` scopes and is
  deterministic. Track scope composes and collectively transfers one frozen
  track. Assembly scope mechanically records the exact assembled candidate,
  components, proof, and initial Verifier handoff in one record-only
  compare-and-set after every track transfer. Release scope integrates only the
  assembly candidate covered by PASS. Every scope refuses conflict, stale
  heads, changed candidates, absent prerequisites, moved targets, or unexpected
  topology without partial success.

There is no `mark-shipped` v1 operation. Deployment state is outside Baton
delivery.

## Templates

- `plan.md`: strict JSON metadata fence followed by goal, authority, scope,
  acceptance, ordered tracks/work, dependencies/touch surfaces, checks, and
  constraints.
- `design.md`: approach, surfaces, consequential decisions/risks, evidence plan,
  and revisions.
- `proof.md`: exact candidate/product binding, acceptance-to-evidence table,
  checks and raw evidence references, deviations, and not-delivered scope.

Templates remain concise and link raw output rather than copying logs.

## Generated Agent Skills

Claude Code and Codex both receive generated Agent Skills:

```text
Claude: /baton-plan, /baton-implement, /baton-design-review,
        /baton-verify, /baton-merge

Codex:  $baton-plan, $baton-implement, $baton-design-review,
        $baton-verify, $baton-merge
```

Each generated adapter contains only:

- valid host frontmatter and a concise trigger;
- package version, operation version, and raw SHA-256 marker;
- a host-specific free-form argument/package-root bridge; and
- one delimited canonical region byte-equal to its operation source.

The generator uses an explicit allowlist of five operations. Globs never decide
ownership. Generation is deterministic, checked-in bytes must match
regeneration, and a manifest records adapter and canonical digests.

No new legacy `.claude/commands` files are produced. Claude Skills remain
slash-invokable while sharing the same Agent Skills architecture as Codex.

## Install targets

```text
Claude user:
  ${CLAUDE_CONFIG_DIR:-~/.claude}/skills/baton-*/SKILL.md
  ${CLAUDE_CONFIG_DIR:-~/.claude}/baton/

Claude project:
  <repo>/.claude/skills/baton-*/SKILL.md
  <repo>/.claude/baton/

Codex user:
  ${AGENTS_HOME:-~/.agents}/skills/baton-*/SKILL.md
  ${CODEX_HOME:-~/.codex}/baton/

Codex project:
  <repo>/.agents/skills/baton-*/SKILL.md
  <repo>/.codex/baton/
```

Support package bytes are identical across hosts. Host roots remain separately
owned so install, rollback, and uninstall need no cross-host reference count.

No permanent global `CLAUDE.md` or `AGENTS.md` block is installed. Skill
discovery provides on-demand availability without fixed prompt tax.

Scope is mandatory:

```text
./install-claude.sh --user|--project [PATH] [--dry-run] [-y|--yes]
./install-codex.sh  --user|--project [PATH] [--dry-run] [-y|--yes]
... --uninstall
... --rollback latest|<transaction-id>
```

Non-TTY mutation without `--yes` fails. Project scope resolves a real Git root.
Home itself, `/`, escaping paths, unsafe ownership, and symlinked target
components fail closed.

## Manifest and transaction rules

Each host/scope support root contains one code-validated
`baton.install/v1` manifest with:

- host, scope, package version/digest, and generator version;
- canonical support/launcher roots;
- every owned relative file, mode, digest, operation, and operation digest;
- any exact owned instruction block; and
- directories created by Baton.

Update and uninstall verify current owned hashes. Modified owned files and
unowned collisions block before mutation.

Mutation flow:

1. resolve and validate paths and prior manifest;
2. render the entire desired install into a private sibling staging directory;
3. compute the same complete action list used by dry-run;
4. store exact preimages and a `prepared` journal outside the package;
5. replace package/launchers atomically where possible;
6. apply instruction-file compare-and-set last;
7. write the new manifest last and mark the transaction committed; and
8. restore exact preimages after any interrupted or failed transaction.

Same version and package digest is a true no-op. Backups persist until explicit
pruning. Rollback and uninstall refuse to discard modified managed content.

## Legacy Claude v0.16 migration

The live recognized legacy state is:

- eight exact v0.16 commands: `plan-release`, `replan-release`,
  `implement-slice`, `design-review`, `verify-slice`, `merge-track`,
  `merge-release`, and `mark-shipped`;
- 79 files under `~/.claude/baton`, including 17 recoverable historical extras;
  and
- one exact Baton block from line 5 through EOF in `~/.claude/CLAUDE.md`, raw
  SHA-256
  `bfa1fbe8bb01436f585a94067fa9e0131efea75e6f5d59c2e1440527e88d8484`.

The untouched four-line CLAUDE prefix is preserved byte-for-byte. `pr.md`,
`review-tldr.md`, and every other command remain untouched.

The implementation stores exact legacy hashes in
`legacy/v0.16.0/install-manifest.json`. It archives the complete legacy package
and recognized files before replacement. Any one-byte fingerprint difference
stops with zero mutation; no heading, glob, or fuzzy-content deletion is
allowed.

Mapping:

```text
plan-release + replan-release -> baton-plan
implement-slice               -> baton-implement
design-review                 -> baton-design-review
verify-slice                  -> baton-verify
merge-track + merge-release   -> baton-merge
mark-shipped                  -> retired
```

## Acceptance criteria

### Operations and generation

- exactly five canonical operations and three templates;
- heading order and word budgets pass;
- forbidden host/provider/model assumptions are absent;
- transition and handoff wording agrees with B1;
- two generations are byte-identical;
- extracted adapter canonical regions equal operation bytes;
- Claude and Codex package/operation digests match; and
- launchers contain no copied workflow outside the canonical region.

### Isolated install matrix

- clean Claude and Codex user/project installs;
- dry-run leaves complete tree hashes unchanged;
- noninteractive mutation requires `--yes`;
- reinstall is a manifest-stable no-op;
- exact legacy Claude upgrade preserves unrelated files and is fully
  rollbackable;
- one-byte legacy command/block change fails with zero mutation;
- modified-owned and unowned-collision cases fail with zero mutation;
- symlink, root-escape, unsafe-root, and wrong-owner cases fail;
- injected interruption after every transaction boundary recovers;
- rollback restores exact pre-install bytes including legacy extras/block;
- uninstall removes only exact manifest ownership;
- project host installs coexist and uninstall independently; and
- every installed launcher resolves its recorded operation version/digest.

## Explicit non-goals

- authored host-specific workflow copies;
- platform installers with independent logic;
- global fixed instruction blocks;
- provider/model defaults;
- inference or driver implementations;
- shell-string command construction;
- broad removal of legacy user configuration; or
- installation before B1 conformance passes.

## Handoff

B2 produces one exact operations/adapters/install commit and a concise outcome
capture containing word budgets, generation parity, isolated install evidence,
legacy migration/rollback evidence, and any deviation.

## Outcome

Implementation completed on `track/v1.0.0/B2-operations-install` from composed
B1 head `a5fcd746d2ce5e1f05d647da41fe5c2f5a22b6aa`. The implementation head before
this outcome-only update is `0a3f63aba7601ffd968744858c78802e497bf41f`.

### Delivered

- Five canonical operations bind only the composed B1 action facade and closed
  outcomes. Word counts are 309 plan, 315 implement, 268 design review, 295
  verify, and 317 merge: 1,504 total.
- Three strict, concise templates cover plan, design, and proof.
- Ten checked-in Agent Skills are generated from the five exact operation
  sources. Claude and Codex share package digest
  `sha256:3e395c876604fc51e586f8c13ea6df9dfd753e633575e30a318a3c5433d1c3af`.
- One Node-builtins installer and two source-relative shell delegates cover
  Claude and Codex user/project scope, dry-run, interactive/noninteractive
  confirmation, manifest-stable no-op, uninstall, rollback, durable recovery,
  ownership, collision, path, symlink, and Git-environment safeguards.
- The legacy identity freezes eight commands, 79 package files with modes, and
  the 15,561-byte global block at raw digest
  `bfa1fbe8bb01436f585a94067fa9e0131efea75e6f5d59c2e1440527e88d8484`.
  Exact migration archives all recognized preimages, preserves the four-line
  prefix and unrelated commands, and is fully rollbackable.

### Evidence

- `node --test`: 88 tests passed, including the composed B1 suite and 19 B2
  operation, generation, install, migration, tamper, coexistence, and
  interruption cases.
- `python3 conformance/check.py`: PASS for seven strict-JSON cases, one schema,
  two positive statuses, and six negative statuses.
- `node scripts/generate-adapters.mjs --check`: ten adapters checked for five
  operations at the package digest above; two isolated generations were
  byte-identical.
- Agent Skills `quick_validate.py`: all ten generated Skill directories valid.
- `bash -n install-claude.sh install-codex.sh` and `git diff --check`: pass.
- An isolated clone of the live recognized Claude v0.16 footprint migrated,
  retained unrelated `pr.md`, reduced `CLAUDE.md` to its exact 222-byte prefix,
  and restored all 79 package files, eight commands, and the full instruction
  file on rollback.

### Divergence and residual risk

No planned behavior was deferred and no v0.16 command or `mark-shipped`
workflow was revived. Transaction backups intentionally persist until explicit
future pruning, as required. Independent verification and release composition
remain the next authority boundaries; this outcome does not self-certify them.

### Independent release review correction

Independent review reproduced and corrected two pre-composition edge cases at
code head `22adc0e8818465cb5399f27ae32bd5581af41f68`:

- a normal Claude `CLAUDE.md` shorter than the historical four-line v0.16
  prefix is now treated as unrelated configuration and remains byte-identical
  through a clean install; and
- any pre-existing file or directory inside a managed `baton-*` Skill root now
  blocks before mutation even when `SKILL.md` itself is absent.

The correction adds exact regression coverage. The complete `node --test`
suite passes 88/88, the Python conformance check passes, adapter regeneration
matches checked-in bytes, both shell delegates pass syntax validation, and
`git diff --check` is clean.

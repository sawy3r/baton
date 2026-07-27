# Install Baton

Baton installs the same protocol, five operations, compact receipt/state/action
kit, and read-only terminal and browser board for Claude Code or Codex. It does
not install Sworn, a driver, a model, provider credentials, or a background
service.

## Before you install

Use an exact reviewed Baton tag. Run the installer from that checkout and
preview every action before approving it. The installers require Node.js 22 or
24, Git, and a supported Linux or macOS user environment.

Do not edit agent instruction files to install Baton. The only supported
instruction-file mutation is the exact audited Claude v0.16 migration described
below.

## Ask your agent to install it

The easiest route is to paste this into Claude Code or Codex:

```text
Install Baton v1.0.0-rc.5 for me.

Clone the exact v1.0.0-rc.5 tag from https://github.com/sawy3r/baton.git,
read its INSTALL.md, and use the installer that matches this tool. Show me the
user-scope dry-run first and wait for my approval before applying it. Do not
edit my instruction files or install Sworn.
```

The agent should stop after the dry-run. Approving that preview authorises the
matching `--yes` install; it does not authorise unrelated changes.

## Install it yourself

### Claude Code

Preview and install at user scope:

```sh
./install-claude.sh --user --dry-run
./install-claude.sh --user --yes
```

Or install into the current Git project:

```sh
./install-claude.sh --project --dry-run
./install-claude.sh --project --yes
```

The default user paths are:

```text
~/.claude/skills/baton-*/
~/.claude/baton/
~/.claude/.baton-install/
```

Project scope uses:

```text
.claude/skills/baton-*/
.claude/baton/
.claude/.baton-install/
```

### Codex

Preview and install at user scope:

```sh
./install-codex.sh --user --dry-run
./install-codex.sh --user --yes
```

Or install into the current Git project:

```sh
./install-codex.sh --project --dry-run
./install-codex.sh --project --yes
```

The default user paths are:

```text
~/.agents/skills/baton-*/
~/.codex/baton/
~/.codex/.baton-install/
```

Project scope uses:

```text
.agents/skills/baton-*/
.codex/baton/
.codex/.baton-install/
```

Commit a project install only when the repository intentionally vendors the
generated package. Baton does not edit `.gitignore`.

## Use the operations

Both tools expose the same operations:

```text
baton-plan
baton-implement
baton-design-review
baton-verify
baton-merge
```

Free-form text supplies their inputs. Project packages take precedence over
user packages. Invoking `baton-plan` can propose a plan but cannot approve it.

The ordinary guided sequence is:

1. `baton-plan` proposes the applicable plan revision for external approval.
2. The engine prepares the exact current consumed `PASS` authorities, then
   `baton-implement` returns one eligible slice’s design TL;DR and stops.
3. `baton-design-review` returns the distinct Captain decision.
4. After `PROCEED`, the engine prepares those current authorities again, then
   `baton-implement` builds the candidate, runs required checks, and returns
   observable evidence.
5. A fresh, read-only `baton-verify` returns `PASS`, `FAIL`, or `BLOCKED`.
6. `baton-merge` composes passed tracks, obtains fresh whole-product
   verification, and integrates only the exact candidate covered by `PASS`.

The surrounding tool or engine writes compact receipts for those boundaries.
The role does not hand-author lifecycle records. A runtime failure produces no
Baton verdict and may be retried without a new plan or slice identity.

## Use the board

The reference board reads the repository’s committed plan, receipts, and Git
facts. JSON, terminal, and WebUI views share one read-only projection and
cannot advance delivery.

```sh
node reference/board/oracle.mjs /path/to/repository

node reference/board/oracle.mjs /path/to/repository \
  | node reference/board/terminal.mjs

node reference/board/web.mjs /path/to/repository
```

The WebUI listens on loopback, defaults to `http://127.0.0.1:4177`, and accepts
GET only.

## Repeat, upgrade, rollback, and uninstall

Every install owns an exact manifest. Repeating the same install is a no-op.
RC5 directly upgrades exact, unmodified RC2, RC3, or RC4 installs. An upgrade
replaces only bytes owned by the previous Baton manifest and stops on a
collision, modified managed file, symlink, unsupported layout, or changed
instruction block.

Preview rollback or uninstall before applying it:

```sh
./install-claude.sh --user --rollback latest --dry-run
./install-claude.sh --user --rollback latest --yes
./install-claude.sh --user --uninstall --dry-run
./install-claude.sh --user --uninstall --yes

./install-codex.sh --user --rollback latest --dry-run
./install-codex.sh --user --rollback latest --yes
./install-codex.sh --user --uninstall --dry-run
./install-codex.sh --user --uninstall --yes
```

Use the matching `--project` scope for project installs. Rollback restores the
last complete manifest snapshot. Uninstall removes only current Baton-owned
paths.

## Exact Claude v0.16 migration

The Claude user installer recognizes one audited Baton v0.16 installation:
the known support package, eight legacy commands, and the exact trailing
instruction block. A dry-run shows the migration. With `--yes`, the installer
archives the owned bytes, removes only those known files and block, and installs
the new package transactionally.

Any modified, missing, additional, symlinked, or differently placed managed
byte makes that migration ineligible. The installer stops without guessing and
does not touch unrelated commands or earlier instruction text.

Codex has no implicit legacy migration.

## Failure and recovery

Install mutations use a transaction journal and staged replacement. An
interruption before commit leaves the prior installation authoritative; an
interruption after an effect is reconciled from the journal and manifests on
the next run. A mixed or ambiguous state is reported without deleting user
data.

Installer recovery is separate from delivery recovery. During delivery,
Sworn or another engine owns scheduling, retries, worktrees, receipt
persistence, projections, and effect reconciliation. Baton operations never
turn a runner or bookkeeping failure into approval, `PROCEED`, `PASS`, or
`MERGED`.

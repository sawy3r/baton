# Install Baton RC3

Baton installs the same protocol, records, operations, and local board for
Claude Code and Codex. The host-specific files are thin Skills around identical
canonical operation bytes.

The installer does not contact a model provider, read credentials, or install a
model. A clean install does not add or change a global instruction file; the
exact Claude v0.16 migration removes only the audited legacy block described
below. The installer needs only:

- Git;
- Bash; and
- Node.js 22 or 24.

## Ask your agent to install it

This is the easiest route. Open Claude Code or Codex and paste:

```text
Install Baton v1.0.0-rc.3 for this coding agent. Clone
https://github.com/sawy3r/baton at that exact tag, read the root INSTALL.md,
and install it for this tool—Claude Code or Codex—at user scope. Run the
matching installer with --dry-run and show me the exact actions first. After I
approve, run the same scope with --yes. Do not edit instruction files directly;
only allow an instruction-file change made by the reviewed installer as part
of its exact audited v0.16 migration. Do not install Sworn or a model, or read
provider credentials. If this host is not supported, stop and tell me.
```

The prompt pins the reviewed release and makes the dry-run the approval point.
The ready-made RC3 installers support Claude Code and Codex. Baton itself is
platform-agnostic, but the agent should not invent an unreviewed host adapter.

## Install it yourself

Clone Baton at `v1.0.0-rc.3`, run the commands below from that checkout, and
preview every install before applying it.

## User install

A user install is available in every Git project unless that project has its
own Baton install.

### Claude Code

```sh
./install-claude.sh --user --dry-run
./install-claude.sh --user --yes
```

This writes the support package below
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/baton` and five launchers below the same
configuration directory’s `skills/`.

### Codex

```sh
./install-codex.sh --user --dry-run
./install-codex.sh --user --yes
```

This writes the support package below
`${CODEX_HOME:-$HOME/.codex}/baton` and five launchers below
`${AGENTS_HOME:-$HOME/.agents}/skills`.

## Project install

A project install is pinned inside one Git repository and wins over the user
install when a Skill resolves its package. Pass any path inside the intended
repository; the installer resolves the Git root.

### Claude Code

```sh
./install-claude.sh --project /path/to/repository --dry-run
./install-claude.sh --project /path/to/repository --yes
```

Managed files live in:

```text
.claude/baton/
.claude/skills/baton-*/
.claude/.baton-install/
```

### Codex

```sh
./install-codex.sh --project /path/to/repository --dry-run
./install-codex.sh --project /path/to/repository --yes
```

Managed files live in:

```text
.codex/baton/
.agents/skills/baton-*/
.codex/.baton-install/
```

Commit a project install only if your repository intentionally vendors these
generated files. Baton does not edit `.gitignore` for you.

## Use the operations

Each host exposes the same five operations:

```text
baton-plan
baton-implement
baton-design-review
baton-verify
baton-merge
```

In Claude Code, invoke a Skill as a slash command, for example:

```text
/baton-plan Plan release checkout-recovery in this repository.
```

In Codex, name the Skill in the request:

```text
$baton-plan Plan release checkout-recovery in this repository.
```

Free-form text supplies the operation inputs. The Skill resolves a valid
project package first, then the host’s user package. Planning still needs
external approval; invoking `baton-plan` cannot approve its own Plan.

The ordinary guided sequence is:

1. `baton-plan` writes and admits the externally approved Plan.
2. `baton-implement` writes one eligible work item’s design.
3. `baton-design-review` records the distinct Captain decision.
4. `baton-implement` builds the exact candidate and proof.
5. A fresh, read-only `baton-verify` invocation records PASS, FAIL, or BLOCKED.
6. `baton-merge` composes passed tracks, prepares assembly, and—after a fresh
   assembly PASS—integrates the release.

Independent tracks may advance together. Work inside one track stays serial.
The board shows the next eligible operation; it does not run it.

## Use the board

The JSON oracle reads local `refs/heads/release-wt/*` refs and their exact
records:

```sh
node reference/board/oracle.mjs /path/to/repository
```

Pipe that projection to the terminal renderer:

```sh
node reference/board/oracle.mjs /path/to/repository \
  | node reference/board/terminal.mjs
```

Or start the local WebUI:

```sh
node reference/board/web.mjs /path/to/repository
```

The server prints its loopback URL and defaults to
`http://127.0.0.1:4177`. It accepts GET only. An installed package has the same
programs below its support root; for example, the default Codex user paths are:

```sh
node "$HOME/.codex/baton/reference/board/oracle.mjs" /path/to/repository \
  | node "$HOME/.codex/baton/reference/board/terminal.mjs"
node "$HOME/.codex/baton/reference/board/web.mjs" /path/to/repository
```

JSON uses the projection contract `baton.board/v1`. It is deliberately not a
second lifecycle schema or an action API.

## Dry-run and confirmation

`--dry-run` prints the exact intended actions and does not mutate the target.
Without `--dry-run`, an interactive terminal asks for confirmation. Scripts and
other non-interactive callers must pass `--yes` or `-y`; otherwise installation
stops with `CONFIRMATION_REQUIRED`.

Examples:

```sh
./install-codex.sh --project . --dry-run
./install-codex.sh --project . --yes
```

Running the same installer again with identical managed bytes and manifest is a
true no-op.

## Exact Claude v0.16 migration

Only a Claude **user** install can migrate Baton v0.16. The installer recognizes
the exact audited v0.16 package: 79 known support files, eight known commands,
and the exact legacy block at the end of `CLAUDE.md`.

On an exact match, one transaction preserves preimages, installs RC3, removes
only those known legacy commands and block, and leaves unrelated commands and
the preceding instruction bytes unchanged. If any managed byte, path, or block
differs, installation stops with `LEGACY_FINGERPRINT_MISMATCH` before mutation.
The installer does not guess how to migrate a modified setup.

This moves the local host package; it does not reinterpret old Baton delivery
records as RC3 records.

## Roll back or uninstall

Every mutation records a private transaction and prints its ID. Preview and
restore the most recent committed transaction:

```sh
./install-claude.sh --user --rollback latest --dry-run
./install-claude.sh --user --rollback latest --yes
```

Or use the exact printed ID:

```sh
./install-codex.sh --project /path/to/repository \
  --rollback 20260724T120000000Z-12345-abcdef123456 --yes
```

Preview and remove only Baton-owned support files and launchers:

```sh
./install-codex.sh --user --uninstall --dry-run
./install-codex.sh --user --uninstall --yes
```

Rollback and uninstall first verify the managed manifest, file digests, and
absence of foreign content. They stop rather than delete a modified or unowned
file.

## Failure and recovery behavior

The installer fails closed. Common errors include:

- `PROJECT_NOT_GIT` — the project path is not in a Git repository;
- `UNSAFE_ROOT`, `UNSAFE_OWNERSHIP`, or `SYMLINK_COMPONENT` — the target cannot
  be changed safely;
- `UNOWNED_COLLISION` — Baton would overwrite content it does not own;
- `MODIFIED_OWNED_FILE` — an installed managed file no longer matches its
  manifest;
- `PACKAGE_MISMATCH` — checked-in generated bytes and package identity differ;
  and
- `ROLLBACK_NOT_FOUND` — the selected committed transaction does not exist.

Normal failures restore transaction preimages before returning. If the process
is interrupted after preparation, the next non-dry-run invocation restores the
prepared transaction before considering the new request. A dry-run reports the
pending recovery but does not perform it.

Never remove a managed directory to work around one of these errors. Inspect
the named path, preserve local content, then either restore the expected bytes
or choose a different install scope.

## Autonomous engines and models

Installing Baton does not install Sworn. Guided use can coordinate the five
responsibilities manually. Autonomous use needs an engine to enforce authority,
single-writer scheduling, fresh Verifier context, read-only verification,
credential isolation, cancellation, recovery, and exact effects.

Baton’s common process-driver seam can serve every responsibility. The engine
selects the driver and passes an explicit model string or deliberate `null` on
each invocation. Baton provides no default model, fallback chain, provider
lifecycle, managed inference, or bundled credentials.

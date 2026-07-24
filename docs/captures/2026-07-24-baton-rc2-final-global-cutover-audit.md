# Baton RC2 final global cutover audit

Date: 2026-07-24
Status: FAIL — installation PASS; final Claude discovery gate blocked by host authentication
Release branch: `release/v1.0.0`
Source head: `2d63d30917c095c7303bfd9d1316b282a0b79f51`
Package version: `1.0.0-rc.2`
Package digest: `sha256:676c630c6a4ef3f752d604efaa5e51958adec0d8580b74cec7fb1e689b1d3436`
Authority: explicit user approval for global Claude Code and Codex installation
Acceptance: [B4 publication and local cutover scope](./2026-07-24-baton-b4-publication-cutover-scope.md)

## Verdict

The real user-scope Claude Code and Codex installations completed
transactionally from the exact reviewed RC2 release head. Both manifests,
support trees, five-Skill launcher sets, package identity, operation identity,
legacy archive, unrelated-content preservation, repeated-install no-op, and
dry-run non-mutation checks pass.

Codex also discovered all five installed Baton Skills in an ephemeral,
read-only session without changing the temporary repository.

The final two-host discovery gate does not pass because Claude Code cannot
authenticate:

```text
Failed to authenticate: OAuth session expired and could not be refreshed
```

A sanitized status check reports:

```json
{
  "loggedIn": false,
  "authMethod": "none"
}
```

No authentication state was changed. The successful installations remain in
place and recoverable. This failure blocks release publication; it does not
invalidate the installed package.

## Frozen-source preflight

Commands:

```sh
git status --short --untracked-files=all
git rev-parse HEAD
node scripts/generate-adapters.mjs --check
```

Result:

```text
PASS clean source worktree
HEAD 2d63d30917c095c7303bfd9d1316b282a0b79f51
checked 10 adapters for 5 operations
package sha256:676c630c6a4ef3f752d604efaa5e51958adec0d8580b74cec7fb1e689b1d3436
```

The real Claude installation matched the exact audited v0.16 identity before
mutation:

```text
legacy state: exact
legacy support files: 79
legacy commands: 8
unrelated CLAUDE.md prefix:
  sha256:a69c7144b8166343080e10a3c0ce8d905a5f8fa25990bf9d277eee5176dbeacd
managed preimage:
  sha256:69544541a64b06a1f0e1578ba27b9c5a1a2549def6082a24fba7cafe6f40b9ee
unrelated Claude commands: 2
unrelated Claude commands fingerprint:
  sha256:9b0639565981f30bcc367d74c77a5460af38b9e7027aafafb38458c8ba516666
```

No configuration or instruction contents were printed or captured. Only
digests and counts were retained. No credential file was read by the
installation or audit commands.

## Dry-run qualification

Commands:

```sh
./install-claude.sh --user --dry-run
./install-codex.sh --user --dry-run
```

Results:

```text
Claude: Dry run 17 action(s)
  exact v0.16 archive and migration
  RC2 support replacement
  five Skill launchers
  eight exact legacy-command removals
  exact legacy CLAUDE.md block removal
  manifest written last

Codex: Dry run 7 action(s)
  RC2 support replacement
  five Skill launchers
  manifest written last
```

The complete managed preimage and all unrelated-content fingerprints were
unchanged after both dry-runs:

```text
PASS dry-run non-mutation
sha256:69544541a64b06a1f0e1578ba27b9c5a1a2549def6082a24fba7cafe6f40b9ee
```

## Applied cutover

Commands:

```sh
./install-claude.sh --user --yes
./install-codex.sh --user --yes
```

Results:

```text
Claude: Applied 17 action(s)
Transaction: 20260724T043737234Z-840328-bda6fbd09f96

Codex: Applied 7 action(s)
Transaction: 20260724T043743479Z-840496-bc3ea16ad4af
```

The strict read-only post-install audit imported the repository's canonical
path, manifest, digest, legacy, and transaction validators. It checked every
manifest-owned byte against the frozen source and independently inspected the
legacy preimages.

```text
PASS both baton.install/v1 manifests
PASS package version 1.0.0-rc.2
PASS package sha256:676c630c6a4ef3f752d604efaa5e51958adec0d8580b74cec7fb1e689b1d3436
PASS 31 owned files per host: 26 support files plus 5 Skills
PASS zero owned instruction blocks
PASS all source and installed support bytes match
PASS all five operation IDs, versions, canonical digests, and launchers
PASS no unowned content inside either managed tree
PASS no prepared transaction remains
```

Manifest byte identities are:

```text
Claude:
  sha256:88c6fa17b77dbeaf890f619667e2d32f651e659c8372bada6399aadbc597434f
Codex:
  sha256:14860b7424f827ed5e943081646f738eaff8ad4071a3aa0d23619b7aa1a3c515
```

The different manifest digests are expected because each manifest binds its
host-specific canonical roots and launcher bytes. Their support-package digest
is identical.

## Recovery and preservation

Claude transaction
`20260724T043737234Z-840328-bda6fbd09f96` is a committed
`migrate-v0.16-and-install` journal with 15 affected paths and ten existing
preimages. The transaction directory is mode `0700` and its journal is mode
`0600`.

Independent inspection proved that its preimages contain:

- the complete exact 79-file v0.16 support tree, including modes and digests;
- all eight exact legacy command files;
- the complete original `CLAUDE.md`;
- the exact audited legacy trailing block; and
- the unrelated four-line prefix whose digest remains
  `sha256:a69c7144b8166343080e10a3c0ce8d905a5f8fa25990bf9d277eee5176dbeacd`.

The live `CLAUDE.md` is byte-identical to that unrelated prefix. All eight
recognized legacy commands are absent. The two unrelated Claude commands remain
byte-identical:

```text
sha256:9b0639565981f30bcc367d74c77a5460af38b9e7027aafafb38458c8ba516666
```

The unrelated Claude and Codex Skill surfaces were empty before installation
and remain unchanged apart from the five Baton-owned Skill directories.

Codex transaction `20260724T043743479Z-840496-bc3ea16ad4af` is a committed
`install` journal over its six canonical affected roots.

An audit-only validator initially expected the Claude journal operation label
to be `install`. The journal correctly records
`migrate-v0.16-and-install`; the assertion was corrected and the complete audit
then passed. No filesystem mutation occurred during either validator run.

## No-op and non-mutation proof

The complete installed footprint, including transaction stores, was captured
after installation:

```text
sha256:5716fd03bab9c9e236591bff61ff713a9fa66b08a5b93a5cdb6c66a547f234ad
Claude transactions: 1
Codex transactions: 1
```

Commands:

```sh
./install-claude.sh --user --yes
./install-codex.sh --user --yes
./install-claude.sh --user --dry-run
./install-codex.sh --user --dry-run
```

All four returned:

```text
No changes: installed package and manifest already match.
```

The complete footprint remained
`sha256:5716fd03bab9c9e236591bff61ff713a9fa66b08a5b93a5cdb6c66a547f234ad`
and the transaction counts remained one per host.

## Read-only host discovery

A fresh empty temporary Git repository was used. It contained no project Baton
package or instruction files.

### Claude Code 2.1.208

Command:

```sh
claude -p \
  --no-session-persistence \
  --tools "" \
  --strict-mcp-config \
  --mcp-config '{"mcpServers":{}}' \
  --setting-sources user \
  "This is a read-only installation discovery smoke. Do not call tools, modify files, plan work, or quote configuration. Inspect only the Skill catalog supplied by Claude Code. Reply with exactly BATON_RC2_DISCOVERY_PASS if and only if these five Skills are all discoverable in this session: baton-plan, baton-implement, baton-design-review, baton-verify, baton-merge. Otherwise reply exactly BATON_RC2_DISCOVERY_FAIL."
```

Result:

```text
exit 1
Failed to authenticate: OAuth session expired and could not be refreshed
```

Sanitized follow-up:

```sh
claude auth status --json | jq '{loggedIn, authMethod}'
```

```json
{
  "loggedIn": false,
  "authMethod": "none"
}
```

The failure happened before Skill discovery.

### Codex CLI 0.145.0

Command:

```sh
codex exec \
  --ephemeral \
  --ignore-user-config \
  --ignore-rules \
  --sandbox read-only \
  -c memories.use_memories=false \
  -c memories.generate_memories=false \
  --color never \
  "This is a read-only installation discovery smoke. Do not run commands, modify files, plan work, or quote configuration. Inspect only the Skill catalog supplied by Codex. Reply with exactly BATON_RC2_DISCOVERY_PASS if and only if these five Skills are all discoverable in this session: baton-plan, baton-implement, baton-design-review, baton-verify, baton-merge. Otherwise reply exactly BATON_RC2_DISCOVERY_FAIL."
```

Result:

```text
approval: never
sandbox: read-only
BATON_RC2_DISCOVERY_PASS
```

After both invocations the temporary repository still had no worktree files,
Git refs, staged changes, or untracked files. It was then moved to the system
trash.

## Exact blocker and recovery

The remaining external action is:

```sh
claude auth login
```

After Claude Code reports an authenticated session, rerun the exact Claude
no-persistence discovery command above, confirm the temporary repository remains
unchanged, and change this audit to PASS. The installed package, transaction
archive, and no-op evidence do not need to be recreated unless their recorded
fingerprints change.

No tag, GitHub release, release PR, website deployment, or Sworn pin is
authorized by this failed gate.

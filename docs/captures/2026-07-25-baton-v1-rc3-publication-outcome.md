# Baton v1 RC3 publication outcome

Date: 2026-07-25
Status: PUBLISHED PORTABLE CANDIDATE; AUTONOMOUS PROFILE NOT RUN
Release: `v1.0.0-rc.3`

This capture records external publication evidence observed after the immutable
tag was created. It is intentionally not part of the tagged payload and does
not change the tag, release, protocol, or candidate bytes.

## Immutable source

The protected merge and its product tree are:

```text
commit affaf16cc37f845b5dc43b22988d8b680ff1f212
tree   a26078b7db4ee36bdae4f28a48447ff2df782f4f
```

The annotated tag object is:

```text
tag object 34324784694696a38d951061c2313363b405c1e4
peels to   affaf16cc37f845b5dc43b22988d8b680ff1f212
tree       a26078b7db4ee36bdae4f28a48447ff2df782f4f
```

## Protected CI

Both Conformance runs completed successfully against the same merge commit:

| Ref | Run | Node 24 job | Node 22 job |
| --- | --- | --- | --- |
| `main` | [30145469671](https://github.com/sawy3r/baton/actions/runs/30145469671) | [89646361651](https://github.com/sawy3r/baton/actions/runs/30145469671/job/89646361651) | [89646361684](https://github.com/sawy3r/baton/actions/runs/30145469671/job/89646361684) |
| `v1.0.0-rc.3` | [30145616536](https://github.com/sawy3r/baton/actions/runs/30145616536) | [89646850336](https://github.com/sawy3r/baton/actions/runs/30145616536/job/89646850336) | [89646850355](https://github.com/sawy3r/baton/actions/runs/30145616536/job/89646850355) |

Every listed job passed the complete portable profile, generated-adapter and
package checks, historical overhead budgets, installer syntax, and clean-tree
gate.

## Published release and assets

GitHub published the prerelease at
<https://github.com/sawy3r/baton/releases/tag/v1.0.0-rc.3> on
`2026-07-25T05:23:03Z`.

| Asset | MIME type | Size |
| --- | --- | ---: |
| `baton-1.0.0-rc.3.tar.gz` | `application/x-gtar` | 346,589 bytes |
| `baton-1.0.0-rc.3.tar.gz.sha256` | `application/octet-stream` | 90 bytes |

Two independent public downloads produced byte-identical archives and
checksum files. Each checksum file validated its downloaded archive:

```text
archive sha256
4757078049d8e9f0ac3db2aee91e65f8df48f31b0cccf26478343ca3d79d5166

checksum-file sha256
28d8f01a820100d31218ef37eae6c1f67d0d9adb0ba67cae7f95fa08579ea87f
```

The archive contained exactly 210 entries beneath the single
`baton-1.0.0-rc.3` prefix. Every entry passed traversal and extraction safety
validation. The extracted package reproduced 10 generated adapters from five
canonical operations with package identity:

```text
sha256:e5927a82f7c8a0daf3aa1196e7aa56231044449bb141cc2d7efd1cc8cca209bd
```

Project-scope Claude Code and Codex dry-runs from the public archive each
reported exactly seven intended actions. Each isolated target retained only
its pre-existing `.git` directory.

## User-scope install replay

The Claude Code and Codex user installs both bind RC3, the package digest
above, 31 owned files, and zero owned instruction blocks. Their no-op replay
made no managed change; a fresh read-only dry-run from the public archive also
reported `No changes: installed package and manifest already match.` for both
hosts.

Global instruction-file identities remained unchanged:

```text
Claude ~/.claude/CLAUDE.md
sha256:a69c7144b8166343080e10a3c0ce8d905a5f8fa25990bf9d277eee5176dbeacd

Codex ~/.codex/AGENTS.md
sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

No credential file was read, copied, or included in this evidence.

## Evidence boundary

Publication proves the portable Baton RC3 package, public assets, host
adapters, and installer replay described above. All 12 autonomous-engine cases
remain `NOT RUN`. This release therefore makes no Sworn, scheduler, provider,
credential-isolation, crash-recovery, or final-effect conformance claim.

# Install Baton

Baton RC9 ships one client-neutral Agent Skills payload under [`skills/`](skills/).
The five `baton-*` directories are the entire installed product. The repository
board, record helpers, schemas, and protocol documents remain project tools;
they are not hidden dependencies of an installed skill.

The agent already running in your tool performs installation because it can
identify that tool's current skills directory without Baton maintaining a
client allow-list or guessing paths.

## Copyable self-install request

```text
Install Baton v1.0.0-rc.9 from
https://github.com/sawy3r/baton.git.

Check out that exact tag and read INSTALL.md. Determine this tool's real user
or project skills directory from current documentation or the live
environment. Show me the complete no-write preview and wait for my approval
before applying it. Do not guess paths, edit instruction files, or install
Sworn. After approval, install the exact payload and prove in a clean context
that all five Baton skills are discovered.
```

That request authorises inspection only. Approval of the shown preview
authorises only the matching payload change.

## Agent installation contract

The installing agent must:

1. check out the exact requested tag and confirm its commit;
2. discover the current tool's real user or project skills directory from
   current documentation or the live environment;
3. inspect all five source and destination trees, the payload manifest, and any
   older Baton ownership or transaction state;
4. show source, destination, existing files, payload digest, and intended
   changes, then wait for approval;
5. stop on a symlink, mixed state, unknown stage, added or modified managed
   file, or an older installation that still owns its files; and
6. after applying, verify exact installed bytes and prove native discovery of
   all five skills in a clean context.

Client names are examples at most, never support boundaries. Baton code knows
no client selectors or discovery paths.

## Payload

The generated payload contains exactly:

```text
skills/
  baton-plan/
    SKILL.md
    templates/plan.md
  baton-implement/SKILL.md
  baton-design-review/SKILL.md
  baton-verify/SKILL.md
  baton-merge/SKILL.md
```

`skills/.baton-payload.json` binds every payload file to the RC9 release,
source path, source digest, and generated digest. Each `SKILL.md`
contains one exact canonical operation region. The plan template is bundled at
the exact relative path named by `baton-plan`, so every skill directory is
standalone.

Regeneration is deterministic:

```sh
node scripts/generate-skills.mjs --check
```

## Preview and install

The helper accepts only an operation and the absolute skills directory chosen
by the agent. It contains no client names or path discovery.

The default command is a complete, no-write preview:

```sh
node scripts/manage-skills.mjs install /absolute/path/to/skills
```

After the user approves that exact source, destination, and change set:

```sh
node scripts/manage-skills.mjs install /absolute/path/to/skills --apply
```

The helper:

- verifies the checked-out generated payload before trusting it;
- inspects all five destination trees before any write;
- refuses modified, added, missing-within-a-tree, symlinked, mixed, or unknown
  staged state;
- stages missing skills inside the destination filesystem and atomically
  renames complete directories into place;
- preserves unrelated skill directories; and
- treats exact repetition as a no-op.

The payload itself is platform-neutral Markdown. The optional helper requires
hard links and atomic directory renames within its private destination-side
stage. If that filesystem lacks either primitive, the helper fails closed
instead of publishing a partial skill; the agent must follow the same preview
and exact-tree contract without the helper.

If execution stops after only part of the exact payload is installed, run the
same preview again. After approval, repeat the same `--apply` command. Exact
installed and staged directories are reconciled; ambiguous bytes are not.

## Older RC2–RC8 installations

Do not install RC9 over files or state still owned by RC2 through RC8.

When an older manifest, support directory, transaction journal, or generated
Baton skill is present:

1. identify its exact release, scope, and destination;
2. check out that exact immutable release;
3. run that release's own safe uninstall preview;
4. wait for approval and complete that exact uninstall; and
5. confirm its manifest and transaction state no longer claim the skills
   before previewing RC9.

If the release or ownership is ambiguous, stop. The RC9 helper intentionally
refuses an older or modified skill tree and never adopts or overwrites it.
Historical installer code remains available from its Git tag; it is not part
of the live RC9 product.

## Update

An update is two explicit exact operations, never an in-place overwrite:

1. check out the currently installed release and preview `remove` with that
   release's helper;
2. after approval, remove its exact unmodified payload;
3. check out the requested new release;
4. preview its `install`; and
5. after approval, install and verify the new exact payload.

For RC9 removal, preview:

```sh
node scripts/manage-skills.mjs remove /absolute/path/to/skills
```

Then apply only after approval:

```sh
node scripts/manage-skills.mjs remove /absolute/path/to/skills --apply
```

Removal first atomically quarantines each exact managed directory within the
same filesystem, rechecks its complete tree, and deletes only known files and
empty known directories. An interruption is safely rerunnable. A concurrent
addition or modification is preserved and stops cleanup.

## Prove discovery

Filesystem equality is necessary but not sufficient. The agent must start a
clean tool context and use that tool's native skill listing or discovery
surface. It must prove that these five names are available:

```text
baton-plan
baton-implement
baton-design-review
baton-verify
baton-merge
```

If the tool does not discover one of them, do not report a successful install.
Recheck the tool's current skill documentation and the chosen scope; do not
move files by guessing.

## Use Baton

Free-form text supplies each operation's inputs. `baton-plan` can propose plan
bytes but cannot approve them. The ordinary guided sequence is plan, distinct
Captain review, implementation after `PROCEED`, fresh read-only verification,
and exact-candidate Merge.

The surrounding tool or engine writes compact receipts for trust boundaries.
Runner failure produces no Baton verdict. Repository board commands remain
available from the checked-out Baton source:

```sh
node reference/board/oracle.mjs /path/to/repository
node reference/board/oracle.mjs /path/to/repository \
  | node reference/board/terminal.mjs
node reference/board/web.mjs /path/to/repository
```

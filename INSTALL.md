# Install Baton

Baton RC10 ships one client-neutral Agent Skills payload under [`skills/`](skills/).
The five `baton-*` directories are the entire installed product. The repository
board, record helpers, schemas, and protocol documents remain project tools.

The agent already running in your tool performs installation because it can
resolve that tool's current canonical skills directory without Baton keeping a
client list or guessing paths.

## Copyable self-install request

```text
Install Baton v1.0.0-rc.10 from
https://github.com/sawy3r/baton.git.

Check out that exact tag and read INSTALL.md. Determine this tool's real user
or project skills directory from current documentation or the live
environment. Show me the complete no-write preview and wait for my approval
before applying it. Do not guess paths, edit instruction files, or install
Sworn. After approval, install the exact payload and prove in a clean context
that all five Baton skills are discovered.
```

That request authorises inspection only.

## Agent installation contract

The installing agent must:

1. check out the exact requested release, report its commit, and verify
   `skills/.baton-payload.json`, including its payload digest;
2. resolve and report the canonical skills destination from current
   documentation or the live environment, then inspect every expected source
   and destination path without following symlinks;
3. show a no-write preview that binds approval to the exact release and commit,
   payload digest, canonical destination, complete relative-path change set,
   and observed destination state, then wait for approval;
4. immediately before any effect, recheck every bound field and the observed
   destination state; if anything changed, stop and show a new preview;
5. make only the approved changes, rejecting symlinks and special entries and
   preserving unrelated skill directories; and
6. verify the exact installed bytes, then prove native discovery of all five
   skills in a clean tool context.

The final recheck cannot stop another local process from changing the
destination afterward. After interruption or change, inspect it and show a new
preview; never infer success from assumed state.

## Payload

The complete expected installed path set is:

```text
baton-plan/SKILL.md
baton-plan/templates/plan.md
baton-implement/SKILL.md
baton-design-review/SKILL.md
baton-verify/SKILL.md
baton-merge/SKILL.md
```

`skills/.baton-payload.json` binds each file to the RC10 release, source path,
source digest, generated digest, and complete payload digest. Each `SKILL.md`
contains one exact canonical operation region. Regeneration is deterministic:

```sh
node scripts/generate-skills.mjs --check
```

## Exact-state rules

- The payload is installed or removable only when the complete expected path
  set is byte-identical, with no missing, extra, symlink, or special entries
  inside the five skill directories.
- An incomplete exact payload is never adopted as installed or removed
  automatically. It requires a new preview and user direction.
- Modified, mixed, ambiguous, or unowned state stops. The agent must not
  overwrite it or claim ownership.

## Older RC2-RC9 installations

Do not install RC10 over files or state owned by RC2 through RC9. Use the exact
immutable release's own safe uninstall preview and apply flow. Only after its
exact uninstall is approved and complete may the agent preview RC10. Ambiguous
release, ownership, or bytes stops.

## Update and removal

An update is two separately approved operations:

1. inspect and preview removal of the exact complete old payload;
2. after approval and the final recheck, remove only that payload;
3. inspect the resulting destination and preview installation of the new
   release; and
4. after separate approval and another final recheck, install and verify the
   new exact payload.

## Prove discovery

Filesystem equality is necessary but not sufficient. Start a clean tool
context and use its native skill listing or discovery surface to prove these
five names are available:

```text
baton-plan
baton-implement
baton-design-review
baton-verify
baton-merge
```

If any skill is missing, do not report a successful install. Recheck the
tool's current documentation and the chosen scope; do not move files by
guessing.

## Start

Ask the agent to begin with `baton-plan`. The [README](README.md) explains the
five handoffs and the optional repository board.

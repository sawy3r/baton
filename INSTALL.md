# Install Baton

Baton installs as five Agent Skills. The easiest route is to ask the agent
already running in your tool to install them.

The agent can check the tool's current documentation, find the right skills
folder, and show you the complete change before writing anything. Baton does
not need a separate installer for every AI tool.

## Copy this request

```text
Install Baton v1.0.0-rc.13 from
https://github.com/sawy3r/baton.git.

Check out that exact tag and read INSTALL.md. Determine this tool's real user
or project skills directory from current documentation or the live
environment. Show me the complete no-write preview and wait for my approval
before applying it. Do not guess paths, edit instruction files, or install
Sworn. After approval, install the exact payload and prove in a clean context
that all five Baton skills are discovered.
```

This first request allows inspection only. The agent must show the preview and
wait for you before it changes anything.

## What should happen

1. The agent checks the exact release and its payload fingerprint.
2. It finds the correct skills folder for your tool.
3. It shows a complete no-write preview.
4. You approve that exact preview.
5. It checks that nothing changed, copies only the approved files, and verifies
   the result.
6. It opens a clean tool context and proves all five skills are available.

If the preview or destination changes at any point, the agent stops and shows a
new preview. It never guesses a path or silently replaces files.

## Files installed

The complete payload is:

```text
baton-plan/SKILL.md
baton-plan/templates/plan.md
baton-implement/SKILL.md
baton-design-review/SKILL.md
baton-verify/SKILL.md
baton-merge/SKILL.md
```

No board, schema, repository helper, or Sworn file is installed with these
skills.

## Updating or removing Baton

An update has two separately approved operations: removal, then installation.

1. preview removal of the exact old payload;
2. approve and remove only those exact files;
3. preview the new payload; and
4. approve, install, and verify it.

An incomplete or modified install is not removed automatically. The agent
shows what it found and asks what to do.

## Prove the install

The install is complete only when a clean tool context discovers:

```text
baton-plan
baton-implement
baton-design-review
baton-verify
baton-merge
```

If one is missing, the agent rechecks the tool's current documentation and the
chosen install scope. It does not move files by guessing.

Start by asking the agent to use `baton-plan`.

## Technical safety details

The installing agent must bind approval to the exact release and commit,
payload digest, canonical destination, complete relative-path change set, and
observed destination state. It must recheck all of those facts and the
destination immediately before any effect.
The rule is simple: if anything changed, stop and show a new preview.

The complete expected path set is byte-identical only when there are no
missing, extra, symlink, or special entries inside the five skill directories.
An incomplete exact payload is never adopted as installed or removed
automatically. Modified, mixed, ambiguous, or unowned state stops.

After interruption or change, the agent inspects the destination and presents a
new preview. The final recheck cannot prevent another local process from
changing the destination afterward, so success is based on the observed result,
not assumed state.

Do not install RC13 over files owned by RC2 through RC12. Use the exact
immutable release's own safe uninstall, including its preview and approval
flow. Only after that exact uninstall completes may the agent preview RC13.

`skills/.baton-payload.json` lists every source and generated fingerprint and
the complete payload digest. Regeneration is deterministic: the same sources
produce the same files.

```sh
node scripts/generate-skills.mjs --check
```

# Baton release evidence

This directory is the default human-readable companion to Baton release
records. The default may be changed globally in
`~/.config/baton/config.json` and overridden per project in
`.baton/config.json`:

```json
{
  "release_docs_root": "docs/baton/releases"
}
```

Use one directory per release:

```text
docs/baton/releases/<release>/
  README.md
  slices/
    S1/
      evidence.json
      evidence.md
      screenshots/
      outputs/
```

The bundle may contain screenshots, recordings, output snippets, logs, and
other material that helps a person inspect a slice result. `evidence.json` is
an advisory inventory of those artifacts. It is deliberately not a strict
Baton schema: unknown fields and additional artifact kinds are allowed.

The authoritative plan, slice contract, candidate, and verification decision
remain in the immutable Baton records under `.baton/releases/`. Evidence
bundles should identify their slice and attempt and should be linked to the
exact receipt or candidate when that context matters. A bundle can explain a
receipt; it cannot create approval or a PASS.

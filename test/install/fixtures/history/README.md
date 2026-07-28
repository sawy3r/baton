# Installer history fixtures

These fixtures preserve the exact files owned by the immutable Baton
`v1.0.0-rc.2`, `v1.0.0-rc.3`, `v1.0.0-rc.4`, `v1.0.0-rc.5`, and
`v1.0.0-rc.6` installers.

`index.json` records each tag, peeled commit, package identity, host-specific
install-manifest entries, and ownership fingerprint. `blobs/` stores each
unique owned file once under its SHA-256 digest. Tests verify every blob before
materializing a user- or project-scope predecessor installation.

The fixtures are deliberately self-contained. Upgrade tests do not fetch the
network, inspect local tags, or trust a manifest's asserted package digest
without recomputing its support-package digest and full ownership claim.

```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "baton-v1.0.0-rc.7-publication-recovery",
  "revision": 1,
  "previous_plan": null,
  "repository": "sawy3r/baton",
  "target_ref": "refs/heads/main",
  "approval_ref": "approval://baton-v1.0.0-rc.7-publication-recovery/1",
  "tracks": [
    {
      "id": "T1-publication-recovery",
      "depends_on": [],
      "slices": [
        {
          "id": "B1-release-support",
          "outcome": "Baton RC7 can be published as one complete immutable release while preserving RC6 protocol behavior and safely upgrading exact RC6 installations.",
          "scope": {
            "include": [
              "VERSION",
              "README.md",
              "INSTALL.md",
              "adapters",
              "docs",
              "scripts",
              "test"
            ],
            "exclude": [
              "baton",
              "conformance",
              "legacy",
              "operations",
              "reference",
              "schemas",
              "templates"
            ]
          },
          "acceptance": [
            {
              "id": "A-B1-identity",
              "text": "Current release-facing source consistently identifies v1.0.0-rc.7 and explains that RC7 is a bounded publication recovery over RC6, without claiming a public RC6 GitHub release still exists."
            },
            {
              "id": "A-B1-upgrade",
              "text": "The transactional installers recognize exact, unmodified RC6 ownership and support safe RC2 through RC6 user and project upgrades, while altered, unknown, or unowned content still fails before mutation."
            },
            {
              "id": "A-B1-invariance",
              "text": "RC6 protocol semantics, five canonical operations, plan and receipt contracts, reference state and action behavior, conformance obligations, and trust gates do not change."
            },
            {
              "id": "A-B1-proof",
              "text": "The complete portable conformance, Node, generated-adapter, overhead, installer, and whitespace checks pass on the exact candidate, followed by fresh read-only verification and exact-candidate Merge."
            }
          ],
          "checks": [
            "python3 conformance/check.py",
            "node --test test/records/*.test.mjs test/operations/*.test.mjs test/adapters/*.test.mjs test/install/*.test.mjs test/board/*.test.mjs test/release/*.test.mjs",
            "node scripts/generate-adapters.mjs --check",
            "node scripts/measure-overhead.mjs --check",
            "git diff --check"
          ],
          "constraints": [
            "The v1.0.0-rc.6 tag, merged candidate, receipts, and immutable-release tombstone remain untouched archaeology.",
            "No protocol rule, role, operation behavior, lifecycle state, schema, reducer, board contract, scheduler, driver, telemetry, inference, or credential feature is added.",
            "The RC7 GitHub release must be created as a draft, receive and verify every asset, and only then be published and made immutable.",
            "Merge only the exact candidate covered by fresh PASS."
          ],
          "depends_on": [],
          "consumes": []
        }
      ]
    }
  ]
}
```

# Goal

Recover the public release boundary after the RC6 GitHub release name became
permanently unavailable, without changing the lean protocol that RC6 delivered.

# Authority

Brad is the external authorizer. He approved the bounded RC7 correction in the
current conversation after being given the exact semantic scope: version and
release metadata, exact RC6 upgrade admission, full verification, draft-first
archive publication, and the matching website update.

# Scope

One product slice prepares RC7 release identity and installer compatibility.
It does not reopen RC6 protocol design. GitHub publication and the Baton website
remain external release effects after exact product Merge.

# Acceptance

RC7 must be truthful about the recovery, upgrade an exact RC6 installation,
leave every trust boundary unchanged, and pass the complete RC6 portable proof
surface before exact Merge.

# Ordered tracks and slices

There is one slice because release identity, generated support packages, and
predecessor admission must describe one exact package. No parallel product
track is needed.

# Dependencies and inputs

The slice begins from `origin/main` at
`4203a699947a9e2e4b18ee1d5a28e8ec9131bfcf`. It consumes no delivery slice.
The exact RC6 tag and package are immutable predecessor evidence, not mutable
inputs.

# Checks

Run the portable Python conformance check, complete Node matrix, generated
adapter parity, overhead budget, and whitespace validation. Focused archive,
installer, and release-identity checks may be added as implementation evidence
without revising this unchanged commitment.

# Constraints

Preserve RC6 as archaeology. Prepare and verify all RC7 assets before the first
public release publication. Do not turn this release-support correction into a
protocol, engine, website, or product redesign.

```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "release-id",
  "revision": 1,
  "repository": "owner/repository",
  "target_ref": "refs/heads/main",
  "approval_ref": "approval://release-id/1",
  "tracks": [
    {
      "id": "T1",
      "depends_on": [],
      "slices": [
        {
          "id": "S1",
          "outcome": "One observable delivered outcome.",
          "scope": {
            "include": ["src/owned-surface"],
            "exclude": []
          },
          "acceptance": [
            {
              "id": "A1",
              "text": "The approved observable outcome is demonstrated."
            }
          ],
          "checks": ["project-check-command"],
          "constraints": [],
          "depends_on": [],
          "consumes": []
        }
      ]
    }
  ]
}
```

# Goal

State the approved release outcome and why it matters.

# Authority

Name the external decision-maker and protected approval reference that binds
these exact bytes.

# Revision

Explain what changed, which slices are retained, and why any changed consumed
input invalidates the named dependency closure.

# Scope and acceptance

Summarise included and excluded product surfaces and how each acceptance
identifier is observable.

# Tracks, slices, and inputs

Explain ordering, parallel-safe boundaries, dependencies, and consumed inputs.

# Checks and constraints

Describe required checks, durable raw output, and non-negotiable limits.

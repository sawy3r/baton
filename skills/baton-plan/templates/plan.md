```baton-plan-v3
{
  "schema_version": "baton.plan/v3",
  "release": "release-id",
  "revision": 1,
  "previous_plan": null,
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
          "outcome": "A user can export the visible report as CSV.",
          "path": "slices/S1.md",
          "digest": "sha256:<slice-file-digest>"
        }
      ]
    }
  ]
}
```

# Goal

State the release result and why it matters.

# Authority

Name the external decision-maker and protected approval reference that binds
these exact bytes.

For revision 1, set `previous_plan` to `null`. Every later revision increments
`revision` and sets `previous_plan` to the exact Git blob object of the prior
bytes at this same repository path.

# Scope

Summarise committed behavior, product surfaces, and hard exclusions. Do not
predict every support or evidence path.

# Acceptance

Name the product check that could fail for each acceptance identifier.

# Ordered tracks and slices

Describe why the ordering and track boundaries are safe.

# Dependencies and inputs

Call out dependency edges, consumed slice outputs, shared boundaries, and
ownership assumptions. A revision invalidates only changed contracts and the
actual consumers of changed passed product trees.

Use `depends_on` and `consumes` only for real delivery ordering or product
inputs, not test co-touch, scheduling convenience, or likely support work.

# Checks

Describe the required checks. Their normalized result digest belongs in the
candidate and Verifier receipts; raw output may stay in the engine evidence
store. These are the required minimum; additional focused checks are evidence
and do not revise an unchanged commitment.

# Constraints

Record non-negotiable semantic, safety, compatibility, and delivery limits,
not implementation predictions or runtime bookkeeping.

Each declared slice contract belongs in its own `slices/<id>.md` file using the
bundled slice template. The skeleton's `path`, `digest`, and one-line `outcome`
must match that file exactly.

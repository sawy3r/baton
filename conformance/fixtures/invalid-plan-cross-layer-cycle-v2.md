```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "invalid-cross-layer-cycle",
  "revision": 1,
  "previous_plan": null,
  "repository": "example/project",
  "target_ref": "refs/heads/main",
  "approval_ref": "approval://invalid-cross-layer-cycle/1",
  "tracks": [
    {
      "id": "T1",
      "depends_on": ["T2"],
      "slices": [
        {
          "id": "S1",
          "outcome": "Deliver the dependent-track outcome.",
          "scope": {
            "include": ["src/first"],
            "exclude": []
          },
          "acceptance": [
            {
              "id": "A1",
              "text": "The dependent-track outcome is observable."
            }
          ],
          "checks": ["project-check"],
          "constraints": [],
          "depends_on": [],
          "consumes": []
        }
      ]
    },
    {
      "id": "T2",
      "depends_on": [],
      "slices": [
        {
          "id": "S2",
          "outcome": "Deliver the prerequisite-track outcome.",
          "scope": {
            "include": ["src/second"],
            "exclude": []
          },
          "acceptance": [
            {
              "id": "A2",
              "text": "The prerequisite-track outcome is observable."
            }
          ],
          "checks": ["project-check"],
          "constraints": [],
          "depends_on": ["S1"],
          "consumes": []
        }
      ]
    }
  ]
}
```

# Invalid combined delivery graph

Track `T1` waits for `T2`, while `T2/S2` explicitly waits for `T1/S1`.

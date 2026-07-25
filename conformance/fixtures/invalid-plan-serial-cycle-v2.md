```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "invalid-serial-cycle",
  "revision": 1,
  "previous_plan": null,
  "repository": "example/project",
  "target_ref": "refs/heads/main",
  "approval_ref": "approval://invalid-serial-cycle/1",
  "tracks": [
    {
      "id": "T1",
      "depends_on": [],
      "slices": [
        {
          "id": "S1",
          "outcome": "Deliver the first outcome.",
          "scope": {
            "include": ["src/first"],
            "exclude": []
          },
          "acceptance": [
            {
              "id": "A1",
              "text": "The first outcome is observable."
            }
          ],
          "checks": ["project-check"],
          "constraints": [],
          "depends_on": ["S2"],
          "consumes": []
        },
        {
          "id": "S2",
          "outcome": "Deliver the second outcome.",
          "scope": {
            "include": ["src/second"],
            "exclude": []
          },
          "acceptance": [
            {
              "id": "A2",
              "text": "The second outcome is observable."
            }
          ],
          "checks": ["project-check"],
          "constraints": [],
          "depends_on": [],
          "consumes": []
        }
      ]
    }
  ]
}
```

# Invalid combined delivery graph

`S2` is implicitly ordered after `S1`, while `S1` explicitly depends on `S2`.

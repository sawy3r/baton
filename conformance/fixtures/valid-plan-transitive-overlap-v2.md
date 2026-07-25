```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "valid-transitive-overlap",
  "revision": 1,
  "previous_plan": null,
  "repository": "example/project",
  "target_ref": "refs/heads/main",
  "approval_ref": "approval://valid-transitive-overlap/1",
  "tracks": [
    {
      "id": "T1",
      "depends_on": [],
      "slices": [
        {
          "id": "S1",
          "outcome": "Deliver the shared foundation.",
          "scope": {
            "include": ["src/shared"],
            "exclude": []
          },
          "acceptance": [
            {
              "id": "A1",
              "text": "The shared foundation is observable."
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
      "depends_on": ["T1"],
      "slices": [
        {
          "id": "S2",
          "outcome": "Deliver the ordered middle stage.",
          "scope": {
            "include": ["src/middle"],
            "exclude": []
          },
          "acceptance": [
            {
              "id": "A2",
              "text": "The middle stage is observable."
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
      "id": "T3",
      "depends_on": ["T2"],
      "slices": [
        {
          "id": "S3",
          "outcome": "Extend the shared foundation after the middle stage.",
          "scope": {
            "include": ["src/shared/nested"],
            "exclude": []
          },
          "acceptance": [
            {
              "id": "A3",
              "text": "The ordered extension is observable."
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

# Valid transitively ordered overlap

`T3/S3` can safely overlap `T1/S1` because `T3` waits for `T2`, which waits for
`T1`; the two slices can never execute concurrently.

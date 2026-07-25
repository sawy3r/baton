```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "portable-receipts",
  "revision": 2,
  "previous_plan": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "repository": "example/portable",
  "target_ref": "refs/heads/main",
  "approval_ref": "approval://portable-receipts/2",
  "tracks": [
    {
      "id": "T1",
      "depends_on": [],
      "slices": [
        {
          "id": "S1",
          "outcome": "A compact receipt is emitted for an exact candidate.",
          "scope": {
            "include": ["src/receipt"],
            "exclude": []
          },
          "acceptance": [
            {
              "id": "A1",
              "text": "The receipt binds the candidate and normalized checks."
            }
          ],
          "checks": ["node --test test/receipt.test.mjs"],
          "constraints": ["Do not write a status cursor."],
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
          "outcome": "The new release index documents the receipt.",
          "scope": {
            "include": ["docs/release-index.md"],
            "exclude": []
          },
          "acceptance": [
            {
              "id": "A2",
              "text": "The index links to the receipt documentation."
            }
          ],
          "checks": ["node --test test/release-index.test.mjs"],
          "constraints": [],
          "depends_on": [],
          "consumes": []
        }
      ]
    }
  ]
}
```

# Portable receipt fixture revision

Revision 2 retains S1 unchanged and adds the independent S2 outcome.

```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "portable-receipts",
  "revision": 2,
  "previous_plan": null,
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
          "constraints": [],
          "depends_on": [],
          "consumes": []
        }
      ]
    }
  ]
}
```

# Invalid revision

Revision 2 cannot omit its prior plan object.

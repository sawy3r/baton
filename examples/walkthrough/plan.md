```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "checkout-recovery",
  "revision": 1,
  "previous_plan": null,
  "repository": "acme/checkout",
  "target_ref": "refs/heads/main",
  "approval_ref": "approval://checkout-recovery/1",
  "tracks": [
    {
      "id": "T1",
      "depends_on": [],
      "slices": [
        {
          "id": "S1",
          "outcome": "A timed-out checkout can be retried without a duplicate charge.",
          "scope": {
            "include": ["src/checkout", "test/checkout"],
            "exclude": ["src/checkout/provider-adapter"]
          },
          "acceptance": [
            {
              "id": "A1",
              "text": "Repeating one checkout key returns one charge identity."
            }
          ],
          "checks": ["npm test -- checkout-retry"],
          "constraints": ["Do not change the payment-provider contract."],
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
          "outcome": "An operator can safely recover a timed-out checkout.",
          "scope": {
            "include": ["docs/runbooks/checkout-recovery.md"],
            "exclude": []
          },
          "acceptance": [
            {
              "id": "A2",
              "text": "The runbook identifies the retry key and the stop condition."
            }
          ],
          "checks": ["npm test -- runbook-links"],
          "constraints": ["Do not describe unimplemented provider controls."],
          "depends_on": [],
          "consumes": []
        }
      ]
    }
  ]
}
```

# Goal

Make timeout recovery safe for both customers and operators.

# Authority

The checkout service owner approves these exact bytes through
`approval://checkout-recovery/1`.

# Scope

T1 owns checkout retry behavior and tests. T2 owns only the recovery runbook.
The payment-provider contract is excluded.

# Acceptance

A1 observes charge identity across a repeated checkout key. A2 checks that the
operator instructions name the same key and a safe stop condition.

# Ordered tracks and slices

T1/S1 and T2/S2 are independent. Slice attempts remain serial within either
track.

# Dependencies and inputs

The tracks have no dependency edge, their scopes do not overlap, and neither
slice consumes the other slice's passed product tree.

# Checks

Each candidate receipt binds the normalized result of its named check. The raw
output remains engine evidence rather than a second protocol artefact.

# Constraints

No provider-contract change or invented operator control is allowed. Merge may
advance the target only to the exact assembly candidate covered by the current
fresh-context PASS.

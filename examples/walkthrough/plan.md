```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "checkout-recovery",
  "revision": 3,
  "repository": "acme/checkout",
  "target_ref": "refs/heads/main",
  "approval_ref": "approval://checkout-recovery/3",
  "tracks": [
    {
      "id": "T1",
      "depends_on": [],
      "slices": [
        {
          "id": "S1",
          "outcome": "A timed-out checkout can be retried without a duplicate charge or hydration error.",
          "scope": {
            "include": ["src/checkout", "test/checkout"],
            "exclude": ["src/checkout/provider-adapter"]
          },
          "acceptance": [
            {
              "id": "A1",
              "text": "Repeating one checkout key returns one charge identity."
            },
            {
              "id": "A2",
              "text": "The retry path hydrates without a client or server error."
            }
          ],
          "checks": [
            "npm test -- checkout-retry",
            "npm test -- checkout-hydration"
          ],
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
              "id": "A3",
              "text": "The runbook identifies the retry key and safe stop condition."
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

Make checkout timeout recovery safe for customers and operators.

# Authority

The checkout service owner approves revision 3 through
`approval://checkout-recovery/3`.

# Revision

Revision 2 corrected internal metadata without changing either slice identity.
Revision 3 added the hydration acceptance and check to S1 after its first
candidate failed verification. S2 is retained because its contract and
consumed inputs are unchanged.

# Scope and acceptance

S1 owns checkout retry behavior, hydration, and tests. S2 owns only the recovery
runbook. The payment-provider contract is excluded.

# Tracks, slices, and inputs

T1/S1 and T2/S2 are independent and consume no output from each other.

# Checks and constraints

Each slice retains raw check output. No provider-contract change or invented
operator control is allowed.

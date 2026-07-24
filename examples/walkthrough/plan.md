```baton-plan-v1
{
  "schema_version": "baton.plan/v1",
  "release": "checkout-recovery",
  "repository": "acme/checkout",
  "target_ref": "refs/heads/main",
  "release_ref": "refs/heads/release-wt/checkout-recovery",
  "record_root": ".baton/releases",
  "approval_ref": "approval://checkout-recovery/1",
  "tracks": [
    {
      "id": "T1",
      "ref": "refs/heads/track/checkout-recovery/T1",
      "depends_on": [],
      "touch_surfaces": ["src/checkout", "test/checkout"],
      "work": [
        {
          "id": "W1",
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
          "depends_on": []
        }
      ]
    },
    {
      "id": "T2",
      "ref": "refs/heads/track/checkout-recovery/T2",
      "depends_on": [],
      "touch_surfaces": ["docs/runbooks"],
      "work": [
        {
          "id": "W2",
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
          "depends_on": []
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

# Ordered tracks and work

T1/W1 and T2/W2 are independent. Work remains serial within either track.

# Dependencies and touch surfaces

The tracks have no dependency edge and their declared touch surfaces do not
overlap.

# Checks

Each work item retains its named test output with its proof.

# Constraints

No provider-contract change, invented operator control, or behavioral
`.baton/releases` content is allowed.

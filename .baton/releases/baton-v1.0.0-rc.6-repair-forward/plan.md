```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "baton-v1.0.0-rc.6-repair-forward",
  "revision": 1,
  "previous_plan": null,
  "repository": "sawy3r/baton",
  "target_ref": "refs/heads/main",
  "approval_ref": "github://sawy3r/baton/issues/93#baton-plan-approval-v1.0.0-rc.6-repair-forward-v1",
  "tracks": [
    {
      "id": "T1-repair-forward",
      "depends_on": [],
      "slices": [
        {
          "id": "B1-commitment-not-inventory",
          "outcome": "Baton constrains trustworthy commitment without forcing intelligent agents to restart delivery for correctable implementation, evidence, or procedural details.",
          "scope": {
            "include": [
              "README.md",
              "VERSION",
              "adapters",
              "baton",
              "conformance",
              "docs",
              "operations",
              "reference",
              "schemas",
              "scripts",
              "templates",
              "test"
            ],
            "exclude": [
              "legacy"
            ]
          },
          "acceptance": [
            {
              "id": "A-B1-commitment",
              "text": "The protocol and plan guidance distinguish approved behavioral scope, acceptance, semantic limits, and real product dependencies from predicted paths, exhaustive commands, support-file discovery, evidence notes, scheduling, retries, models, worktrees, and bookkeeping. Operational discovery does not require a plan revision."
            },
            {
              "id": "A-B1-repair",
              "text": "Procedural or clerical omissions are repaired in place; bounded Captain corrections may proceed inline; Verifier FAIL returns the same work directly to implementation; and only a material design, contract, authority, or external-decision change crosses back to Captain or Planner. Work and release identities remain stable."
            },
            {
              "id": "A-B1-assurance",
              "text": "External plan approval, durable exact bindings, distinct Captain judgment where material, fresh read-only adversarial verification, fail-closed missing trust facts, and exact-candidate Merge remain unchanged."
            },
            {
              "id": "A-B1-regression",
              "text": "A conformance journey proves that discovering ancillary test or oracle paths, running additional checks, correcting evidence, and recovering operational state complete within the same approved plan and work identity, while a real behavioral, consumed-product, contract, or authority change still escalates."
            },
            {
              "id": "A-B1-economy",
              "text": "The public explanation, five portable operations, generated adapters, templates, and measurements use plain language and add no role, lifecycle state, universal artifact, schema family, orchestration mechanism, or repeated incident narrative."
            }
          ],
          "checks": [
            "python3 conformance/check.py",
            "node --test test/records/*.test.mjs test/operations/*.test.mjs test/adapters/*.test.mjs test/install/*.test.mjs test/board/*.test.mjs test/release/*.test.mjs",
            "node scripts/generate-adapters.mjs --check",
            "node scripts/measure-overhead.mjs --check",
            "git diff --check"
          ],
          "constraints": [
            "Baton remains platform-, vendor-, model-, scheduler-, and engine-agnostic.",
            "The RC5 release, prior plans, receipts, candidates, and verdicts remain immutable archaeology.",
            "No managed inference, provider credential custody, hosted control, retry engine, worktree manager, or telemetry system enters Baton.",
            "This migration changes the meaning and routing of operational variance; it does not weaken any trust-critical gate."
          ],
          "depends_on": [],
          "consumes": []
        }
      ]
    }
  ]
}
```

# Goal

Make “Baton constrains commitment, not cognition” executable with the smallest
change that would have prevented Sworn W4 from requiring a new plan and attempt
solely for discovered test, oracle, check, and maintenance evidence.

# Authority

Brad is the external authorizer. Approval must bind these exact bytes through
the protected marker on issue 93.

# Scope

One coherent slice updates the public protocol, portable operations, reference
conformance, generated adapters, durable decision capture, and release-facing
material. Historical payloads under `legacy` are excluded.

# Acceptance

The regression must exercise both sides of the boundary: harmless operational
variance repairs forward, while a real change to behavior, consumed product,
contract, or authority still stops for the appropriate decision.

# Ordered tracks and slices

There is one slice because the protocol language, operations, conformance, and
generated adapters form one contract and should be verified together.

# Dependencies and inputs

The slice begins from `origin/main` at
`afad775121d7d37244f4d3798b7b4c6a9fbfe9b2`. It consumes no other delivery
slice. Sworn integration follows only after this Baton candidate passes.

# Checks

Run the portable Python conformance check, complete Node test matrix, generated
adapter parity, overhead budget, and whitespace validation. Additional focused
checks are implementation evidence and do not require a plan revision.

# Constraints

Keep the five responsibility boundaries and exact Git assurance. Put
deterministic bookkeeping and runtime recovery in engines such as Sworn, and
leave intelligent implementation judgment with the responsible agent.

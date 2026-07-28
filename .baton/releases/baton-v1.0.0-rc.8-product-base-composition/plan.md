```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "baton-v1.0.0-rc.8-product-base-composition",
  "revision": 1,
  "previous_plan": null,
  "repository": "sawy3r/baton",
  "target_ref": "refs/heads/main",
  "approval_ref": "github://sawy3r/baton/issues/97#baton-plan-approval-baton-v1.0.0-rc.8-product-base-composition-v1",
  "tracks": [
    {
      "id": "T1-composition",
      "depends_on": [],
      "slices": [
        {
          "id": "B1-product-base-composition",
          "outcome": "Baton composes an exact passed product from its bound product base when repository ancestry is misleading, without accepting a real product conflict.",
          "scope": {
            "include": [
              "VERSION",
              "README.md",
              "INSTALL.md",
              "adapters",
              "conformance/manifest.json",
              "docs",
              "reference",
              "scripts",
              "test"
            ],
            "exclude": [
              "baton",
              "legacy",
              "operations",
              "schemas",
              "templates"
            ]
          },
          "acceptance": [
            {
              "id": "A-B1-base",
              "text": "At plan installation, refs/heads/main remains commit 02cb2dbee4d64cb4d5be71542cd0dd42ece6d0d9 with tree 4861d05042027847d0cde510297b702319cdc444. Drift requires a plan revision."
            },
            {
              "id": "A-B1-replay",
              "text": "For consumed-track preparation and final assembly, when ordinary Git ancestry reports a conflict but the exact passed producer delta applies cleanly from its authority-derived whole-slice or whole-track product base, Baton deterministically creates the same product tree with a two-parent composition whose first parent is current consumer authority and second parent is the exact producer PASS authority."
            },
            {
              "id": "A-B1-continuity",
              "text": "Product-base derivation preserves every accepted repair in a multi-attempt slice and every earlier passed slice in a serial track. A latest-attempt candidate base or final-slice base cannot truncate earlier product work."
            },
            {
              "id": "A-B1-legacy",
              "text": "For a retained candidate that predates explicit prepared-base evidence, Baton may reconstruct its product base only from the approved target, exact ordered prior-slice PASS authorities, and exact consumed PASS bindings in its approved plan lineage. Missing, stale, cyclic, conflicting, or ambiguous authority stops without moving a ref."
            },
            {
              "id": "A-B1-conflict",
              "text": "If the exact producer delta conflicts from that product base, composition returns COMPOSITION_CONFLICT and moves no ref. Baton never chooses a side, invokes a custom merge driver, or treats patch similarity as authority."
            },
            {
              "id": "A-B1-compatibility",
              "text": "Existing fast-forward, already-contained, approved-target, clean two-parent composition, state reconstruction, and exact verification behavior remains compatible. No role, lifecycle stage, plan field, model artefact, or approval meaning is added."
            },
            {
              "id": "A-B1-proof",
              "text": "Focused fixtures prove the exact Sworn false-conflict topology through consumed-track preparation and assembly, retain all repairs in a multi-attempt slice and all prior work in a serial track, and stop on a nearby true-conflict negative case; then the complete portable conformance, Node, generated-adapter, overhead, installer, and whitespace checks pass on the exact candidate."
            }
          ],
          "checks": [
            "python3 conformance/check.py",
            "node --test test/records/*.test.mjs test/operations/*.test.mjs test/adapters/*.test.mjs test/install/*.test.mjs test/board/*.test.mjs test/release/*.test.mjs",
            "node scripts/generate-adapters.mjs --check",
            "node scripts/measure-overhead.mjs --check",
            "sh -n install-claude.sh",
            "sh -n install-codex.sh",
            "git diff --check"
          ],
          "constraints": [
            "The correction implements the existing safe exact-composition commitment; Baton Core, responsibilities, canonical operations, schemas, and lifecycle meanings do not change.",
            "The product base is authority-derived and deterministic. Neither an agent nor a caller may supply a raw merge base, parent, merge strategy, conflict choice, or arbitrary ref.",
            "The composed product must retain the exact producer candidate, candidate receipt, and PASS receipt as ancestors and remain independently reproducible from protected facts.",
            "The immutable RC7 tag, release, package, receipts, and published assets remain untouched archaeology.",
            "RC8 assets are prepared and verified before draft publication. Merge only the exact candidate covered by fresh PASS."
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

Remove a false source of replanning and slice churn: a clean passed product
delta must not become a composition conflict merely because older delivery
history gives Git the wrong merge base. Real product conflicts must still stop.

# Authority

Brad is the external authorizer. Approval is an exact comment under
`sawy3r/baton#97` containing the protected marker
`baton-plan-approval-baton-v1.0.0-rc.8-product-base-composition-v1`, the exact
plan digest, and `Decision: APPROVE`.

# Scope

One slice corrects product-base selection in the portable reference
composition path, adds positive and negative proof fixtures, and prepares the
matching RC8 package and public technical documentation. It does not change
Baton's principles, responsibilities, operations, schemas, or role handoffs.

GitHub release publication and the Baton website remain external effects after
exact product Merge.

# Acceptance

The positive fixture reproduces the observed Sworn topology: ordinary ancestry
conflicts, the authority-derived producer base replays cleanly, and the result
matches the independently audited product tree. The negative fixture changes
the same product incompatibly and proves that the explicit-base merge still
fails closed without ref movement.

# Ordered tracks and slices

There is one slice because source-base derivation, deterministic composition,
state verification, regression proof, and release identity describe one
atomic trust-boundary correction. No parallel product track is useful.

# Dependencies and inputs

The slice begins from exact `main` commit
`02cb2dbee4d64cb4d5be71542cd0dd42ece6d0d9`. It consumes no Baton delivery
slice. The Sworn objects recorded in issue 97 are immutable fixture evidence,
not mutable repository inputs or authority.

# Checks

Run the focused exact-composition fixtures and the complete portable release
matrix. Generated support packages, overhead objects, installers, and release
identity must agree with the exact candidate. Additional focused adversarial
checks are evidence under this unchanged contract.

# Constraints

The correction may select only a product base derived from already-protected
Baton facts. If that base cannot be reconstructed uniquely, or the exact delta
still conflicts, stop. Do not turn this into agent-authored conflict
resolution, a new plan field, or a new protocol stage.

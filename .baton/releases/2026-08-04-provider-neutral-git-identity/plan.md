```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "2026-08-04-provider-neutral-git-identity",
  "revision": 1,
  "previous_plan": null,
  "repository": "sawy3r/baton",
  "target_ref": "refs/heads/main",
  "approval_ref": "approval://2026-08-04-provider-neutral-git-identity/1",
  "tracks": [
    {
      "id": "T1",
      "depends_on": [],
      "slices": [
        {
          "id": "S1",
          "outcome": "Baton defines semantic Git records without prescribing a hosting-provider-visible author or committer identity, while preserving deterministic retry and exact authority semantics.",
          "scope": {
            "include": [
              "Baton reference record-writing contract",
              "portable conformance profile",
              "RC14 release package"
            ],
            "exclude": [
              "Git hosting configuration",
              "deployment-provider configuration",
              "Sworn runtime behavior"
            ]
          },
          "acceptance": [
            {
              "id": "A1",
              "text": "Production record-writing APIs require an explicit valid engine Git identity and contain no built-in invalid-domain author or committer identity."
            },
            {
              "id": "A2",
              "text": "Repeating the same operation with the same parent, content, timestamp rule, and identity produces the same Git object and remains safely reconcilable after interruption."
            },
            {
              "id": "A3",
              "text": "Different valid engine identities preserve the same projected Baton plan, receipt, candidate, and authority meaning."
            },
            {
              "id": "A4",
              "text": "An immutable Baton RC14 package publishes the provider-neutral identity contract for downstream engines."
            }
          ],
          "checks": [
            ".venv/bin/python conformance/check.py",
            "node --test test/records/*.test.mjs test/operations/*.test.mjs test/skills/*.test.mjs test/board/*.test.mjs test/release/*.test.mjs",
            "node scripts/generate-skills.mjs --check",
            "node scripts/measure-overhead.mjs --check",
            "git diff --check"
          ],
          "constraints": [
            "Git identity is attribution metadata and must never be interpreted as Baton role or approval authority.",
            "Baton must not contain a GitHub, GitLab, Bitbucket, Vercel, or service-account-specific production identity.",
            "Published release tags remain immutable."
          ],
          "depends_on": [],
          "consumes": []
        }
      ]
    }
  ]
}
```

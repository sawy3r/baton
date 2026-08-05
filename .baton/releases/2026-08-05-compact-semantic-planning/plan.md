```baton-plan-v2
{
  "schema_version": "baton.plan/v2",
  "release": "2026-08-05-compact-semantic-planning",
  "revision": 1,
  "previous_plan": null,
  "repository": "sawy3r/baton",
  "target_ref": "refs/heads/main",
  "approval_ref": "approval://2026-08-05-compact-semantic-planning/1",
  "tracks": [
    {
      "id": "T1",
      "depends_on": [],
      "slices": [
        {
          "id": "S1",
          "outcome": "Before code starts, Baton helps agents turn a human goal into a short, clear contract whose meaning is ready to build and review.",
          "scope": {
            "include": [
              "Planner, Implementer, and Captain guidance",
              "plan template and plain-language examples",
              "generated skills and RC15 release package"
            ],
            "exclude": [
              "plan or receipt schemas",
              "record, board, Verifier, or Merge behavior",
              "Sworn conversation, storage, or user-interface behavior"
            ]
          },
          "acceptance": [
            {
              "id": "A1",
              "text": "Before writing a plan, the Planner inspects the repository and current plan, finds repository facts itself, and asks the human only about choices that could change the promised result."
            },
            {
              "id": "A2",
              "text": "The Planner does not offer a plan for approval while an important choice is open. Once the meaning is clear, it gives the human a short plain-language summary to correct, then writes the compact plan."
            },
            {
              "id": "A3",
              "text": "Each slice has one clear result that can be reviewed on its own. Its acceptance criteria can fail in a real product check, and the proposed evidence can truly test them."
            },
            {
              "id": "A4",
              "text": "The Implementer shows how the approach will meet each acceptance criterion and how it will be tested. It stops before making up a requirement. The Captain looks for ways the design could miss the approved goal and asks for a human decision when the plan does not say enough."
            },
            {
              "id": "A5",
              "text": "Fresh planning trials cover a repository fact the agent should discover, a high-risk choice only the human can make, and a complete goal that needs no needless questions. Review judges meaning and usefulness, not exact wording or layout."
            },
            {
              "id": "A6",
              "text": "Human-facing guidance uses short, common words and direct sentences that a middle-school reader or person learning English can follow. Each operation stays within 350 words, the normal four-handoff load stays at or below 1,506 fixed words, and the RC15 generated skill package carries the same meaning."
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
            "Judge the meaning, not the shape of the prose. A valid file shape does not prove a good plan.",
            "Add no role, schema, gate, fixed questionnaire, required discovery file, reading score, or formatting validator.",
            "Rewrite or remove weaker guidance instead of appending a copied prompt framework.",
            "Keep exact approval, Captain separation, fresh verification, durable bindings, and exact Merge unchanged."
          ],
          "depends_on": [],
          "consumes": []
        }
      ]
    }
  ]
}
```

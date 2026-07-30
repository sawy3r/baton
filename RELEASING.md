# Releasing Baton

Baton uses semantic versioning for normative protocol behavior and record
contracts. Release candidates use immutable annotated
`v<version>-rc.<number>` tags and GitHub prereleases.

## Candidate checklist

1. Start from the exact reviewed release head with a clean worktree and full
   Git history. Confirm `VERSION` matches the intended tag.
2. Install the pinned Python dependency in an isolated environment and run the
   full portable profile on Node.js 22 and 24:

   ```sh
   python3 -m venv .venv
   .venv/bin/python -m pip install -r conformance/requirements.txt
   .venv/bin/python conformance/check.py
   node --test test/records/*.test.mjs test/operations/*.test.mjs \
     test/skills/*.test.mjs test/board/*.test.mjs test/release/*.test.mjs
   ```

3. Check generated payload bytes, overhead objects, and the tree:

   ```sh
   node scripts/generate-skills.mjs --check
   node scripts/measure-overhead.mjs --check
   git diff --check
   git status --short
   ```

4. Confirm `skills/` has exactly five `baton-*` directories. Verify every
   `SKILL.md` canonical region against `operations/`, the bundled
   `baton-plan/templates/plan.md` against `templates/plan.md`, and every file
   against `skills/.baton-payload.json`.
5. Review the diff from the prior tag. Current docs, examples, conformance
   manifest, `VERSION`, generated payload, and release note must agree.
   Historical notes and captures stay unchanged.
6. Review the agent-led contract against temporary destinations. Approval must
   bind the exact release commit, payload digest, canonical destination,
   complete relative-path change set, and observed state. Recheck all of them
   immediately before effects and require a new preview if anything changed.
   A partial payload requires user direction; removal requires the complete
   byte-identical expected set with no missing, extra, symlink, or special
   entries.

7. In clean contexts, independently prove native discovery for OpenCode,
   Hermes Agent, Cline, and at least one materially different Agent Skills
   client. Resolve each destination from that tool's current documentation.
   Record source tag, payload digest, chosen scope and destination, preview,
   approval, installed tree digest, and native discovery result. These are
   release-evidence clients, not a maintained product allow-list.
8. Prove an exact RC2–RC9 installation is never overwritten. Its own immutable
   release must preview and complete safe uninstall before RC10 installation is
   eligible.
9. Merge the reviewed candidate under branch protection and rerun every gate
   on the exact result. Create the annotated tag only after those checks pass.
10. Verify the public tag, prerelease, source links, payload manifest, schema
    bytes, and archived schema URLs. Record the immutable commit an engine may
    pin.

If any check fails after merge but before tagging, stop, repair, and re-review.
Never move a published tag.

## Portable versus autonomous claims

Portable success proves the plan and receipt contracts, Git-derived state and
action kit, operations, standalone generated skills, agent-led installation
contract, and terminal/browser board. It does not prove an autonomous engine.

An engine conformance claim requires every autonomous case to run through the
engine's actual binary, scheduler, persistence, workspace, driver, and Git
boundaries. `NOT RUN` is not `PASS`. Final `v1.0.0` waits for that evidence
from Sworn or another real engine.

## History boundary

Git tags preserve the retired host-specific installers and their exact
ownership rules. They are release-specific removal tools, not live RC10 product
code. Do not copy historical uninstall logic into the live product or silently
translate old state.

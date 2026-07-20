# Baton 0.x archaeology

Baton 0.x accumulated twelve incident-derived rules, four long role prompts,
tool installers, slash commands, release templates, LLM-check procedures, and
eighteen schemas. They remain useful evidence of how the trust model developed,
but they are not part of Baton 1.x.

The exact final surface is preserved at the immutable
[`v0.16.0`](https://github.com/sawy3r/baton/tree/v0.16.0) tag. Historical
captures under `docs/captures/` remain in the main branch because they explain
real failure modes and do not form a runtime instruction surface.

Baton 1.x deliberately provides no migration layer. A delivery engine presented
with a 0.x record should fail clearly and direct the operator to the 0.x engine
or an explicitly authorized re-plan.

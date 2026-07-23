# Baton Conformance 1.0

Conformance is behavioral. Loading Baton prose, naming five agents, or drawing a
workflow does not establish it.

## Portable record conformance

Every implementation MUST:

1. parse the plan metadata and status as strict UTF-8 I-JSON;
2. reject duplicate names, trailing values, lone surrogates, non-finite
   numbers, and integers outside `[-9007199254740991, 9007199254740991]`;
3. validate the closed plan and `work-status-v1` shapes before use;
4. digest plan, design, proof, approval, and dispatch evidence as exact raw
   bytes;
5. reject unknown fields, invalid refs, ambiguous ownership, and every record
   root except the canonical, non-symlinked `.baton/releases`;
6. admit only the standard transitions, one atomic dual-ref materialisation,
   and `REBOUND` of a pristine unmaterialised baseline;
7. reject stale plan, approval, design, Captain, proof, candidate, product-tree,
   Verifier, Merge, assembly, and target bindings;
8. keep runner failure distinct from `FAIL` and `BLOCKED`, with `NO_VERDICT` as
   the only byte-unchanged redispatch path;
9. derive repository identity, ancestry, candidate tree, and product-tree facts
   from Git rather than an agent claim;
10. replay candidate history from the exact materialisation or prior passed
    candidate, rejecting product-before-`PROCEED`, cross-work record commits,
    and later work before earlier `PASS`;
11. select active work from one captured owning lineage, never a newer foreign
    copy, and reject an erased materialisation marker;
12. treat structural board projection as syntax and authority only, never as
    trusted action admission;
13. update a ref only when its exact expected head still matches; and
14. require Merge-prepared proof and fresh verification of the complete
    assembled release before final Merge.

The only authored JSON Schema is `work-status-v1`. Plan metadata has a closed
semantic shape because it is embedded in Markdown rather than represented by a
second schema.

## Guided/manual profile

A guided implementation conforms when it:

- presents the exact plan for external approval;
- records protected approval evidence over the plan digest;
- uses distinct Implementer and Captain invocations;
- stops implementation until Captain returns `PROCEED`;
- starts the Verifier in a clean context with read-only candidate access and no
  implementation conversation;
- resolves protected approval and Verifier-dispatch evidence outside the
  candidate before admitting the corresponding action;
- leaves the durable status unchanged and redispatches only the same candidate
  when the host or runner produces `NO_VERDICT`;
- performs every transition through validated committed records; and
- stops when its host cannot establish one of those facts.

Human coordination may establish separation and approval, but the resulting
status bindings and Git facts remain machine-checkable. A guided adapter cannot
claim autonomous-engine conformance.

## Autonomous-engine profile

An autonomous engine also MUST demonstrate through its real binary and
boundaries:

- the approval capability is unavailable to the autonomous caller and role
  runners;
- Implementer, Captain, and Verifier instructions, credentials, workspaces, and
  process lifetimes are appropriately isolated;
- Verifier control input is engine-owned and candidate-local configuration is
  review data only;
- evidence admissions are opaque, bound to one exact status and execution
  profile, and cannot be forged from a board row or copied record;
- at most one active writer owns a track and stale writers lose compare-and-set;
- dispatch and effect identities are durable and write-once;
- process count, memory, CPU, output, duration, and writable storage are
  bounded;
- persistence failure never projects protocol success;
- timeout, cancellation, crash, and malformed output never manufacture a
  verdict;
- interrupted external effects reconcile before retry and complete
  idempotently;
- bounded retry exhaustion stops truthfully;
- track and release Merge use expected-target compare-and-set;
- track composition happens once, is idempotent for the same expected head and
  candidate, and transfers all track work together;
- materialisation creates the release and owner marker in one ref transaction,
  and the release permanently retains that marker ancestry;
- assembly preparation changes only the proof and status records over the exact
  pre-preparation release head;
- and replay produces the same Baton projection from the same durable facts.

Provider names, model names, prompt bytes, token counts, and internal engine
event names are not conformance requirements.

## Required transition cases

Positive cases cover initial design, Captain `PROCEED`, `REVISE`, and
`ESCALATE`, candidate proof, Verifier `PASS`, `FAIL`, and `BLOCKED`, exact track
composition, assembly `PASS`, exact release Merge, materialisation, and
pristine-baseline `REBOUND`. Assembly `FAIL` durably returns responsibility to
the Planner; recovery creates a new plan, work, and release identity.

Negative cases mutate one bound fact at a time and cover:

- Captain or Verifier self-review;
- unresolved, substituted, self-declared, or false approval and clean/read-only
  dispatch evidence;
- changed plan, design, proof, candidate, product tree, or target;
- foreign-track writes, missing owner state, and erased dual-ref markers;
- product before Captain `PROCEED`, cross-work record commits, out-of-order work,
  and unmet dependencies;
- durable `active` or `no_verdict`;
- product changes hidden behind record commits;
- a behaviorally consumed record root;
- composition conflict, forged merge tree, or unexpected parent topology;
- stale compare-and-set; and
- rewriting a terminal identity or outcome.

## Board and engine handoff

The reference oracle, terminal view, and WebUI must consume the same
owner-aware projection, including optional assembly status, from bounded reads
of captured refs. That projection proves structural validity and authority
selection only. It does not resolve external evidence or authorize a transition
or Merge. The WebUI may invoke the shared read-only Git oracle; it has no route
that starts an agent, mutates delivery, or executes an operator-supplied
command.

Sworn is the reference autonomous implementation, not a privileged
interpretation. Final Baton 1.0 waits until Sworn passes every published
autonomous case through real Git, persistence, subprocess, recovery, and
integration boundaries.

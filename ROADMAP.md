# Baton roadmap

## RC15.2 — restore slice boundaries and human-readable evidence

`v1.0.0-rc.15.2` restores per-slice plan files, adds advisory evidence
inventories, and lets projects configure their human-readable release-docs
root globally or per project. The machine-readable `.baton` records remain
authoritative.

## RC15.1 — ship the board kit with the skills

`v1.0.0-rc.15.1` preserves RC15's planning behavior and adds the existing
read-only board oracle, terminal renderer, and local Web UI to the generated
install payload. The board remains structural and read-only; Sworn's runtime
ownership and protocol version do not change.

## RC15 — make the plan clear before code starts

`v1.0.0-rc.15` helps the Planner find repository facts before asking the human,
ask only about choices that change the promised result, and wait to present a
plan until those choices are settled. A short plain-language summary gives the
human a chance to correct the meaning first.

Each slice now names one result that can be reviewed alone. Its acceptance
claims must be able to fail in a real product check, and the proposed evidence
must observe the boundary it names. Implementer designs map every acceptance ID
to an approach and evidence. The Captain looks for design gaps and names the
human decision needed when the approved plan cannot answer a material question.

RC15 adds no role, schema, gate, questionnaire, discovery file, response
snapshot, runtime dependency, or wording or layout validator. Fresh semantic
trials are release evidence, not product machinery.

## RC14 — let the engine own its Git attribution

`v1.0.0-rc.14` removes Baton's built-in record, receipt, and merge identities.
Every writing engine supplies one bounded Git name and address explicitly;
Baton never reads that attribution as a role, approval, or authority fact.

Same-identity retries remain object-deterministic. Different valid identities
may change commit object IDs without changing the projected plan, receipt,
candidate, product, or authority meaning. Read-only boards recover historical
identity from the commits they validate, so current configuration does not
rewrite history.

## RC13 — let the target move without restarting the work

`v1.0.0-rc.13` keeps active tracks on their approved working floor while the
same target branch moves forward. Final assembly adds the latest target to the
exact passed work and receives a fresh check. If the target advances again,
only assembly is rebuilt and rechecked.

Rewritten or non-descendant target history pauses as `TARGET_DIVERGED` for
operational reconciliation. It does not automatically create a plan revision.
No role, receipt, schema, gate, or lifecycle stage is added.

## RC12 — say what Baton does in ordinary language

`v1.0.0-rc.12` keeps the same protocol and safety boundaries while rewriting
the words people see first: onboarding, the five skills, examples, errors, and
the terminal and browser board.

Stable roles, verdicts, schemas, fields, error codes, and Git rules do not
change. Technical identifiers remain available after the plain explanation.

## RC11 — recover publication without changing behavior

`v1.0.0-rc.11` republishes the exact RC10 behavior under a fresh immutable
release identity. RC10 remains a valid immutable code tag, but its empty GitHub
release was removed before assets were attached and GitHub permanently prevents
that tag name from being published again.

No protocol, operation, receipt, schema, board, or record-engine behavior
changes in RC11.

## RC10 — reserve records structurally

`v1.0.0-rc.10` removes the false behavioral-inertness capability from the
standalone board. `.baton/releases` is reserved for Baton's record writer and
ignored exactly by product identity. Product scope cannot include it, and a
candidate cannot change it from its implementation base; safe historical
exclusions remain valid.

An invalid projection is a diagnostic and escalation condition, never
permission to bypass the board.

## RC9 — let the running agent install Baton

`v1.0.0-rc.9` removes the maintained client boundary. Baton now ships one
generated payload of five standalone skills. The running agent discovers its
tool's real skills directory, presents the exact change, waits for approval,
and proves native discovery.

The installation contract requires exact preview approval and a final
pre-effect recheck. Partial payloads require a new preview and user direction;
only a complete byte-identical payload is eligible for removal. Older release
state is removed only with that exact immutable release's safe uninstall.

## RC6 — constrain commitment, not cognition

`v1.0.0-rc.6` made operational discovery repair forward. Plans commit
behavior, product surfaces, acceptance, minimum proof, semantic limits,
authority, and real dependencies without pretending to inventory every support
path or check. Material contract changes still cross review and approval.

## RC4 — keep the trusted loop small

`v1.0.0-rc.4` established the lean 1.0 shape:

- five principles and five responsibilities;
- one approved plan with stable release and slice identities;
- compact machine-written receipts;
- five concise canonical operations;
- a Git-derived JSON, terminal, and local browser board;
- forward-only plan revisions and stable attempts;
- exact-candidate composition and fresh verification; and
- reproducible conformance and overhead measurement.

Baton does not package drivers or a scheduler. Sworn owns that operational
layer.

## Final 1.0 — prove autonomous boundaries

The portable profile cannot prove an engine's scheduler, process containment,
credentials, fresh-context dispatch, recovery, cancellation, or final Git
effect. Sworn or another engine must run all autonomous cases through its real
binary and boundaries. Final `v1.0.0` waits for that evidence.

## After 1.0 — earn additions

Candidates include independent engine integrations, useful assurance patterns,
and board interoperability. New capability starts outside the trust kernel and
earns inclusion with evidence.

The standing tests are:

- Does it prevent a demonstrated false green?
- Can it be a project check or engine policy instead?
- Does it preserve one authoritative plan and Git-derived read-only board?
- Does it keep drivers independent of roles and model policy?
- What can be removed or simplified in exchange?

## Deliberate boundaries

Baton does not plan product roadmaps, provide managed inference, bundle models,
hold credentials, select providers, or deploy software. It does not make Sworn
conformance claims on Sworn's behalf.

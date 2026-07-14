---
title: LLM checks
description: The six deterministic LLM check types — the prompt bodies, the shared user-payload contract, and the structured report every check returns. Specification, not implementation.
---

# LLM checks

Baton specifies six **deterministic LLM check types**. They sit alongside the
mechanical gates: a mechanical gate answers a question a parser can settle, an LLM
check answers a question that needs reading comprehension — *does this test actually
verify the thing it claims to verify?*

These are **specification**. The prompt body IS the contract, in the same way a
schema is the contract for a record. An engine that reworded them would be running
different checks under the same names, and a second engine could not be conformant
without them. They live here, not in any one engine.

Engines expose each check by its stable check id. Invocation syntax is adapter-owned and
non-normative; Baton specifies the input, prompt, report, lifecycle, and fail-closed semantics.

## The six checks

| Check | Run by | Reads | Answers |
|---|---|---|---|
| [`spec-ambiguity`](spec-ambiguity.md) | planner | spec + directly referenced artefacts | Is any acceptance criterion vague, incomplete, or underspecified? |
| [`design-review`](design-review.md) | captain | project memory + diff | Does this change conflict with a documented decision? |
| [`ac-satisfaction`](ac-satisfaction.md) | implementer, verifier | spec + diff | Does the code genuinely satisfy each AC? |
| [`security-review`](security-review.md) | implementer, verifier | diff | Does the change introduce a vulnerability? |
| [`semantic-coverage`](semantic-coverage.md) | verifier | spec + test diff | Do the tests genuinely verify their claimed ACs? |
| [`maintainability-review`](maintainability-review.md) | implementer, verifier | diff | Will this code be understandable in 12 months? |

## The contract every check honours

**Deterministic.** Temperature 0. The same slice and the same diff must produce the
same verdict. A check that drifts between runs cannot gate anything.

**Structured output.** Five checks return a single JSON object validating against
[`llm-check-report-v1`](https://baton.sawy3r.net/schemas/llm-check-report-v1.json).
The spec-ambiguity check returns
[`spec-ambiguity-report-v1`](https://baton.sawy3r.net/schemas/spec-ambiguity-report-v1.json),
whose fingerprint-keyed blocking/advisory maps make the material contract
difference explicit and make duplicate triage identities unrepresentable within
each map. Before using a report, the engine also rejects duplicate raw JSON keys
and any fingerprint present in both maps.

The report is *emitted and validated*, never prose-scraped — a check whose verdict has
to be read out of an English paragraph is a check that will eventually be misread.

**Fails closed.** A check that cannot run is a FAIL, not a pass. Absence of evidence
is not evidence of absence (Rule 7).

### Grading: severity and disposition are orthogonal

Every finding has an impact severity and an independent disposition. Keeping
them apart is load-bearing; the schemas encode disposition in two forms:

| Reports | Impact | Disposition |
|---|---|---|
| `llm-check-report-v1` (five checks and legacy ambiguity output) | finding `severity`: `critical` `high` `medium` `low` `info` | finding `blocking`: `true` or `false` |
| `spec-ambiguity-report-v1` | finding `severity`: the same five-value scale | membership in `blocking_findings` or `advisory_findings` |

Each check's prompt states which findings block; that is the only place the
impact-to-disposition decision lives.

**The verdict is derived, not asserted.** In `llm-check-report-v1`, `FAIL`
means at least one finding has `blocking: true`. In
`spec-ambiguity-report-v1`, `FAIL` means `blocking_findings` is non-empty.
Each schema enforces both directions. An engine whose own tally disagrees with
the model's stated verdict must fail closed.

> **Why this is a contract, not a style preference.** These were originally two vocabularies
> in one field: five checks graded `FAIL`/`WARN`/`INFO`, and `security-review` graded
> `critical`/`high`/`medium`/`low`. The reference engine decided whether a check blocked by
> scanning findings for `severity == "FAIL"` — a string `security-review` never emits. The
> security check's blocking logic was therefore dead code, and the gate silently degraded to
> trusting the model's own `verdict`. A model could return `verdict: "PASS"` beside a
> `critical` remote-code-execution finding and the check went green.
>
> That is a Rule 12 failure: a guard whose *scope* was narrower than the *claim* it backed.
> Separating impact from disposition, and deriving the verdict from the findings, makes that
> state unrepresentable rather than merely discouraged.

**Advisory to the role, not a substitute for it.** A PASS from `ac-satisfaction` does
not make a slice verified. The checks are inputs to a role's judgement, and the
verifier still owns the verdict.

### Bounded maintainability lifecycle

Maintainability has two role-specific uses; they are intentionally not equal:

1. The Implementer runs one **readiness preflight** only after deterministic checks are green and
   the semantic implementation diff is stable. A FAIL permits one bounded remediation and one
   closure review.
   The Implementer cannot certify its own maintainability.
2. The fresh Verifier runs one **authoritative gate** against the implemented diff. It records
   PASS or emits a verdict and stops; it never repairs and reruns inside the verifier session.

For each allowed run, a conformant engine MUST:

1. Require a clean worktree and index. Resolve `review_scope.base` from the slice status
   `start_commit` and `review_scope.head` from `HEAD`; record both as full lowercase commit object
   ids. Candidate paths are
   the NUL-delimited output of
   `LC_ALL=C git diff --name-only -z --no-renames --no-relative --ignore-submodules=none <base>..<head>`,
   interpreted as repository-relative byte strings. A path that is not valid UTF-8 fails scope
   construction.
2. Exclude only these path classes, recording every excluded path in `excluded_paths`:
   - every path beneath the physical release root containing the reviewed slice's `status.json`
     (resolve symlinks inside the workspace, then take the status file's grandparent directory),
     which is the release-mode record and evidence tree;
   - paths whose index attributes mark `baton-generated` or `linguist-generated` as `set` or
     `true` (an undeclared generated path is included, never guessed); and
   - files whose basename is one of `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`,
     `bun.lockb`, `go.sum`, `Cargo.lock`, `poetry.lock`, `Pipfile.lock`, `Gemfile.lock`, or
     `composer.lock`.
   All remaining candidate paths are `included_paths`. Sort both arrays by unsigned UTF-8 byte
   order. Path classification is performed from the clean reviewed index at `head`.
3. Construct the semantic manifest used for identity. Start with the exact ASCII bytes
   `baton-maintainability-v1` followed by NUL. For each included path in byte order append: the
   base-10 UTF-8 path-byte length with no leading zero, `:`, the path bytes, NUL, the base Git mode
   or `-` when absent, NUL, the full base Git object id or `-`, NUL, the head mode or `-`, NUL,
   the full head object id or `-`, NUL. Modes and object ids come from the two committed trees, not
   the worktree. Set `input_fingerprint` to `sha256:` plus the lowercase SHA-256 of this manifest.
   This identifies the semantic bytes and mode changes independently of diff presentation or local
   Git configuration.
4. Construct `{{diff}}` for the prompt over the same included paths. Ignore system, global, and
   untracked local diff presentation/driver configuration. Use external diff drivers and text
   conversion disabled, full object ids, binary patches, no rename detection, no colour, the Myers
   algorithm with indent heuristics disabled, exactly three context lines, zero inter-hunk context,
   no function context, short submodule rendering, and literal pathspecs with fixed `a/` and `b/`
   prefixes. A Git-based engine's effective invocation is:

   `LC_ALL=C git diff --no-ext-diff --no-textconv --no-color --no-relative --binary --full-index --no-renames --submodule=short --ignore-submodules=none --diff-algorithm=myers --no-indent-heuristic --unified=3 --inter-hunk-context=0 --no-function-context --src-prefix=a/ --dst-prefix=b/ --line-prefix= <base>..<head> -- <each byte-sorted path as :(literal)<path>>`

   The emitted bytes must be valid UTF-8 or scope construction fails closed. An empty included set
   produces an empty `{{diff}}` and a deterministic PASS report without a model call.
5. Pass that exact scoped diff as `{{diff}}` to `maintainability-review.md`.
6. Emit a valid `llm-check-report-v1` with `check: maintainability-review`, `input_fingerprint`, and
   `review_scope`; set `review_scope.fingerprint_algorithm` to `baton-maintainability-v1`.
7. Fail closed if the scope cannot be constructed, the model call fails, or the report is missing,
   malformed, or lacks the required scope identity.

Within one role session, an existing report with the same `input_fingerprint` is reused without a
new model call. Release-record, generated-output, and lockfile-only edits therefore do not consume
another review. Any change to included semantic bytes produces a different fingerprint.

A closure review applies the same canonical prompt to the complete final semantic diff; it receives
no hidden adapter-specific context and may report any concrete blocker in that final diff. Any
closure FAIL remains `in_progress` and routes to Coach adjudication instead of another review or
refactor in the same cycle. There is no maintainability waiver.

The machine-readable lifecycle lives in `status.json` `maintainability` (defined by
`slice-status-v1`); `journal.md` may mirror it for humans but is not the transition authority. On
the initial repeated FAIL, set `state: needs_coach`, keep `cycle: 0`, and append both reports. The
Coach may choose exactly one of:

- `resume_in_scope`: write the complete adjudication object, set `cycle: 1` and
  `state: resume_approved`. This grants one new preflight/remediation/closure cycle in a fresh
  Implementer context, restricted to `permitted_touchpoints`. Those paths must be a non-empty
  subset of the ratified spec touchpoints; a Coach cannot expand the slice boundary through this
  transition.
- `re_slice`: write the adjudication and set `state: re_slice_required`; `/replan-release` must
  revise the spec before implementation continues.

The Coach writes the decision atomically to status, mirrors it in `journal.md`, commits both, and
pushes the track branch before dispatching another role. A closure-failure handoff follows the same
commit-and-push rule before the Implementer stops; a dirty worktree is never the handoff carrier.

If closure FAILs in cycle 1, set `state: re_slice_required`. A second `resume_in_scope` is invalid;
re-slicing is the only transition. A resumed Implementer proceeds only when the status record is
schema-valid, `cycle` is 1, `state` is `resume_approved`, the adjudication decision is
`resume_in_scope`, its two fingerprints match the cycle-0 reports, and every proposed edit is in
`permitted_touchpoints`, which are themselves a subset of the ratified spec touchpoints. Otherwise
it stops. After re-slicing, the Planner resets maintainability
to the template's initial `pending` cycle-0 record as part of the ratified spec transition.

## The user payload

Each check file's body is the **system prompt**, verbatim. The engine assembles
this common payload for all six:

```text
You are evaluating a slice in a release of {{project_context}}.

{{project_stakes}}

Below is the slice specification, followed by the git diff of the code change.

--- SPECIFICATION ---

{{spec}}

--- GIT DIFF ---

{{diff}}
```

For `spec-ambiguity`, the engine appends this section:

```text
--- REFERENCED ARTIFACTS ---

{{referenced_artifacts}}
```

The engine constructs `{{referenced_artifacts}}` from the spec's typed
`references` array and **only** that array. It never scans `rationale`,
`in_scope`, `out_of_scope`, AC text, `touchpoints`, or `test_refs` for reference
discovery. The workspace root is the physical canonical path returned by
`git rev-parse --show-toplevel` when run from the repository containing the
reviewed spec; failure to obtain it fails the check closed.

When `references` contains `contract` or `slice`, `spec.release` is required by
`spec-v1` and is a single safe identifier segment. Before resolution, the engine
requires the reviewed spec's physical repo-relative path to be exactly
`docs/release/<spec.release>/<spec.slice_id>/spec.json`; a missing release, a
directory/spec mismatch, or a non-canonical source path fails the check closed.

Each reference object has exactly one of these schema-validated forms:

- `{"kind":"contract","contract_id":"C-NN"}` loads
  `docs/release/<spec.release>/contracts.json`, requires its top-level `release`
  to equal `spec.release` byte-for-byte, and requires exactly one matching entry.
- `{"kind":"slice","slice_id":"<id>"}` loads
  `docs/release/<spec.release>/<id>/spec.json`, requires its `release` to equal
  the reviewed `spec.release` byte-for-byte, and requires its `slice_id` to equal
  the referenced id byte-for-byte.
- `{"kind":"file","path":"<path>"}` loads that workspace-root-relative
  regular file.

File paths use `/` separators; have no NUL, backslash, leading or trailing `/`,
empty segment, `.` segment, or `..` segment; and must be unchanged by POSIX
lexical clean. The engine joins the segments beneath the workspace root,
resolves symlinks, and requires the physical target to remain beneath that root.
The generated contract and sibling-slice paths pass through the same lexical
clean, join-beneath-root, symlink-resolution, and physical-confinement checks as
file references. Any lexical, source-path, or confinement violation fails the
check closed before model dispatch. All resolved output paths are rendered with
`/` separators relative to the root.

The engine emits each resolved UTF-8 artefact in bytewise repo-relative-path order as
`--- ARTIFACT <repo-relative-path> ---`, one LF, its verbatim bytes, and one LF.
The same path is emitted once even when referenced repeatedly. Each typed
reference has one fixed key: `contract:<contract_id>`, `slice:<slice_id>`, or
`file:<path>`. Failed references follow resolved artefacts, sorted bytewise by
that key, and render exactly
`UNRESOLVED <reference-key>: <missing|non-regular|unreadable|invalid-utf8|invalid-json|schema-invalid|record-release-mismatch|contract-id-missing|contract-id-duplicate|slice-id-mismatch>`.

Resolution evaluates conditions in this fixed order and stops at the first:
spec/schema validity; workspace-root and canonical source-path agreement;
lexical path validity; lexical and physical workspace confinement; existence;
regular-file type; readability; UTF-8 validity; JSON and applicable Baton-schema
validity for `contracts.json` or a sibling `spec.json`; loaded-record release
identity; then matching contract-id count or sibling `slice_id`. A missing or
non-equal loaded `release` emits `record-release-mismatch`. For a contract
reference, zero matching IDs emits `contract-id-missing` and more than one emits
`contract-id-duplicate`; exactly one continues. The first four classes fail the
check before dispatch; a failure in the remaining classes emits the corresponding
safe `UNRESOLVED` reason. A reference is never silently omitted and the engine
performs no network fetch. Resolution is one level deep: references discovered
only inside a supplied artefact are not recursively loaded. The check may judge
only the spec and this supplied section.

### `{{project_context}}` and `{{project_stakes}}` — declared, not guessed

Both are filled from the project's **declared** context record
([`project-context-v1`](https://baton.sawy3r.net/schemas/project-context-v1.json)) — a
hand-authored, version-controlled file in the repo. They are **required** substitutions,
not defaults.

`{{project_context}}` completes the sentence *"You are evaluating a slice in a release
of ___"* — for example *"a Next.js and TypeScript frontend with a Go backend on
Postgres"*. A check that tells the model it is reading a Go CLI while it reads
TypeScript grades against the wrong priors, quietly and in the model's favour.

`{{project_stakes}}` renders the record's `stakes` — production, real users, sensitive
data, regulatory regime. **The security-review check acts on it mechanically**: at high
stakes a `medium` finding is blocking, not advisory. An information leak is a different
severity in a prototype than in a live system holding customer financial data, and the
check must be told which it is looking at.

> **Why declared and not detected.** An engine can infer a project's *languages* from its
> files. It cannot infer whether the system serves real customers or holds money — and
> that is exactly what should move a finding from advisory to blocking. Detection is a
> guess; a guess handed to the model as a fact is graded against as a fact. An engine that
> falls back to detection **must say so** (surface it as inferred, not declared), and must
> treat unstated stakes as **high**: an undeclared system is not a safe one, it is an
> unexamined one.

### How the record gets written: elicited → ratified → durable

The same three-step Rule 10 applies to journeys, for the same reason — and nobody
hand-writes a good one from a blank file.

1. **Elicited.** At project setup, the engine has the adopter's model already configured
   (it needs one to run the checks at all). It uses **that** model to *draft* the record by
   reading the repo: the stack, the frameworks, the data layer, and a **proposal** for the
   stakes — a model can see the auth code, the payment integration, the schema holding
   customer records.

2. **Ratified.** A human reviews and edits the draft, then ratifies it. The model can read
   the code; it cannot know whether *real people depend on this today*. That is a business
   fact, and it is the one that decides whether a `medium` finding blocks. **An unratified
   record is a proposal, not a declaration: its stakes are treated as HIGH until a human
   confirms otherwise.** A proposal may raise the bar; it may never lower it.

3. **Durable.** The record is committed. Every session, every teammate, and CI all read the
   same context — instead of each re-guessing it from directory names.

> **The elicitation call is the adopter's, not the protocol's.** It runs through the
> adopter's own configured model and credentials, against their own provider. Baton
> specifies no hosted service and no phone-home, and an engine must not introduce one here:
> drafting this record means sending repository content to a model, and where that content
> goes is the adopter's decision — a data-residency and privacy question, not a convenience
> one. An engine with no model configured must fall back to detection and label it inferred,
> never silently reach out to a third party to fill the gap.

`{{spec}}` is the slice's `spec.json` rendered to readable form (ADR-0009); a
pre-migration `spec.md` may be passed verbatim.

Checks that read no spec (`security-review`, `maintainability-review`,
`design-review`) omit the specification section. `design-review` substitutes the
project's memory / decision records for it.

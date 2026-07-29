# Baton agent-led installation

Status: Captain `PROCEED`
Release: `v1.0.0-rc.9`
Slice: `P1-client-portability`
Base: `a8fdb397e0839bdc58ad4b865e163dd37654752c`

Captain decision: `codex:/root/rc9_portability_captain`, bound to design
SHA-256 `30ff768e89b5bc3dd4fb43c643d92276385fd20067b37fe7f49b0f5ec3d91bdc`
and Git blob `fde0399f77d1e017ba4b32789244a089a337781d`.

## Decision

The agent already running in a client installs Baton.

Baton will not maintain a client allow-list, client path catalog, or one
installer per client. Those details change independently of Baton and the
running agent is best placed to resolve them from its current environment and
current client documentation.

RC9 will ship one client-neutral Agent Skills payload and a short installation
contract. The contract tells the agent to:

1. check out the exact requested Baton tag;
2. identify the current client's user or project skills directory without
   guessing;
3. show the source, destination, existing Baton files, and intended changes;
4. wait for approval before writing;
5. preserve unrelated or user-modified files; and
6. prove that the client discovers all five installed skills.

Client names may appear as examples. They are never support boundaries.

## Smallest product change

- Generate one portable set of the five `baton-*` skills.
- Make each installed skill self-contained. The plan skill carries its small
  plan template as a relative reference; no client-specific support path is
  required.
- Remove the Claude/Codex adapters, wrappers, transactional installer,
  historical install fixtures, and client-path code from the live product.
  Git retains their history.
- Keep protocol, conformance, records, and board code in the repository. They
  are engine and project tools, not hidden dependencies of an installed skill.
- Document agent-led install, update, and removal in plain language.

No generic installer is retained. Attempt 1 tested a bounded exception, but
the Verifier failure recorded below showed that the contract is both smaller
and safer.

## Compatibility

RC9 does not silently rewrite an RC2-RC8 install. When an older installation is
found, the agent validates the exact legacy installation and completes that
immutable release's own safe uninstall before RC9 is eligible. If the legacy
release, ownership, or bytes cannot be established exactly, stop. RC9 has no
direct replacement lane.

This is an RC boundary, not a protocol change. Existing delivery records and
Sworn integrations are unaffected.

## Acceptance

1. Generated output contains exactly five client-neutral skills and no host
   adapters.
2. Each skill contains the exact canonical operation text. `baton-plan` can
   resolve its bundled template without a separate Baton installation.
3. Repository checks fail if generated skills drift from their sources.
4. README and INSTALL lead with one copyable self-install request and contain
   no maintained client matrix.
5. A clean-context agent can install into at least two materially different
   clients by following the contract, without Baton knowing either client's
   path.
6. Protocol, board, record, and conformance suites remain green.
7. The RC9 diff removes substantially more installation code and prose than it
   adds.

Captain corrections also require exact legacy uninstall rather than overwriting
files still claimed by RC2-RC8 state, immutable provenance for every payload
file, complete-tree comparison before update or removal, and clean-context
discovery checks for OpenCode, Hermes Agent, Cline, and one materially
different client. Those checks are release evidence, not a product allow-list.

## Clean-context discovery evidence

On 2026-07-29 the exact payload
`sha256:792a1a558c8b228801f4c7fcb55b89a1272d00651baa2e24e240b46ba0a5519c`
was copied into isolated temporary homes. Native discovery returned exactly the
five expected Baton skills in each clean context:

- OpenCode 1.18.5 with `opencode debug skill --pure`;
- Cline 3.0.47 with `cline ... config skills --json`;
- Gemini CLI 0.52.0 with
  `GEMINI_CLI_HOME=<temp-home> gemini skills list`; and
- Hermes Agent 0.19.0 from official source
  `cbecd72e976a59e4c4b8277086abaa59ab3dc510` with
  `hermes skills list`.

Every copied tree matched `skills/baton-*`, including
`baton-plan/templates/plan.md`. The probes changed no user configuration or
credentials. These are release-evidence clients, not a maintained product
catalog or support boundary.

## Attempt 2 correction

Captain `codex:/root/rc9_discovery_evidence` returned `PROCEED` for design
SHA-256 `2acca08920d265fa16af77ec11ed2ba8e0b0fd269a2e1533a797813358d6f0bf`.
Verifier `codex:/root/rc9_fresh_verifier` failed candidate
`7b725f86a7e0e9dea1887ac3245e01dc678bd9d4`: its helper adopted or removed
partial state, did not fully bind preview approval, and overstated interrupted
effect recovery. The lesson is that the running agent can enforce the required
invariants more simply than a second installer state machine and simulation
suite.

The final smaller decision deletes that helper and suite. Approval binds the
exact release commit, payload digest, canonical destination, complete
relative-path change set, and observed state, all rechecked immediately before
effects. Partial payloads require a new preview and user direction; only a
complete byte-identical expected set is removable. Updates remove the approved
old payload before a separate new preview. RC2-RC8 retain their immutable
release uninstall. Interruption requires inspection and a new preview, with no
journal, staging, or post-recheck concurrent-writer claim.

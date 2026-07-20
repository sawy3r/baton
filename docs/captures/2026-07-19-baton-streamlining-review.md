# Baton protocol streamlining review — 2026-07-19

**Scope:** Deep review of the Baton protocol (rules, role prompts, LLM checks, track mode, schemas) and its reference implementation usage, requested by Brad with the hypothesis: "80% of the value at ~20% of the overhead — streamline without losing autonomous delivery without compromising quality."

**Method:** Read all four role prompts in full, track-mode.md, llm-checks/README.md, AGENTS-fragment.md, README.md, ROADMAP.md, release-verify.sh structure, Sworn repo layout + CLI surface, a real track-branch history (sworn-worktrees release-2026-06-30 T1), and the baton repo's protocol-touching git log.

---

## 1. Diagnosis — where the cost actually lives

Protocol cost per slice decomposes as:

```
cost = (sessions/slice × protocol-reload/session) + (LLM checks × diff payloads) × failure-multiplier
```

All three terms are inflated.

### 1a. Session count: 4–5 fresh sessions + human dispatches per slice, happy path

1. `/implement-slice` design pass — fresh session → design.md → halt
2. `/design-review` captain — fresh session → pins → Coach ack
3. `/implement-slice` resumed — fresh session → code → proof.json → `sworn verify` → maintainability preflight
4. `/verify-slice` — fresh session → 8 gates, 3–4 LLM checks

Plus replan / forward-merge / merge sessions on any deviation. Each session is a cold CLI subprocess start (`claude-cli/` / `codex/` drivers).

### 1b. Per-session protocol reload: ~15–28k tokens before any work

Measured word counts (×1.33 ≈ tokens):

| Artefact | Words | Read by |
|---|---|---|
| verifier.md | 6,014 | verifier |
| implementer.md | 3,873 | implementer ×2 sessions |
| captain.md | 4,462 | captain |
| planner.md | 7,421 | planner |
| track-mode.md | 3,058 | all roles |
| llm-checks/README.md | 4,977 | implementer + verifier |
| CLAUDE.md rules fragment | ~3,000 | every session in every project |
| slice artefacts (spec/status/journal/proof/design/review) | 3–8k | per role |

Happy-path total: **~80k tokens of protocol reading per slice**, plus 3–6 LLM-check invocations each carrying the full scoped diff. All-in protocol overhead plausibly 100–200k tokens/slice before the implementer's actual code work. (Estimates, but the word counts are measured.)

### 1c. Incident scar tissue — the accretion pattern

The prompts are layered with incident-derived defensive clauses: the BLOCKED/INCONCLUSIVE split (S28 incident), Playwright port-pinning (capital-allocation S05a), verifier-owns-dev-stack (stale-binary FAILs), the idempotent-BLOCKED short-circuit, "recurrence is evidence", "the tell", the bounded maintainability FSM with git-archaeology scope construction (~200 lines in llm-checks/README, re-paraphrased in both implementer and verifier prompts). Git log confirms: ~25 protocol-touching commits since early June, predominantly `fix(...)` hardening. **Every clause is individually justified by a real incident; collectively they are the token budget, and the protocol has no sunset mechanism.** Each clause is paid in every session of every slice forever, and each additional clause dilutes attention on the load-bearing ones.

### 1d. Double-paid deterministic checks

The six LLM checks are specified **deterministic** (temp 0; same input → same verdict). Yet: ac-satisfaction runs at implementer *and* verifier; security-review same; maintainability up to 3× per cycle × 2 cycles. The verifier re-runs "because Rule 7 forbids self-certification" — but Rule 7's boundary is about **verdict certification**, not re-execution of a deterministic function. The fingerprint machinery to prove byte-identical inputs already exists for maintainability (input_fingerprint / review_scope) and was not generalised. Caveat: provider-side model drift means "deterministic" holds only within a pinned model + short time horizon — reuse must be scoped accordingly.

### 1e. One-stakes-fits-all gating

A copy-edit slice and a schema-migration slice run the identical 8-gate gauntlet. The protocol already contains the stakes seeds (project-context stakes, Rule 9 Type-1/Type-2, ci-authoritative gates) but uses them only to *add* machinery, never to *skip* it.

### 1f. Duplication

- `~/.claude/baton/*.md` and `~/.claude/baton/rules/*.md` hold byte-identical copies of the rule docs (verified: requirements-fidelity, proof-bundle identical).
- The maintainability scope algorithm is specified three times: llm-checks/README (canonical), verifier.md, implementer.md (paraphrases). Three copies of one algorithm = 3× tokens + drift surface.

---

## 2. The essence — ranked by "deleting this collapses trust"

1. **Rule 7 fresh-context adversarial verdict.** THE core. A done-claim certified by a session that didn't make it.
2. **Rule 6 proof bundle from live state.** Makes (1) cheap and possible; kills paraphrased completion claims.
3. **Rule 1 reachability.** Kills the most common overclaim class (dark code).
4. **Rule 2 deferral teeth (why + tracking + acknowledgement).** Cheap, high value.
5. **A concrete per-slice contract** (verifiable ACs). The verifier needs something to verify against. Does not require the full ISO-29148/EARS/RTM apparatus on every slice.
6. **Rule 9 Type-1 human gate.** The authority boundary is what makes the loop safe to leave unattended.

Everything else — full requirements-fidelity stack, maintainability FSM, track-mode parallelism machinery, journeys/assembly/QA-runbook, guard-fidelity meta-gate, captain-as-separate-session — is **machinery in service of the six**, and is legitimately stakes-questioned.

## 3. The streamlining moves (dependency-ordered)

### Move 1 — Prompts: from "teach + enforce" to "enforce"; mechanism into the binary
Every git procedure currently specified in prose (scope construction, projection-integrity gate, drift gate, merge recognition, blocked short-circuit) moves behind `sworn preflight <role> <slice>`: deterministic, tested, run once. The prompt says "run it; non-zero ⇒ STOP with its output." Incident narratives move to the rule docs (provenance for designers, noise for executors); prompts keep one-line rationale + pointer. Delete the duplicated rules/ tree. One canonical statement per mechanism.
**Savings: role prompts ~60–70% smaller (verifier 6k→~1.5k words). Strictly more reliable: prose enforcement → deterministic enforcement.**

### Move 2 — Fold the captain session for Type-2 slices
Rule 9 already keys the design gate to stakes. Type-2 (reversible, narrow) slices: implementer writes design.md, the deterministic designfit gate validates classification, Coach acks directly (they already read the pins), verifier's Gates 1–2 review the realised design retroactively. Full captain session retained for Type-1 / architecturally-significant only — where the pre-code review actually pays.
**Savings: 1 of 4 sessions for the majority of slices. Risk controlled by the existing fail-closed Type-1 classification gate.**

### Move 3 — Fingerprint reuse for all deterministic checks
Generalise input_fingerprint to ac-satisfaction / security-review / semantic-coverage. Verifier reuses the implementer's report when the scoped diff is byte-identical (same pinned model, same release window); re-runs only when bytes differ. The fresh verifier still owns the **verdict** — reads the report adversarially, certifies or rejects. Deterministic re-execution adds zero information.
**Savings: ~6 model invocations → ~3 happy path; zero trust-model change.**

### Move 4 — Stakes-tiered slice paths
Planner assigns `stakes: low|standard|high` (default standard; designfit fails closed on Type-1/stakes mismatch; verifier may upgrade mid-gate, never downgrade):
- **low** (copy/style/config/test-only): implement + fresh verify, Gates 1–5 (reachability, touchpoints, tests, deferrals, delivered-scope). No maintainability LLM gate, no captain session, no semantic-coverage. ~2 sessions, ~10–15k tokens protocol, 0–1 checks.
- **standard**: today's path after Moves 1–3. 3 sessions, 3 checks.
- **high** (Type-1, auth/money/data-model, high project stakes): **today's full path, uncut.**
This is the honest 80/20: heavy machinery runs exactly where reversibility × blast-radius says it pays.

### Move 5 — Make failure cheap instead of failure-proof; institute clause sunset
Much prompt bulk exists to prevent *expensive* retry loops. When re-verify costs minutes, the posture shifts from prevent-every-mode-in-prose to detect-route-retry. Keep the machine-readable routing (STATE blocks, BLOCKED→replan, INCONCLUSIVE→re-verify); drop narrative retellings; replace the "recurrence is evidence" prose heuristic with a deterministic verdict counter (3 verdicts ⇒ auto-escalate). **Every incident-derived clause gets a `sunset-review:` date; quarterly it is deleted or folded into the binary.**

### Move 6 — The verifier brief
`sworn verify` extends to emit one pre-computed artefact: scoped diff, AC↔test mapping, deferral resolutions, guard-fidelity flags. The fresh verifier reads the brief instead of re-executing a dozen git incantations. ~40% verifier-session token cut; removes the git-procedure bulk that Move 1 depends on.

### Move 7 — Loop driver: warm process, cache-stable prompts
Fresh-*context* ≠ cold process (Rule 7: "same model, fresh window, artefact-only inputs is sufficient"). A wiped context in a warm driver satisfies the boundary; `sworn loop` currently pays full CLI init per dispatch. Separately: role prompts substitute `<slice-id>` at the **top** of the prompt, busting provider prompt-cache prefixes — move slice parameters to the end so the multi-thousand-word contract is byte-stable and cache-hits across slices.

### Explicitly NOT cut
Fresh-context verdict; live-state proof bundle; reachability evidence; Rule 2's three legs; Type-1 human gate; the deterministic binary gates (trace, coverage, designaudit, mock-boundary — the best value-per-cost in the whole system: no model, no prose, fail-closed).

## 4. Quantified expectation (estimates; measured inputs)

| Path | Sessions | Protocol tokens | LLM checks | vs today |
|---|---|---|---|---|
| Today, standard slice, happy path | 4–5 | ~80k | 3–6 | 1× |
| Proposed standard | 3 | ~25–30k | ~3 | ~3× cheaper |
| Proposed low-stakes | 2 | ~10–15k | 0–1 | ~6–8× cheaper |
| Proposed high-stakes | 4–5 | ~80k | 3–6 | unchanged — by design |

Failure paths improve more than happy paths: fingerprint reuse means re-verify after a *record-only* change costs no model calls, and the verdict counter caps burn at 3 rounds. (Observed anchor: S01-d6-record-reconciliation took ~30 commits and an estimated 8–12 sessions through design pins → replan → BLOCKED → replan → re-verify.)

## 5. Honest risks

1. **Scar tissue is load-bearing somewhere.** Each clause removal must make its incident impossible-by-construction (binary) or cheap-to-retry — not merely unlikely. A clause-by-clause audit with the incident list is the real work of Moves 1/5.
2. **Stakes gaming.** Planner labels high as low → dangerous work on the fast path. Mitigations exist in-protocol (designfit fails closed on Type-1 misclassification; verifier upgrades never downgrades) but must be wired to the stakes field deterministically.
3. **Determinism is empirical.** Temp-0 is not bit-stable across provider model updates. Fingerprint reuse must pin provider+model and stay within a short horizon; a model-version bump invalidates reuse (fail closed to re-run).
4. **Prompt compression can lose compliance-motivating rationale.** Keep one-line "why" + pointer, never bare imperatives.
5. **Dependency order matters.** Move 3 (reuse) is only safe once scope construction is wholly binary (Move 1). Sequence: dedupe + binary preflight → verifier brief + prompt compression → fingerprint reuse → stakes tiers → sunset process. Each ships independently; each is measurable via the telemetry Sworn already collects.

## 6. The one-sentence version

Baton's trust comes from *who certifies* (fresh-context adversary) and *what humans decide* (Type-1 gate); its cost comes from *re-teaching the mechanism in prose to every session* and *re-executing deterministic checks to prove a point about certification* — so keep the verdict adversarial and the boundary human, move mechanism into the binary, reuse deterministic evidence, and spend the heavy machinery only where stakes say it pays.

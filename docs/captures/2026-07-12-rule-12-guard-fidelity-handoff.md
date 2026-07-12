# Handoff: Rule 12 (Guard Fidelity) + Rule 8/9 amendments

**For a session working in `sawy3r/baton`.** Self-contained — you do not need access to the source monorepo. Everything you need is here.

**This repo is PUBLIC.** The source project is never named in Baton docs; existing rules say *"the source project's monorepo"* and cite component/file names but no product identifiers. Honour that. A draft is already scrubbed (checked: no product name, no brand tokens, no private issue numbers), but re-check anything you add.

---

## What is being proposed

Three changes, each derived from a **specific, costed failure** in a real release. Between them they account for **eleven fresh-context verification failures across two slices**.

Baton was checked first and has **nothing** on any of them:
- `"mutation"` appears only in Rule 11 — a different sense entirely (process-global state).
- `"quantifier"` and `"unbounded"` appear **nowhere**.

| | change | status |
| --- | --- | --- |
| **Rule 12 — Guard Fidelity** | **NEW rule** | **drafted**, needs landing + integration |
| **Rule 8 — Requirements Fidelity** | amendment: an AC must be **bounded** | proposed, not written |
| **Rule 9 — Design Fidelity** | amendment: **prevalence is not correctness** | proposed, not written |

---

## 1. Rule 12 — Guard Fidelity (NEW)

**The complete draft is in this repo: `guard-fidelity.md` (untracked, at the root).** It was moved here from the local install so it lives with its reviewer. Review the wording, then place it where the other rule docs live and integrate it.

### The rule, in short

A **guard** is any automated check that prevents a class of defect recurring: a regression test, a lint rule, a CI gate, an invariant. Before a guard may be cited as evidence in a proof bundle (Rule 6) or relied on by a verifier (Rule 7), it must satisfy four conditions:

1. **Mutation proof.** Break the thing it protects, observe red, restore, observe green. Record both. *A guard that has never failed is not a guard.*
2. **Scope parity.** The domain the guard **checks** must equal the domain the claim **quantifies over**. *A check narrower than its claim is a decoration — and worse than no check, because it converts an unknown into a false assurance.*
3. **Mutate the form the defect ACTUALLY takes** — not the form you imagined. **This is the condition that is nearly always violated.**
4. **Right instrument.** If detection requires resolving scope, bindings or structure, use a **parser**, not a pattern match. *A regex over a structured language is a guess that looks like a check.*

**Corollary — quantifier discipline:** *"no X exists"*, *"every Y is Z"*, *"this is machine-checked"* — each is **a promise about a search you have not run.** State it only if a check covers that whole domain; otherwise bound the claim to the search you actually ran.

### Why it is not already covered

**Rules 6 and 7 both assume the *evidence* is sound.** Rule 12 closes the gap underneath them: **the evidence itself can be structurally incapable of detecting the defect it claims to prevent** — and neither a proof bundle nor a fresh-context verifier will notice, because both see the same green.

A guard fails in one of two ways, and the second is the dangerous one:
- **loudly** — red on correct code. Annoying, self-correcting.
- **silently** — green over a domain it never searched. This **adds confidence while removing safety**, and is indistinguishable from success at every layer above it: the implementer's proof cites it, the verifier runs it, CI enforces it, and the defect ships.

### The provenance, which is the argument

One guard — enforcing that UI components own their own styling — failed fresh-context verification **four consecutive times**, each a new disguise of one error: *the check's scope was narrower than the claim it backed.* It was defeated in turn by:

1. **No word boundary inside an identifier.** `/\bfieldClassName\b/` does not match `termFieldClassName`. A clone shipped while the guard's own name claimed it caught "every incarnation".
2. **A tag scanner that stops at the first `>`.** In JSX that is routinely the arrow in `onChange={(e) => ...}` — long before `className`. *(The codebase already contained a brace-aware scanner whose doc comment warned about this exact bug. It was walked into anyway, ten lines below the warning.)*
3. **Literal-only class reading** — `className={someConst}` invisible.
4. **Template literals** — `` className={`${a} ${b}`} `` where the extractor's `[^}]*` truncated at the first interpolation.
5. **`cn()` / `clsx()` composition.**
6. **Double-quoted bindings** (the resolver handled only single quotes).
7. **A basename-anchored exemption** — `/Input\.tsx$/` exempts *any* `Input.tsx`, anywhere.
8. **An incomplete file list** — two whole applications outside the glob.
9. **A missing element type** — `<textarea>` was never in the list, so a textarea had **no owner and went back to improvising**.
10. **Fill-only surfaces** — the guard required a border *and* a radius, and the style the slice itself introduced was fill-first.

**THE DETAIL THAT MAKES THIS A RULE:** **every one of those guards passed its author's own mutation tests.** Each author dutifully broke the thing, watched red, restored, and recorded the proof — because each mutated the form they **imagined**, and every real defect used a form they did **not**. That is why conditions (1) and (2) are insufficient alone, and why (3) exists.

A sibling slice failed **seven** times on the same root cause in prose rather than code: a documentation guard asserting the **absence of a known-bad string** rather than the **presence of the truth**, sitting green while the document stated a falsehood.

Two live WCAG failures in that codebase — a primary button at 3.29:1 against a 4.5:1 floor, and a mobile touch target at ~20px against a 24px minimum — had shipped and persisted for the same structural reason: **there was no guard for them to violate.** Neither was ever *chosen*. Both were drifted into.

> *A guard that has to be clever is a guard that will be outsmarted. Ask "is this a field at all?" before "is this styled like a field?" — the first needs a substring search, the second needs a compiler.*

---

## 2. Rule 8 amendment — an acceptance criterion must be BOUNDED

**Add to `requirements-fidelity.md`.** Not yet written.

Rule 8 already requires each AC to be *verifiable* (ISO/IEC/IEEE 29148). That is necessary and **not sufficient**: an AC can *look* verifiable and be **unbounded**, and an unbounded AC produces a **non-terminating verification loop**.

> **An acceptance criterion whose satisfaction cannot be enumerated is not verifiable, however verifiable it sounds.** If an AC quantifies over an open domain (*"no claim in the doc that the code contradicts"*, *"the system is secure"*, *"the API is consistent"*), it cannot be **discharged** — only failed again. Bound it to a named, enumerable set and make each member machine-checkable. Everything outside the bound is explicitly **non-normative** and must be declared so.

**Evidence.** A slice failed fresh-context verification **seven times**. **Not one failure touched the AC's named items.** Every one lived in an `in_scope` clause reading *"no claim in the doc that the code contradicts"* — which asks a prose document to be verifiably true about an entire monorepo. That is not a criterion; it is an infinite regress with a checkbox.

**The tell, and it generalises:** the guard suite sat **125-green while the document could have claimed the wrong font and a non-existent component variant** — two of the four items the AC named **by name**. The tests had grown large and were **not converging on the contract**, because the contract had no edge to converge on.

The fix — bounding the AC to its six named items and machine-checking **all six** — was simultaneously a **narrowing** (of the claim) and a **strengthening** (of the enforcement). **That combination is the signature of a correctly bounded AC**, and is worth stating in the rule as the test for whether a bounding is honest or a dodge.

---

## 3. Rule 9 amendment — prevalence is not correctness

**Add to `design-fidelity.md`.** Not yet written.

> **"Most of the code already does X" is a reason X spread. It is not a reason X is right.** A design or architecture decision ratified on prevalence **launders an existing defect into an official standard.**
>
> When proposing a decision from an audit or inventory, **separate the prevalence finding from the recommendation** — they are two different claims. And **run the domain's quality check on the incumbent before ratifying it** (contrast, a11y, performance, correctness — whatever the floor is). If the incumbent fails that floor, prevalence becomes an argument **for** change, not against it.
>
> **The tell:** any decision whose rationale is *"this ratifies reality"* / *"it follows the code's gravity"* / *"it minimises migration"*. Those are **cost arguments dressed as design arguments.** They may still be right — but they must be argued **on cost**, openly, not smuggled in as correctness.

**Evidence.** A Type-1 decision ratified the product's primary button colour, explicitly reasoned as *"follow the code's actual gravity: 60 files already do this."* **White text on that colour measures 3.29:1. WCAG AA requires 4.5:1.** The decision would have made a button whose own label fails accessibility the **official design standard**. It was caught only because the human said *"it's too loud"* — and the loudness and the contrast failure turned out to be the **same defect**.

**This is the structural failure mode of every codification or consolidation effort.** The audit is necessary — you cannot uplift what you cannot see — but it is **descriptive**. It cannot distinguish a convention from a bug, because both look identical when the only evidence is *"most files do this."*

Pairs with Rule 9's existing human-ownership stance: **the machine can prove a colour fails a contrast ratio; it cannot notice that a button feels like it is shouting.**

---

## The thread connecting all three

| layer | the failure | rule |
| --- | --- | --- |
| the **check** | scope narrower than the claim it backs | **12** |
| the **criterion** | unbounded, so it can never be discharged | **8** |
| the **decision** | prevalence mistaken for correctness | **9** |

**In every case: a claim was made wider than the evidence that backed it.** Rule 12 catches it in the code, the Rule 8 amendment in the spec, the Rule 9 amendment in the decision. Worth saying explicitly somewhere — it is the unifying idea, and it is what makes these three a set rather than three unrelated additions.

---

## Work to do in this repo

1. **Land Rule 12.** The draft is already here as `guard-fidelity.md` (untracked, repo root). Review the wording - it is a first draft - and move it into place alongside the other rule docs.
2. **Integrate it** — Rule 12 touches the same files every rule addition does:
   - `AGENTS-fragment.md` — currently lists **11** rules; add the 12th block (this fragment is what projects paste into `AGENTS.md`/`CLAUDE.md`, so the summary must be tight).
   - `RULES-HISTORY.md` — add the cycle entry with provenance.
   - `README.md` — the rule list and the "Rules 1-5 standalone / 6-11 harness" framing needs updating to 6-12.
   - `CLAUDE-md-user-level.md`, `INSTALL.md` — check whether they enumerate rules.
3. **Decide where Rule 12 sits in the priority order.** It is arguably *upstream* of Rules 6 and 7 (it governs whether their evidence means anything), which is an argument for a low number rather than 12. Numbering is disruptive though — a judgement call, and worth raising rather than silently choosing.
4. **Write the Rule 8 and Rule 9 amendments** into their docs. They modify existing rules, so they want more care than an append.
5. **Consider a `role-prompts` change.** The verifier prompt is the natural place to enforce Rule 12: *"before accepting a guard as evidence, mutate the form the defect actually took and confirm the guard fails."* Without that, Rule 12 is advisory — and this whole session is a demonstration that advisory rules lose.
6. **Public-repo check before pushing.** Scrub any product identifiers, brand tokens, or private issue numbers. The Rule 12 draft is already clean; anything you add may not be.

## A note on the install

The local install at `~/.claude/baton/` is a **copy**, not a symlink to this repo. Changes here do **not** propagate to it automatically, and vice versa. The Rule 12 draft has been **removed from the install** (it was never wired into `AGENTS-fragment.md` or `RULES-HISTORY.md`, so nothing there depended on it) and now lives only in this repo. **Once Rule 12 lands here, re-install to pick it up.**

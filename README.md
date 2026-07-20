# Baton

Baton is a small protocol for autonomous software delivery whose completion
claims can be trusted.

Its trust kernel is five principles:

1. **Bounded Authority** — autonomy stays inside an approved contract.
2. **Durable Truth** — records and repository facts outrank session claims.
3. **Real Evidence** — proof exercises the boundary the claim is about.
4. **Independent Verification** — no builder certifies its own candidate.
5. **Safe Composition** — only the exact verified candidate is integrated.

```text
approved plan -> builder -> exact submission -> fresh verifier -> safe integration
                       FAIL -> repair       INCONCLUSIVE -> reverify
                  SPEC_BLOCK -> new authority or contract
```

On the normal path Baton requires two model roles: a builder and a fresh
verifier. Heavy review is added only by risk-selected assurance packs.

The 1.0 protocol is a release candidate. Passing the portable record suite is
necessary but not sufficient: the final `v1.0.0` tag waits until a real engine
passes every published Git, persistence, subprocess, sandbox, and recovery case.

## What is here

- [`baton/CORE.md`](baton/CORE.md) — the one-page trust kernel;
- [`baton/PROTOCOL.md`](baton/PROTOCOL.md) — the minimal loop and outcome routing;
- [`baton/ASSURANCE.md`](baton/ASSURANCE.md) — Standard and Assured profiles;
- [`baton/CONFORMANCE.md`](baton/CONFORMANCE.md) — behavioral obligations;
- [`schemas/`](schemas/) — four strict delivery-record shapes plus compact
  assurance-policy and control-receipt schemas; and
- [`conformance/`](conformance/) — positive, negative, and engine scenarios.

Start with the [example delivery plan](examples/standard-plan.json).

## What is not here

Baton does not ship prompts, slash commands, installers, model policy, a Captain
handbook, Git recipes, a mutable status machine, or a universal cascade of LLM
checks. Those were Baton 0.x implementation procedures. The useful guarantees
now live in the five principles, strict records, engine invariants, and optional
assurance packs.

Sworn is the reference engine. Baton remains a pure protocol: another engine can
conform without copying Sworn's commands, storage, prompts, or UI.

## History

Baton 1.0 is a clean break. The complete 0.x protocol remains at the immutable
[`v0.16.0`](https://github.com/sawy3r/baton/tree/v0.16.0) tag. There is no
dual-read or compatibility layer. See [the compression rationale](baton/RATIONALE.md).

## License

[MIT](LICENSE)

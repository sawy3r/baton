# Baton conformance

Baton separates evidence the portable reference kit can produce from evidence
that only a real autonomous engine can produce. The checked-in manifest has one
profile for each boundary.

## Portable kit

The portable profile is tested on Node.js 22 and 24 and Python 3.12. Install
the one pinned Python dependency in a virtual environment, then run from the
repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r conformance/requirements.txt
.venv/bin/python conformance/check.py
node --test test/records/*.test.mjs test/operations/*.test.mjs test/skills/*.test.mjs test/board/*.test.mjs test/release/*.test.mjs
node scripts/generate-skills.mjs --check
node scripts/measure-overhead.mjs --check
```

If the pinned dependency is already available to `python3`, the manifest's
shorter `python3 conformance/check.py` command is equivalent.

The Python check validates:

- seven strict-JSON edge cases;
- the Draft 2020-12 `receipt-v1` schema;
- revision 1, forward revision, and broken-revision `baton-plan/v2` fixtures;
- canonical slice and assembly receipt commits;
- schema-invalid cursor and runtime-`no_verdict` records; and
- schema-valid receipts with an invalid role/result pair or stale detail hash.

The Node suites add the real-Git boundaries: forward plan revisions, stable
slice attempts, reviewed consumed-product pins, exact producer-authority
preparation, selective dependency invalidation, exact candidate and product
tree binding, metadata-only receipt history, deterministic composition,
procedural reconciliation, compare-and-set, exact standalone skill generation,
agent-led payload safety, and terminal-safe Git-derived board output.

The manifest deliberately contains no status fixture, proof bundle, transition
cursor, fake driver, or scripted claim that a runtime event is a Baton verdict.
A runner timeout, interrupted effect, duplicate dispatch, or missing cached
board view must be retried or reconciled by the engine without creating
approval, `proceed`, `pass`, or `merged`.

### Reproducible overhead

Run:

```sh
node scripts/measure-overhead.mjs --check
```

The baseline pins the annotated `v0.16.0` tag object, peeled commit and tree,
and every historical audited path's byte count, word count, and SHA-256. It
fails if an object, path, digest, or stored total differs. The current side
measures the compact operation and receipt-oriented package so the footprint
reduction remains reproducible rather than anecdotal.

## Autonomous engine

The autonomous profile contains only boundaries a library fixture cannot
prove. Its process contract is
[`engine-adapter.md`](engine-adapter.md).

All checked-in autonomous cases remain `NOT RUN` until an engine executes them
through its actual binary, persistence, scheduler, model driver, workspace, and
Git boundaries. A model response, portable fixture, or adapter assertion cannot
turn an unrun case into PASS.

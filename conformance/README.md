# Baton RC3 conformance

Baton separates evidence the portable kit can produce from evidence that only a
real autonomous engine can produce. The checked-in manifest has one profile for
each boundary.

## Portable kit

RC3 is tested on Node.js 22 and 24 and Python 3.12. Install the one pinned Python
dependency in a virtual environment, then run the full profile from the
repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r conformance/requirements.txt
.venv/bin/python conformance/check.py
node --test test/records/*.test.mjs test/operations/*.test.mjs test/adapters/*.test.mjs test/install/*.test.mjs test/board/*.test.mjs test/driver/*.test.mjs test/dogfood/*.test.mjs test/release/*.test.mjs
node scripts/generate-adapters.mjs --check
node scripts/measure-overhead.mjs --check
sh -n install-claude.sh
sh -n install-codex.sh
```

If the pinned dependency is already available to `python3`, the manifest’s
shorter `python3 conformance/check.py` command is equivalent.

The current portable result is:

```text
PASS  7 strict JSON cases
PASS  1 Draft 2020-12 schema
PASS  2 positive and 6 negative status fixtures
PASS  142 Node tests
PASS  10 generated adapters from 5 canonical operations
PASS  all 9 overhead budgets
```

Together these checks exercise:

- strict Plan and status parsing, lifecycle transitions, and sole-schema rules;
- real-Git ownership, topology, compare-and-set, and adversarial inputs;
- canonical operations and byte-identical generated Claude Code/Codex regions;
- transactional install, exact legacy migration, rollback, uninstall, and
  interruption recovery in temporary homes;
- the owner-aware board, safe terminal renderer, loopback GET-only WebUI, and
  warm-board performance budget;
- the role-independent driver contract and deterministic fake;
- a three-track real-Git lifecycle through fresh assembly verification and
  exact release Merge; and
- the release manifest, historical overhead objects, package digest, and clean
  regeneration.

The repository workflow runs this profile with full Git history because the
overhead check reads and verifies immutable `v0.16.0` tag, commit, tree, and
path objects directly.

### Reproducible overhead

Run:

```sh
node scripts/measure-overhead.mjs --check
```

The baseline pins the annotated `v0.16.0` tag object, peeled commit and tree,
and every audited path’s byte count, word count, and SHA-256. It fails if any
object, path, digest, or stored total differs.

The comparison measures fixed instruction bytes loaded by the four normal-work
invocations. Dynamic Plan, design, proof, and status bytes are counted as four
logical handoffs, not converted into an invented token estimate. A current
invocation includes the complete generated Skill, including frontmatter and
host bridge.

RC3 measures 1,512 fixed words against 56,973 for v0.16, a ratio of 2.6539%.
The five operations total 1,504 words; the largest full Skill is 397 words.

## Autonomous engine

The autonomous profile contains only boundaries a library fixture or scripted
dogfood cannot prove. Its process contract is
[`engine-adapter.md`](engine-adapter.md).

All 12 checked-in autonomous cases are `NOT RUN`. Baton RC3 does not claim that
Sworn or another real engine has passed authenticated approval, writer
scheduling, provider credential isolation, fresh-context/read-only dispatch,
timeouts, cancellation, crash recovery, or final-effect cases.

An engine must run each case through its actual binary, persistence, scheduler,
driver, workspace, and Git boundaries. A model response, fake driver, portable
fixture, or manual dogfood assertion cannot turn an unrun case into PASS.

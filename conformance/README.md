# Baton RC2 conformance

The manifest has two deliberately different profiles.

## Portable kit

Install the one pinned Python dependency in a virtual environment, then run
the complete portable profile from the repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r conformance/requirements.txt
.venv/bin/python conformance/check.py
node --test test/records/*.test.mjs test/operations/*.test.mjs test/adapters/*.test.mjs test/install/*.test.mjs test/board/*.test.mjs test/driver/*.test.mjs test/dogfood/*.test.mjs test/release/*.test.mjs
```

If the pinned dependency is already available to `python3`, the manifest's
shorter `python3 conformance/check.py` command is equivalent.

These checks exercise strict parsing and the sole schema, the closed lifecycle,
real-Git ownership and compare-and-set behavior, canonical operations,
generated Claude/Codex packages, isolated installation, the owner-aware board,
GET-only WebUI, common fake driver, and release budgets.

Overhead measurement is independently reproducible:

```sh
node scripts/measure-overhead.mjs --check
```

The baseline file pins the annotated `v0.16.0` tag object, peeled commit and
tree, and every audited path's byte count, word count, and SHA-256. The script
reads those bytes directly from Git objects. It refuses a moved tag, changed
object, path mismatch, or stored total that cannot be recomputed.

The word ratio measures exact fixed instruction bytes loaded by the four
normal-work invocations on each version. Dynamic plan, design, proof, and
status contents are not converted into an invented token estimate; their
logical file count is reported separately. A current invocation uses the full
generated skill, including host bridge and frontmatter, not only its canonical
region.

The warm-board, WebUI mutation-surface, fresh assembly, and exact Merge budgets
are executable tests rather than prose claims. Performance is kept out of the
deterministic word-measurement JSON and enforced by
`test/board/performance.test.mjs`.

## Autonomous engine

The autonomous profile contains only boundaries a library fixture cannot
prove. Its small process contract is
[engine-adapter.md](./engine-adapter.md).

Every autonomous case in the checked-in manifest is `NOT RUN`. Baton RC2 does
not claim that a real engine has passed authority, isolation, scheduling,
recovery, cancellation, fresh-Verifier, or final-effect cases. Sworn must run
them through its real binary before any result can change to PASS.

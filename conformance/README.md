# Baton conformance suite

Run Baton's portable checks with:

```sh
python3 conformance/check.py
```

The script requires Python 3 and `jsonschema`. It checks:

- strict I-JSON rejection cases, including duplicate keys, unsafe numbers, and
  invalid Unicode;
- the sole authored Draft 2020-12 schema;
- positive and negative `work-status-v1` fixtures;
- semantic rejection through the dependency-free Node record validator; and
- coherence between `manifest.json` and every executable fixture path.

Run the complete reference boundary suite with:

```sh
node --test test/records/*.test.mjs
```

Those tests use temporary real Git repositories to exercise plan and status
parsing, transitions, ownership, serial work, dependency materialisation,
product identity, exact composition, assembly, conflicts, compare-and-set, and
the seven-method safe action facade including exact retries and multi-ref
contention.

This portable suite establishes Baton record conformance. Autonomous-engine
conformance additionally requires the real process, persistence, isolation,
retry, recovery, and effect cases in [Baton Conformance](../baton/CONFORMANCE.md).
Sworn is the intended reference implementation of that larger profile; final
Baton 1.0 waits until Sworn passes those cases through its real boundaries.

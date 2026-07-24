# Candidate binding

- Repository: `acme/checkout`
- Base commit: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
- Candidate commit: `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`
- Candidate tree: `cccccccccccccccccccccccccccccccccccccccc`
- Product-tree digest: `sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd`
- Plan digest: `sha256:8649847c7cf51a21dedc3daab721c805703f5affa380008d233a9ab7637c752d`
- Approval digest: `sha256:953d90c7fc7c79263a949a251437485e61528b7a57996c891a3bc237729a1e8c`
- Design digest: `sha256:d41ac81f567e166b350fa2f78dd17e5d10d7eb5cde6559dbb77247211a6ea431`
- Captain invocation: `captain-T1-W1-1`
- Producer invocation: `implementer-T1-W1-build-1`

# Acceptance evidence

| Acceptance | Result | Evidence reference |
| --- | --- | --- |
| A1 | pass | `evidence://checkout-recovery/T1/W1/retry-test` |

# Checks

| Command or check | Exit status | Raw evidence reference |
| --- | --- | --- |
| `npm test -- checkout-retry` | 0 | `evidence://checkout-recovery/T1/W1/test-log` |

# Deviations

None.

# Not delivered

None.

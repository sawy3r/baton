# Candidate binding

- Repository: `acme/checkout`
- Base commit: `7777777777777777777777777777777777777777`
- Candidate commit: `7777777777777777777777777777777777777777`
- Candidate tree: `8888888888888888888888888888888888888888`
- Product-tree digest: `sha256:9999999999999999999999999999999999999999999999999999999999999999`
- Plan digest: `sha256:8649847c7cf51a21dedc3daab721c805703f5affa380008d233a9ab7637c752d`
- Approval digest: `sha256:953d90c7fc7c79263a949a251437485e61528b7a57996c891a3bc237729a1e8c`
- Component T1: `eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`
- Component T2: `4444444444444444444444444444444444444444`
- Producer invocation: `merge-assembly-1`

# Acceptance evidence

| Acceptance | Result | Evidence reference |
| --- | --- | --- |
| A1 | pass | `evidence://checkout-recovery/assembly/retry-test` |
| A2 | pass | `evidence://checkout-recovery/assembly/runbook-review` |

# Checks

| Command or check | Exit status | Raw evidence reference |
| --- | --- | --- |
| complete product test | 0 | `evidence://checkout-recovery/assembly/product-test` |
| component topology | 0 | `evidence://checkout-recovery/assembly/components` |

# Deviations

None.

# Not delivered

None.

# Candidate binding

- Repository: `acme/checkout`
- Base commit: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
- Candidate commit: `1111111111111111111111111111111111111111`
- Candidate tree: `2222222222222222222222222222222222222222`
- Product-tree digest: `sha256:3333333333333333333333333333333333333333333333333333333333333333`
- Plan digest: `sha256:8649847c7cf51a21dedc3daab721c805703f5affa380008d233a9ab7637c752d`
- Approval digest: `sha256:953d90c7fc7c79263a949a251437485e61528b7a57996c891a3bc237729a1e8c`
- Design digest: `sha256:b1ce48425a9bec4efcb07d7a05086cc22be528c82e7bec824473f8a58cdfbc77`
- Captain invocation: `captain-T2-W2-1`
- Producer invocation: `implementer-T2-W2-build-1`

# Acceptance evidence

| Acceptance | Result | Evidence reference |
| --- | --- | --- |
| A2 | pass | `evidence://checkout-recovery/T2/W2/rendered-review` |

# Checks

| Command or check | Exit status | Raw evidence reference |
| --- | --- | --- |
| `npm test -- runbook-links` | 0 | `evidence://checkout-recovery/T2/W2/test-log` |

# Deviations

None.

# Not delivered

None.

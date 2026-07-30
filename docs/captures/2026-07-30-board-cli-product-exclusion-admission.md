# Board CLI product-exclusion admission

## Finding

The standalone board worked for planned releases but became invalid after the
first candidate receipt required product-tree validation. Its programmatic
tests supplied a product-exclusion admission; the real CLI and WebUI did not.

This produced `PRODUCT_EXCLUSION_ADMISSION_REQUIRED` and an empty graph even
when the typed action layer had prepared the next slice correctly.

## Correction

The read-only board now supplies its own fixed projection policy for Baton's
fixed `.baton/releases` record root. That policy can validate display state but
cannot authorize or perform an action. Typed actions retain their separate,
explicit host policy admission.

The CLI test now crosses the missed boundary by recording a candidate and
Verifier PASS before invoking the real board process.

## Lesson

An invalid primary projection is a product defect, not a limitation for an
agent to explain away. The action layer remains authoritative, but the board
must project the same valid repository facts without requiring callers to
construct an undocumented capability.

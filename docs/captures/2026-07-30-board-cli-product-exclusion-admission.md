# Board reserved-root correction

## Finding

The standalone board worked for planned releases but became invalid after the
first candidate receipt required product-tree validation. Tests supplied an
opaque resolver that always returned `inert`; the real CLI and WebUI did not.
That resolver could not detect arbitrary product behavior and was not a real
security boundary.

## Correction

`.baton/releases` is reserved Baton metadata. Product code must not read or
depend on it, including from build, test, package, deploy, hooks, or runtime.
Product identity now structurally ignores exactly that fixed non-symlinked
directory; plans cannot include it, candidates must preserve it from their exact
implementation base, and only the confined record writer may modify it.

The false resolver and its capability threading were removed. The CLI and
WebUI now project a candidate and Verifier PASS without a token.

## Lesson

An unexplained invalid projection is diagnostic and escalation work. A worker
must never infer that it is a known limitation or treat it as permission to
bypass the board. The board must project the same structural repository truth
as the action layer.

A revised plan need not rewrite an unchanged prepared product base. The release
ref supplies current plan authority; record files visible on a track remain
history. Treating those files as competing authority creates metadata-only
handoff churn.

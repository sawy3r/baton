# Approach

Store the first successful charge identity against the existing checkout retry
key. A repeated request returns that identity instead of creating a new charge.

# Surfaces

- `src/checkout`
- `test/checkout`
- this work item’s Baton handoffs

# Consequential decisions and risks

The provider contract remains unchanged. The main risk is recording the key
after charging; the implementation writes the identity atomically before
returning success.

# Evidence plan

A1 runs the same checkout key twice in the retry test and asserts one provider
call and one returned charge identity.

# Revisions

None.

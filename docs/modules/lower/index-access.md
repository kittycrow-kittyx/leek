# Native index facts

`indexGuard(receiver, index)` checks bounds and integrality for a numeric property key. `indexCast(index, alias)` casts a validated key to the caller's configured native index type. Nullable indexing and immediate optional-number consumption share these expressions.

`integerIndex(index)` builds the Number-to-integer expression used before string index bounds tests. NaN becomes zero and finite values truncate towards zero. Infinite inputs stay invalid for the following guard. It operates on a captured temporary, so conversion does not repeat source side effects.

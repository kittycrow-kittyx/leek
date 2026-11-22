# Error catch aliases

`catchAliases(clause, checker)` returns a map from read-only alias declarations to their proved Error value. The caller must first establish the incoming Error domain. This query inspects source without writing or executing it.

Accepted aliases are block-scoped declarations directly in the catch block. They either copy an already known Error binding or retain the true arm of a standard `value instanceof Error ? value : fallback` normalisation. That fallback is unreachable in the proved throw domain. Mutable aliases, var bindings and nested alias declarations are excluded from this alias proof.

The native exception pass preserves the actual thrown object and its identity. It assigns the concrete Error checking type only after the throw-domain proof, then applies alias normalisation and native string conversion.

`errorString(node, checker)` identifies a standard single-argument String conversion and returns its operand. The exception pass replaces it with the existing Error `toString()` method only for bindings covered by the catch proof.

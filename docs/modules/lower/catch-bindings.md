# Closed catch bindings

`catchBindings(clause, checker)` returns a map from read-only alias declarations to their proven Error value, or null for an unsupported catch. The caller must first establish that the catch receives only standard Error objects. This query inspects source without writing or executing it.

Accepted aliases are block-scoped declarations directly in the catch block. They either copy an already known Error binding or retain the true arm of a standard `value instanceof Error ? value : fallback` normalisation. That fallback is unreachable in the proved throw domain. Mutable aliases, var bindings, nested alias declarations, primitive narrowing, dynamic evaluation, object escapes and stack metadata retain their original catch.

The original binding and every alias can expose only the native message, name, standard string conversion, typeof and supported standard Error instance tests. Shorthand references are resolved to their value binding so aliases cannot escape through object literals. The exception pass assigns the concrete Error checking type only after the complete throw-domain and use proofs succeed.

`errorString(node, checker)` identifies a standard single-argument String conversion and returns its operand. The exception pass replaces it with the existing Error `toString()` method only for bindings covered by the catch proof.

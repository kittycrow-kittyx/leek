# Nullable expression extension

`lowerNullable(source, checker)` captures effectful, explicitly nullable reference operands in local typed temporaries. Bake's existing `lowerSourceFile` performs the null selection. Assignment stays at the original expression so getters and calls run once, fallbacks remain lazy, recursion has independent storage and loops evaluate each iteration. Captures remain in the original block's type scope. The original result type preserves narrowing through the backend.

For standard `Map.get(key) ?? fallback` with non-nullable key and value types, the pass captures the map and key once and uses the existing `Map.has` and `Map.get` operations. The missing-key branch evaluates the fallback. Zero, false, NaN and existing object references retain their values. A stored undefined value requires a different representation and retains the original expression. Local Map lookalikes are excluded.

Literals, construction and standard Number or Math calls can omit unreachable fallbacks while retaining evaluation. A non-null assertion on an indexed value provides no such proof. Generated `satisfies` expressions retain result types for Baguette's semantic materialisation; named reference types use its normal symbol resolution. These annotations disappear during emission.

Bake handles selection for nullable identifiers. Other undefined-sensitive values, unresolved generics, primitive nullable representations and expressions containing suspension await further Leek transformations. Tests compare observable evaluation order with original TypeScript and execute the compiled nullable path in WebAssembly.

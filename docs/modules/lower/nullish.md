# Nullable expression extension

`lowerNullable(source, checker)` captures effectful, explicitly nullable reference operands in local typed temporaries. Bake's existing `lowerSourceFile` performs the null selection. Assignment stays at the original expression so getters and calls run once, fallbacks remain lazy, recursion has independent storage and loops evaluate each iteration. Captures remain in the original block's type scope. The original result type preserves narrowing through the backend.

Identifiers already supported by Bake are left alone. Undefined-sensitive values, unresolved generics, primitive nullable representations and expressions containing suspension remain unchanged for further Leek transformations. No JavaScript runtime or alternative nullish implementation is emitted. Tests compare observable evaluation order with original TypeScript and execute the compiled nullable path in WebAssembly.

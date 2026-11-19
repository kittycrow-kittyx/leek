# Numeric lowering

`lowerNumeric` accepts a TypeScript source file and its type checker. It rewrites standard Number predicates on numeric expressions into local helper functions using comparisons and arithmetic. The checker distinguishes the built-in Number constructor from locally declared names. Helper identifiers avoid collisions, and arguments are evaluated only once. Non-numeric expressions and optional calls are left intact.

The WASM path reuses `numericCall` for recognition only. It binds the existing AssemblyScript `F64` methods through Baguette rather than generating arithmetic predicate helpers. The earlier helper implementation remains for the deferred native targets.

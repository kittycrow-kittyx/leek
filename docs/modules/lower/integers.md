# Native integer facts

`nativeWidths` maps the `signed` and `unsigned` alias names to Baguette's existing i32 and u32 representations. `arrayType` recognises standard typed-array symbols, including library augmentations, and rejects local lookalikes. `unwrap` removes expression-only syntax wrappers for analysis. `integerOperation` recognises numeric bitwise operations and the unshadowed standard Math.imul call. `integerValue` identifies their 32-bit results, bounded integer literal types and proven native locals.

`librarySymbol` checks whether a symbol has a declaration in TypeScript's standard library. Typed-array recognition, numeric operations and Map default analysis share this check.

`integerStorage(source, checker)` returns the symbols of function-local bindings whose complete use permits modulo-32 storage. Initialisers and assignments must produce 32-bit integers; every read must be an operand of a recognised integer operation. Captured variables, ordinary Number reads, value-producing assignments, arithmetic updates and arbitrary numeric writes retain Number storage. Integer typed-array iteration bindings are eligible under the same read/write restrictions. Float-array bindings are excluded. These conservative facts supply a capability absent from the pinned compiler; they do not change source-level TypeScript types or narrow general Number arithmetic.

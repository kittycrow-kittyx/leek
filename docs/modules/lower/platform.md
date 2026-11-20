# Native platform probes

`lowerPlatform(source, checker)` resolves guarded probes for ambient process and navigator in Baguette's native profile. User-defined bindings retain their implementation. Unguarded host reads remain capability requirements.

The pass folds literal comparisons and short-circuit branches, follows local const literals within their function scope, and removes unobservable statements after an early return or throw. Tail declarations referenced before the exit remain available to hoisted functions and closures. Tests compare the transformed source with the original in a context without those JavaScript globals, and execute a compiled browser-probe fallback in WASM.

# Local exception control flow

`lowerLocalExceptions(source, checker)` lowers the blocks accepted by `localCatch` into a single-pass loop, a nullable Error slot and a presence flag. A rewritten throw stores the original Error object and exits. Nested loops propagate that exit before later statements can run. Break and continue targeting an outer loop are dispatched after the single-pass loop.

Return paths exit directly. When all ordinary paths already exit, only a captured throw can reach the following handler. Other handlers are guarded by the presence flag. The non-null read of the slot is protected by this control-flow proof. No default Error object or separate runtime exception mechanism is created.

The pass uses Baguette’s native variable factory and the existing AssemblyScript Error class. Labelled statements are avoided because the pinned backend rejects them. Async functions, finally and exceptions from calls retain their original source for later propagation lowering. These local cases do not resolve the canonical kernel’s general exception support.

Source tests compare returns, catch effects and loop exits with the original programme. Native WASM tests cover caught and ignored errors, early returns and nested-loop propagation, followed by independent modular WAT rebuilding.

After the throw-domain proof, read-only aliases use their actual Error type. A standard Error normalisation selects its original true arm; the unreachable fallback is removed. Alias use must satisfy the same non-escaping metadata restrictions as the original binding.

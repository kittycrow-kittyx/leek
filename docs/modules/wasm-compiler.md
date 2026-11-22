# WASM compiler workspace

`wasmCompiler(compiler, work)` creates a Leek-owned execution directory, links the verified compiler's installed dependencies and writes an AssemblyScript configuration selecting Leek's native exception transform. It returns the child process working directory. The original Baguette CLI remains the compiler entry point.

`wasmPrelude(compiler, work)` stages the pinned baseline prelude and aliases AssemblyScript's F64, NativeMath, Int64Array and Uint64Array exports. Its inline multiplication adapter calls Baguette's existing `mulU32`. View adapters and exception marker declarations are appended to this workspace file.

Both functions write only generated workspace files. Existing generated dependency links cause an error rather than being replaced. The compiler checkout and dependency pins remain unchanged. Failed builds may leave these diagnostic files in place.

# WASM source lowering

`lowerWasm(source, checker)` rewrites numeric bitwise expressions, shifts, global Math.imul calls and numeric typed-array for-of declarations. Native width aliases represent i32 and u32. Integer helpers reduce Number operands modulo 2^32 before conversion and restore the signed or unsigned Number result. Multiplication uses 16-bit partial products to preserve the low 32 bits. Indexed loops evaluate the array expression once and retain loop-local bindings. Explicit typed-array annotations avoid generic buffer types inferred by TypeScript.

`prepareWasmSource(input)` applies the pass to the staged project before Bake. It writes only staged implementation files. The pass leaves BigInt and non-numeric operands alone and rejects unsupported typed-array binding patterns. Reserved width aliases cannot appear in the input. Compound assignments and unary bitwise operations are outside this pass.

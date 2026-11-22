# WebAssembly emission

`emitWasm(compiler, input, outputDir)` connects Leek's staged canonical source graph to the pinned Baguette compiler. The compiler argument is the verified Baguette checkout, input is the lowered project with its entry path, and outputDir selects the destination for generated artefacts.

The function applies [WASM source lowering](lower/wasm.md), writes a Baguette configuration beside the staged TypeScript project and executes the pinned Baguette CLI under Bun from a [compiler workspace](wasm-compiler.md). Baguette performs Bake lowering, compilation and module verification. Leek forces the hosted Bake engine for this child process so an inherited engine setting cannot select the retired self-hosted engine. Successful emission writes the reference binary, ABI declarations and reports under outputDir, with modular WAT in `wat/leek/` and an original-source receipt in `canonical-source.json`. A downstream stage links those modules and compiles them independently, following Teto's workflow.

The process uses imported linear memory, the incremental AssemblyScript runtime and an optional host abort function. Its single baseline variant uses [Leek's ABI extensions](wasm-abi.md) to marshal supported userspace references through Baguette's numeric ABI. Additional reference ownership and language extensions remain Leek's responsibility. The upstream checkout is not modified. A compiler failure propagates to the caller and may leave intermediate diagnostic files.

The WASM extension selects Baguette’s pinned baseline prelude when `mulU32` is required. Leek supplies the TypeScript reference contract through `intrinsicModules`; it does not emit its own native multiplication routine.

The same intrinsic module mechanism binds the AssemblyScript F64 methods and NativeMath coercion operation. The [integer facts](lower/integers.md) provide the conditions for using native storage and multiplication. No WASM predicate or numeric coercion implementation is supplied by Leek.

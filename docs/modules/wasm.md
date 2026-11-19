# WebAssembly emission

`emitWasm(compiler, input, outputDir)` connects Leek's staged userspace source to the pinned Baguette compiler. The compiler argument is the verified Baguette checkout, input is the lowered project with its entry path, and outputDir selects the destination for generated artefacts.

The function writes a userspace-specific Baguette configuration beside the staged TypeScript project and executes Baguette under Bun from its own checkout. Baguette performs Bake lowering, compilation and module verification. Leek forces the hosted Bake engine for this child process so an inherited engine setting cannot select the retired self-hosted engine. Successful emission writes the WebAssembly binary, ABI declarations and reports under outputDir, with modular WAT in its wat directory.

The process uses imported linear memory and the incremental AssemblyScript runtime. Its single baseline variant retains Baguette's numeric ABI restrictions. Userspace boundary lowering and additional language extensions remain Leek's responsibility. The upstream checkout is not modified. A compiler failure propagates to the caller and may leave intermediate diagnostic files.

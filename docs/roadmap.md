# Compilation

Leek uses Baguette's pinned Bake for source analysis and lowering. Baguette
consumes the lowered TypeScript for WebAssembly generation.

Source analysis and lowering support WebAssembly, C and Rust. Native
backend integration remains pending. The source project is supplied by the
caller.

Userspace compilation requires support for TypeScript collections, strings,
regular expressions, exceptions, closures and asynchronous operations.
Runtime bindings connect compiled userspace to the selected kernel.

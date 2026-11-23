# Native Thistle configuration

`thistleWasm(compiler, input)` matches native-kernel source receipts against Leek's pinned Thistle checkout. Matching modules retain their existing native TypeScript expressions through Leek's extension passes. Bake and Baguette still process those modules.

The configuration binds `native/types`, `native/memory`, `native/word` and `core/rv64-numbers` to Baguette's existing Teto prelude. Native width aliases, ABI types and the canonical kernel memory policy accompany those bindings. A mismatched intrinsic or native module fails before emission.

A build containing the hosted `core/kernel` adapter still requires the mikuOS native integration. Diagnostics from that graph do not establish a defect in Thistle's working native build.

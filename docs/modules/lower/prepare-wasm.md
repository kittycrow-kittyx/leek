# Staged WASM preparation

`prepareWasmSource(input)` applies platform facts, capture lifting, nullable expressions, immediate optional-value consumers, native exception regions and numeric operations before Baguette’s Bake stage. Each phase resolves the preceding phase’s written source with a new checker. All implementation paths must remain inside the staging tree before a phase can write.

The returned paths identify checking-only intrinsic modules. Their TypeScript contracts describe existing native operations; Baguette omits the reference implementations. Preparation creates these modules in the workspace and preserves the canonical source manifest. Analysis and emission share this function.

The optional `preserved` paths identify verified upstream native modules. They remain in the source graph and still pass through Bake and Baguette; Leek’s JavaScript extension passes leave their existing native expressions unchanged.

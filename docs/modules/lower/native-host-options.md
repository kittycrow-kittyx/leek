# Native host-options binding

The canonical mikuOS source always constructs the pinned Thistle `Kern` with
explicit network, WASI, configuration, limits and identity options. The pinned
Thistle hosted implementation also defines a no-argument default provider,
which imports browser/Node networking and host WASI. That unused provider is
not part of a native mikuOS kernel.

`bindNativeKernelOptions(input)` runs against the isolated Leek staging tree,
after the original files have been receipt-checked and before the regular
WASM/Bake lowering passes. Its input is the existing `LoweredProject`.
It returns `true` when the verified canonical binding is applied and `false`
for unrelated source graphs lacking the mikuOS integration.

The pass checks the canonical receipt for `src/main/boot.ts`, the actual pinned
`thistle/src/core/kernel.ts`, and mikuOS-owned
`src/native/kernel-options.ts`. It verifies that mikuOS explicitly constructs
the kernel, rejects any direct `new Kern()` calls without options, and changes
only the three type/runtime import declarations in the staged upstream kernel.
Original pinned source files and canonical checksums are unchanged.

The target's replacement `defaultKernelOptions` is fail-closed: it throws if
called. No fake network, alternate kernel or permissive fallback is introduced.

This pass addresses one genuine host-only dependency edge. It does not remove
the remaining hosted process/VM/assembler graph or guarantee successful Bake,
WebAssembly compilation or boot. The compiler retains fail-on-warnings.

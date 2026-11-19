# WebAssembly ABI extensions

`prepareWasmAbi(input)` reads the staged entry module and returns Baguette entry paths, native type aliases and host ABI mappings. An explicit Uint8Array parameter on an exported function declaration activates the bridge. The generated module resides in the staged source tree.

| Export | Behaviour |
| --- | --- |
| leekBytesNew(length) | Allocates and roots a Uint8Array. |
| leekBytesSet(reference, index, value) | Checks ownership, bounds and byte range before writing. |
| leekBytesRelease(reference) | Removes the root. |

The ABI reference is an AssemblyScript object address, not a byte buffer address. Exported functions require live references from the same instance. References expire on release. The host is trusted.

The bridge roots live arrays in AssemblyScript's existing Set implementation. Membership and release use Set.has and Set.delete; setting a byte does not scan the complete root collection. The incremental runtime traces rooted arrays through the set.

Supported boundary types: scalar values and explicit Uint8Array parameters. Unsupported: other reference types, returned reference ownership, function expressions and bulk transfers.

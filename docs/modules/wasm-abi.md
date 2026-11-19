# WebAssembly ABI extensions

`prepareWasmAbi(input)` reads the staged entry module and returns Baguette entry paths, native type aliases and host ABI mappings. An explicit Uint8Array parameter on an exported function declaration activates the bridge. The generated module resides in the staged source tree.

| Export | Behaviour |
| --- | --- |
| leekBytesNew(length) | Allocates and roots a Uint8Array. |
| leekBytesSet(reference, index, value) | Checks ownership, bounds and byte range before writing. |
| leekBytesRelease(reference) | Removes the root. |
| leekBytesData(reference) | Returns the live array's data address, or zero after release. |
| leekBytesLength(reference) | Returns the live array's byte length, or -1 after release. |

The ABI reference is an AssemblyScript object address, not a byte buffer address. Exported functions require live references from the same instance. References expire on release. The host is trusted.

The bridge roots live arrays in AssemblyScript's existing Set implementation. Membership and release use Set.has and Set.delete; setting a byte does not scan the complete root collection. The incremental runtime traces rooted arrays through the set.

For bulk transfer, obtain the data address and length, then copy through a Uint8Array view of the instance's imported memory. Obtain a fresh memory.buffer view after calls that can grow memory. The array must remain rooted during access; release invalidates both its managed reference and its data address. This uses AssemblyScript's existing dataStart property and keeps the module's allocator and garbage collector responsible for ownership.

Supported boundary types: scalar values and explicit Uint8Array parameters. Other reference types, returned reference ownership and function expressions require additional ABI support. Imported memory provides storage for this instance's managed heap; integration with another allocator or a kernel heap requires its own contract.

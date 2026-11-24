# Native buffer views

`bufferView(node, checker)` recognises unmodified standard typed-array constructors with no arguments or a concrete ArrayBuffer followed by numeric offset and length arguments. It returns the native class name and whether the constructor is empty. Local lookalikes, rebound constructors, shared buffers, nullable indices and other overloads retain their source form.

`viewName(name)` gives the reserved intrinsic name. `viewReference(name)` provides a checking-only source constructor contract. Bake checks that contract; Baguette omits its body from native emission. `viewPrelude()` builds native adapters that call the pinned AssemblyScript typed-array `wrap` operation. They share its buffer identity and rooting rather than copying register or byte storage. These functions return text without modifying upstream files.

Number indices truncate towards zero. NaN selects zero. Invalid indices fail before narrowing to i32. Explicit element counts are checked against available buffer bytes before `wrap` can overflow its internal byte-length calculation. The library supplies alignment and buffer-range checks. Omitted lengths use its remainder-of-buffer behaviour, with an internal sentinel distinct from an explicit negative length.

Empty constructors receive an explicit zero length. Typed-array names come from the shared `typedArrays` catalogue; BigInt classes use the existing native aliases. Native tests compare view identity, overlapping signed and unsigned storage, byte offsets, element counts and range failures with original TypeScript. SharedArrayBuffer support remains a separate capability requirement.

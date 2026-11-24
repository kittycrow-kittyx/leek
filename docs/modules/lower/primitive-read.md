# Optional primitive reads

`primitiveRead(expression, checker)` returns a `PrimitiveRead` for a standard Number or BigInt typed-array index, string `codePointAt`, or string-keyed Number or BigInt Map lookup. The record contains receiver and key expressions, checking types, operation kind and storage family. Other expressions return null. Ordinary numeric arrays can contain holes; numeric Map keys require SameValueZero support. Neither is accepted here.

`primitiveSnapshot(input, receiver, index, present, alias, visit)` builds receiver, key and presence assignments plus a guarded native value expression. The caller supplies local temporary identifiers, a checked native index alias and its expression visitor. It evaluates nothing itself and does not write files. String code-point indices use the shared integer conversion; indexed reads use the shared bounds and integrality check. Map presence reuses `has` and present values reuse `get`.

Consumers must evaluate the returned effects and guarded value before any later operand that could change the storage. An absent value occupies a zero slot of the correct storage family, with a separate false presence flag. Checked-helper calls and strict comparisons share this protocol.

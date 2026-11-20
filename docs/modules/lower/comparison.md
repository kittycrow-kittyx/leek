# Optional primitive comparisons

`optionalComparison(node, checker, capture, temporary, visit)` returns a Boolean expression for strict equality or inequality involving a supported primitive read coalesced to null. Other nodes return null. The callbacks reserve typed function locals, capture a shared primitive read and transform original operands. The function builds an AST without evaluating source expressions or writing files.

The other operand must be null or the same native primitive family. Receiver, key, presence and value are captured in original evaluation order. A later operand can mutate the storage without changing an earlier read. A missing value compares equal only to null; stored zero, signed zero and NaN retain ordinary strict equality. No optional-value object is allocated.

Loose equality, ordinary numeric arrays, numeric Map keys, nullable comparison operands and suspended expressions remain for further lowering. The enclosing immediate-consumer pass rejects suspension and provides the local temporaries. The Boolean `satisfies` annotation preserves the result type through Baguette's expression materialisation.

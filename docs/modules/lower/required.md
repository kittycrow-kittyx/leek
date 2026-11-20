# Immediate optional-primitive consumption

`lowerRequired(files, checker)` returns a map of staged paths to transformed TypeScript. It specialises eligible generic helpers for Number and BigInt values without changing their original definitions. Each specialisation has a presence parameter and a native value parameter; its body retains the original success, fallback and exception paths. Multiple matching calls share a specialisation.

The call captures the receiver and index, computes presence, conditionally reads the native element and evaluates remaining arguments in their original order. The absent value slot contains zero in its native storage family, but the helper observes the presence bit before a narrowed value read. Zero, signed zero, NaN and every signed or unsigned 64-bit BigInt remain present values. No optional-value object is allocated for these calls.

String-keyed Number and BigInt Maps use the existing Map has operation for presence and call get only for an existing entry. The same specialised helper consumes both array and Map values.

Generated namespaces keep specialisations internal to the numeric WASM ABI while making them available to other staged modules. `requiredAliases` maps `LeekRequiredIndex` to i32 after validation. Canonical source files are read to stage the programme and remain unchanged.

Namespaces initialise before the original module statements. New imports follow existing imports to retain dependency evaluation order. Cyclic helper modules retain their original calls.

String code-point consumers reuse this presence protocol after `integerIndex` conversion and a bounds check. A present NUL code point is zero; the missing path is selected only by the separate presence flag.

Strict comparisons with null-coalesced Number or BigInt reads also consume the shared presence protocol. `optionalComparison` captures the read before a later comparison operand and produces a Boolean result without allocating an optional object. Coercing equality retains its source form.

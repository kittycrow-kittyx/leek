# Immediate optional-number consumption

`lowerRequired(files, checker)` returns a map of staged paths to transformed TypeScript. It specialises eligible generic helpers for Number values without changing their original definitions. Each specialisation has a presence parameter and a Number parameter; its body retains the original success, fallback and exception paths. Multiple matching calls share a specialisation.

The call captures the receiver and index, computes presence, conditionally reads the native element and evaluates remaining arguments in their original order. The absent Number slot contains zero, but the helper observes the presence bit before a narrowed value read. Zero, signed zero and NaN remain present values. No optional-value object is allocated for these calls.

String-keyed Number Maps use the existing Map has operation for presence and call get only for an existing entry. The same specialised helper consumes both array and Map values.

Generated namespaces keep specialisations internal to the numeric WASM ABI while making them available to other staged modules. `requiredAliases` maps `LeekRequiredIndex` to i32 after validation. Canonical source files are read to stage the programme and remain unchanged.

Namespaces initialise before the original module statements. New imports follow existing imports to retain dependency evaluation order. Cyclic helper modules retain their original calls.

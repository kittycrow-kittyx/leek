# Optional-number consumer analysis

`requiredCall(node, checker)` selects concrete Number or BigInt calls to a top-level generic helper when its first argument is a typed-array element or a string-keyed Number Map lookup coalesced to null. Shared `primitiveRead` analysis supplies storage facts. `RequiredCall` records the receiver, index or key, their types, the original helper, instantiated signature and type-parameter symbol.

The nullable parameter must be read-only. Its uses are limited to null tests and narrowed returns. All parameters are required and use concrete primitive types; the result uses the same primitive family. Async helpers, recursive calls, mutable function bindings, extra argument forms and helpers outside the supplied staged files retain their original calls.

`nullTest(node, symbol, checker)` identifies equality or inequality comparisons between the selected parameter and null. Specialisation replaces those tests with a separate presence bit.

Helper modules with cyclic or unresolved import dependencies retain their original calls. Functions can be invoked during cyclic module initialisation before a generated namespace is initialised.

`requiredResult(call, checker)` verifies that every normal return is the helper’s guarded first parameter. The argument must explicitly coalesce undefined to null, and the helper binding must remain unchanged. Nullable lowering can then remove a result fallback while retaining the original call and its errors. Helpers returning another value or using unchecked non-null assertions do not qualify.

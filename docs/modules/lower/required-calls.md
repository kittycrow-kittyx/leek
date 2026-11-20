# Optional-number consumer analysis

`requiredCall(node, checker)` selects concrete Number calls to a top-level generic helper when its first argument is a typed-array element coalesced to null. `RequiredCall` records the read, array class, original helper, instantiated signature and type-parameter symbol.

The nullable parameter must be read-only. Its uses are limited to null tests and narrowed returns. The parameter list has fixed arity and concrete primitive types; the result is a Number. Async helpers, recursive calls, mutable function bindings, extra argument forms and helpers outside the supplied staged files retain their original calls.

`nullTest(node, symbol, checker)` identifies equality or inequality comparisons between the selected parameter and null. Specialisation replaces those tests with a separate presence bit.

Helper modules with cyclic or unresolved import dependencies retain their original calls. Functions can be invoked during cyclic module initialisation before a generated namespace is initialised.

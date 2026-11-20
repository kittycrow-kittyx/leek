# Local exception facts

`localCatch(node, checker)` accepts synchronous try/catch blocks whose executable operations cannot throw except at explicit `new Error(string)` throws. It returns the catch clause or null. Calls, getters, indexing, custom constructors, arbitrary thrown values, nested try blocks, iterators, switch, do loops, literal infinite-loop conditions and finally need further lowering.

Arithmetic that can throw through conversion is excluded. BigInt arithmetic retains its source form; only assignments and comparisons have a closed throw domain here. Assignment to an array length is not treated as an ordinary numeric write. Bindings must belong to the current function, and the standard Error type must remain visible.

Caught objects cannot escape. Reads are restricted to message, name, standard string conversion, typeof and standard Error instance tests. Primitive narrowing, mutations, aliases, shorthand escapes and stack inspection retain the original catch. This proof supplies the concrete Error type used by the local control-flow pass; it does not give arbitrary catch values that type.

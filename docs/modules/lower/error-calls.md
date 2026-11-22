# Closed error helper calls

`lowerErrorCalls(source, checker)` returns staged TypeScript with eligible private synchronous tail calls replaced by the original helper body. It leaves the original source text unchanged when no helper qualifies. This function builds an AST and prints source without writing files.

A helper must be a top-level private function in a module, with fixed named primitive parameters and a primitive or void result. Its executable body must have the existing closed Error throw domain. Every reference must be a direct return call in a synchronous function with a surrounding non-escaping catch. Parameters and local bindings receive fresh names. Arguments evaluate once, in order, and original returns and throws retain their caller behaviour. A void helper receives a final return so falling out of its body cannot execute later caller statements.

Function values, export aliases, shorthand escapes, recursive calls, globals captured by the helper, generic or optional parameters, function-scoped var bindings, named type scopes, dynamic evaluation, async callers and catches observing stack metadata retain their original functions. Standard Error bindings must stay visible at the call and catch scopes. A function is removed only after all its references qualify; this preserves externally observable function identity.

`lowerLocalExceptions` runs after a new checker resolves the substituted bindings. General calls, imported helpers, non-tail positions, asynchronous rejection and custom thrown domains remain for further lowering.

# Error propagation facts

`errorDomain(checker, files)` returns a predicate for source operations whose exceptions have the native Error representation. It follows resolved function bodies, constructors, initialisers, accessors, callbacks and class overrides. A catch binding receives a concrete type only after its protected operations satisfy this proof.

Standard-library calls retain their native Error contract. Dynamic calls, arbitrary thrown values, suspended operations and unsupported conversions remain unresolved. Rebound call targets and derived implementations are checked against the supplied source graph. Recursive calls do not cache a positive result until the enclosing proof succeeds.

The analysis reads syntax and types without modifying source. It does not assume that TypeScript's structural Error interface establishes an Error object, and it does not prove a general host capability or Promise rejection contract.

`standardError(point, checker)` verifies the standard Error constructor and type bindings in a generated catch's lexical scope.

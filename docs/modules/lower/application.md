# Nullable predicate application

`nullableApplication(node, checker)` recognises nullable Boolean predicates in conditions and negations. The `NullableApplication` keeps the callback parameter’s checker symbol so substitution preserves other bindings with the same name. Unsupported expressions return null.

The helper implementation must do exactly two things: return null for a strictly null input, then invoke the supplied callback once with that input. The pass checks symbols and the original body rather than a function name. Generator and async helpers, rebound functions, effectful helper bodies, callback parameter writes, nested functions, dynamic evaluation and local type scopes retain their original source.

Only Boolean callbacks with a null fallback in a direct truth context qualify. A false branch can then represent the absent result without allocating or storing a nullable Boolean. Value-producing contexts and other fallback values retain their source form. Capturing the input once preserves getters and calls, and the predicate runs only when the input is present.

`appliedExpression(application, value, checker)` substitutes the checked callback parameter while preserving shorthand property keys and lexical this. It produces an expression without writing source files. The nullable pass places this expression behind the original null guard and uses a checked Boolean result annotation for the backend’s type materialisation.

Source differential tests cover lazy effects and exclusions. Native tests check absent inputs, empty strings, true and false predicates and callback counts, followed by an independent modular WAT rebuild. This extension does not provide general callback capture or optional primitive storage.

# Function body scopes

`functionBody(node)` returns a function's executable block or arrow expression body, or null for other syntax. Lowering passes use it to allocate temporaries per invocation, including expression-bodied arrows.

`functionOwner(node)` returns the nearest enclosing function-like node, or null outside a function. Capture, native storage, platform and local exception analysis share this scope check.

`abruptCompletion(statement)` conservatively proves that normal control leaves through a return, throw, break or continue. Both branches of an if must exit. An explicit exit in a block makes its following statements unreachable; loops alone do not prove completion. Closed helper calls and local catch lowering share this query.

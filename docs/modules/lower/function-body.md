# Function body scopes

`functionBody(node)` returns a function's executable block or arrow expression body, or null for other syntax. Lowering passes use it to allocate temporaries per invocation, including expression-bodied arrows.

`functionOwner(node)` returns the nearest enclosing function-like node, or null outside a function. Capture, native storage, platform and local exception analysis share this scope check.

`abruptCompletion(statement)` returns true for explicit exits. An if requires both branches to exit; blocks require an unconditional exit. Loops return false. Closed helper calls and local catch lowering share this query.

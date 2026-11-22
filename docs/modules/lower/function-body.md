# Function body scopes

`functionBody(node)` returns a function's executable block or arrow expression body, or null for other syntax. Lowering passes use it to allocate temporaries per invocation, including expression-bodied arrows.

`functionOwner(node)` returns the nearest enclosing function-like node, or null outside a function. Capture, native storage, platform and native exception analysis share this scope check.

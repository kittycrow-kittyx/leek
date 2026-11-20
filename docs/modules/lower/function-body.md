# Function body scopes

`functionBody(node)` returns a function's executable block or arrow expression body, or null for other syntax. Lowering passes use it to allocate temporaries per invocation, including expression-bodied arrows.

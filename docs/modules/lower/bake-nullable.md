# Bake nullable selection

`bakeNullable(source, checker, cache, type, fallback)` delegates nullable reference selection to the pinned Bake lowerer. The caller has already captured the effectful operand in a repeatable local. A checker adapter supplies its original type while Bake lowers a synthetic nullish expression.

The function returns Bake's conditional expression with the original fallback and rejects unsupported output or diagnostics.

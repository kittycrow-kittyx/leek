# Typed-array loop adapter

`lowerArrayLoop` receives an original source file, synchronous typed-array loop, concrete array name, type checker, child visitor, item representation and enclosing labels. It delegates the transformation to pinned Bake's `lowerSourceFile` with a checker view that recognises built-in typed arrays as indexable arrays. The upstream checkout and its implementation remain unchanged.

The adapter annotates Bake's generated iterable, index and item bindings using Baguette's `nativeVariable` factory. It preserves one evaluation of the iterable, the original body scope and labelled break/continue targets. Nested loops pass through the same child visitor. Unsupported bindings or a changed Bake output contract fail explicitly. Ordinary array and tuple loops remain the responsibility of Baguette's normal Bake stage.

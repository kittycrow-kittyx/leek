# Compilation

Leek accepts a mikuOS TypeScript project and selects a target via
`--target=wasm|clang|rust`. Its source passes operate on an isolated copy of
the resolved programme. Numeric predicates are lowered before the inherited
Bake passes. Each target uses the Bake revision pinned by its compiler.

C and Rust emission use the inherited compiler functions. WAT emission
requires an importable Baguette emitter. Collections, strings, exceptions,
closures, asynchronous operations and kernel bindings require further lowering.

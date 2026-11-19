# Compilation

Leek accepts a mikuOS TypeScript project and selects a target via
`--target=wasm|clang|rust`. Its source passes operate on an isolated copy of
the resolved programme. The WASM extension binds native numeric predicates before the inherited
Bake passes. Each target uses the Bake revision pinned by its compiler.

C and Rust emission use the inherited compiler functions. WAT emission
uses Baguette's released command-line entry point until a reusable emitter API is available. Collections, strings, exceptions,
closures, asynchronous operations and kernel bindings require further lowering.

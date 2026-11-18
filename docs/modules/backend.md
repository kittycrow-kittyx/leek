# Backend selection

`build` receives the selected target and staged project, checks the backend and its Bake checkout, then runs Bake against the staged configuration. Failed lowering stops emission. Analysis and validation requests stop after Bake. C and Rust emission use their respective compiler APIs; WebAssembly emission still requires the Baguette emitter API.

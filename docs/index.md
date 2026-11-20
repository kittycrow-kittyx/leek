# Leek modules

Install the pinned dependencies and run `bun run build` before changing the lowering pipeline. The [strict checks](checks.md) describe the validation scope.

- [Project configuration](modules/project.md)
- [Command options](modules/args.md)
- [Numeric lowering](modules/lower/numeric.md)
- [WASM source lowering](modules/lower/wasm.md)
- [Nullable expression extension](modules/lower/nullish.md)
- [Async capture analysis](modules/lower/captures.md)
- [Local async lowering](modules/lower/closures.md)
- [Generated names](modules/lower/names.md)
- [Native integer facts](modules/lower/integers.md)
- [Typed-array loop adapter](modules/lower/loops.md)
- [Source staging](modules/lower/index.md)
- [Backend selection](modules/backend.md)
- [WebAssembly emission](modules/wasm.md)
- [Modular WAT linking](modules/wat.md)
- [WebAssembly ABI extensions](modules/wasm-abi.md)
- [CLI entry](modules/cli.md)

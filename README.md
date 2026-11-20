# Leek

**LEEK**: Leek Extends the Environment of KittyX.

Leek is an ahead-of-time transpiler for canonical mikuOS. It supplies the
language transformations missing from the pinned Bake and KITTYX backends.
For WebAssembly, Baguette owns compilation, modular WAT emission, native
instruction selection and deterministic binary verification.

The production source is `mikuOS-thistle/src/main/boot.ts` and its transitive
graph, including the canonical Thistle kernel and inherited ThistleASM.
Leek stages that graph without maintaining another kernel or userspace source tree.

## Targets

| Target | Compiler | Output |
| --- | --- | --- |
| `wasm` | Baguette | WebAssembly |
| `clang` | Croissant | C |
| `rust` | Crust | Rust |

Source analysis and lowering are available for all three targets. The
WebAssembly path uses the released Baguette compiler process, including its
mandatory Bake stage. Whole-system language coverage and the boot ABI remain
incomplete. Resolving the full canonical graph does not establish that the OS
has compiled or booted. C and Rust work is deferred.

## Requirements

- Bun 1.4.5 or later;
- the pinned compiler dependencies and a mikuOS source checkout.

## Build and test

```sh
bun run setup
bun run build
bun run test
```

The setup command installs Leek's dependencies and the pinned compiler and Bake dependencies. Run it after cloning or changing dependency revisions.

## Use

```sh
bun src/cli.ts --target=wasm --source ../mikuOS-thistle --out-dir ../mikuOS-teto/build/reference
bun src/cli.ts analyse --source ../mikuOS-thistle --entry src/sh/lex.ts
```

The entry path is relative to the supplied mikuOS source directory. Diagnostics and
lowered source are written to `build/`. WebAssembly output is written
to `dist/wasm/` by default when compilation succeeds, with modular WAT under
`wat/leek/`. `--out-dir` resolves relative to the calling repository. Baguette
also produces a reference binary, as in Teto's regeneration workflow. A separate
build links the modular layout and compiles it through Binaryen.

`build/wasm/source-manifest.json` records each original source module and its
SHA-256 before transformation. Successful emission copies it to
`canonical-source.json` beside the output. Original sources and dependency pins
remain unchanged. Unsupported constructs fail the build, without excluding modules
or running the OS in a TypeScript fallback.

## Documentation

- [Module documentation](docs/index.md)
- [Implementation roadmap](docs/roadmap.md)
- [Strict code checks](docs/checks.md)

## Licence

[MIT](LICENSE).

# Leek

**LEEK**: Leek Extends the Environment of KittyX.

Leek is an ahead-of-time compiler for mikuOS. It extends Bake and the
KITTYX compiler backends to compile the TypeScript userspace independently
of the Thistle kernel.

## Targets

| Target | Compiler | Output |
| --- | --- | --- |
| `wasm` | Baguette | WebAssembly |
| `clang` | Croissant | C |
| `rust` | Crust | Rust |

Source analysis and lowering are available for all three targets. The
WebAssembly compilation path uses the released Baguette compiler process
until its emitter can be extended through an importable API. Userspace ABI
and language coverage are not yet complete. Native backend validation is pending.

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
bun src/cli.ts analyse --source ../mikuOS --entry src/sh/lex.ts
bun src/cli.ts lower --source ../mikuOS --target wasm --entry src/sh/lex.ts
bun src/cli.ts wasm --source ../mikuOS --entry src/sh/lex.ts --validate-only
```

The entry path is relative to the supplied mikuOS source directory. Diagnostics and
lowered source are written to `build/`. WebAssembly output is written
to `dist/wasm/` when compilation succeeds, with WAT under `dist/wasm/wat/`.

## Documentation

- [Module documentation](docs/index.md)
- [Implementation roadmap](docs/roadmap.md)
- [Strict code checks](docs/checks.md)

## Licence

[MIT](LICENSE).

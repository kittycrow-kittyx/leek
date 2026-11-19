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
WebAssembly backend is integrated but not yet validated against the
complete userspace. C and Rust backend integration is pending.

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
to `dist/wasm/` when compilation succeeds.

## Documentation

- [Module documentation](docs/index.md)
- [Implementation roadmap](docs/roadmap.md)
- [Strict code checks](docs/checks.md)

## Licence

[MIT](LICENSE).

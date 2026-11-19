# Strict code checks

`bun run guards` checks Leek's own TypeScript, tests, documentation
and repository configuration using all Code Guards rules. Every warning
fails the command. `bun run build` requires this check before type validation.

The scan uses a temporary view of the working tree. Git submodules
remain available for type resolution. The guards inspect only Leek's files.

The report is written to `logs/code-guards.json`. Semantic checks use
the local Code Guards model and may download model weights on first use.

## Cross-repository reuse

`bun run guards:reuse` scans Leek and its pinned Baguette, Croissant,
Crust and Bake sources in one temporary TypeScript project. The source list
includes tracked implementation files, tooling and tests. Bake is included
once. Dependency integrity is checked before scanning.

Code Guards reports cross-repository type overlap (CG101–CG103), repeated
functions (CG205) and duplicate configuration (CG304). The report excludes
pairs entirely within Leek or entirely within its dependencies. Findings
fail this separate command and are saved to `logs/code-guards-reuse.json`.

The combined project is an analysis view, not a compiler build. Review
similarity findings against the original contracts; matching syntax or types
alone does not establish equivalent behaviour. Short functions and anonymous
test callbacks can escape detection.

CG205 also skips nested implementations inside recognised function bodies and
does not parse generated code strings. AssemblyScript's standard library under
node_modules is outside this scan. A clean report is a heuristic result, not a
proof that all available upstream capabilities are reused.

## Compiled WASM correctness

`bun run test` includes an end-to-end fixture compiled through Leek, Bake,
Baguette, AssemblyScript and Binaryen. It instantiates the final optimised WASM,
compares numeric edge cases with original TypeScript, verifies managed byte
buffer lifetimes and checks native checksum loop instructions. The checksum
loop requires byte loads, integer XOR and integer multiplication without
floating-point operations. This checks architecture and correctness without
measuring execution speed. Baguette's deterministic rebuild check remains enabled.

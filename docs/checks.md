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

`logs/code-guards-reuse.json` records type overlap (CG101–CG103), repeated
functions (CG205) and duplicate configuration (CG304). Each comparison pairs
a Leek file with a pinned dependency file. Warnings produce a non-zero exit code.

The combined project is an analysis view, not a compiler build. Review
similarity findings against the original contracts; matching syntax or types
alone does not establish equivalent behaviour. Short functions and anonymous
test callbacks can escape detection.

CG205 compares named function bodies. Nested functions, anonymous callbacks,
generated helper strings and AssemblyScript's standard library require a
separate review. Check generated instructions alongside the heuristic report.

## Compiled WASM correctness

`bun run test` includes an end-to-end fixture compiled through Leek, Bake,
Baguette, AssemblyScript and Binaryen. It instantiates the final optimised WASM,
compares numeric edge cases with original TypeScript, verifies managed byte
buffer lifetimes and checks native checksum loop instructions. The checksum
loop requires byte loads, integer XOR and integer multiplication without
floating-point operations. This checks architecture and correctness without
measuring execution speed. Baguette's deterministic rebuild check remains enabled.

The native test also links Baguette's emitted modular WAT independently and
compiles it with the pinned Binaryen. The result must reproduce Baguette's
reference binary exactly. Nullable expression tests check getters, lazy fallbacks,
recursion, loops, local type scopes and native execution. Source staging tests
require inherited kernel modules and reject escapes before a pass can write to
canonical source. These fixtures do not establish whole-OS compilation or boot.

Native exception tests retain cross-function calls, subclass fields, nested
rethrows and loop exits. Repeated allocation and unwinding exercise GC root
restoration. Value and void coroutine tasks must retain rejection through
awaited calls instead of resuming with default values.

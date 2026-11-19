# WASM source lowering

`lowerWasm(source, checker)` binds numeric bitwise expressions, shifts, standard Math.imul calls and typed-array iteration to the pinned compiler infrastructure. The returned `WasmLowering` contains staged text and flags for native multiplication, numeric predicates and coercion contracts.

General Math.imul calls use AssemblyScript's existing implementation. Bitwise operands with arbitrary Number values use its `NativeMath.imul(value, 1)` coercion, then an i32 cast before unsigned reinterpretation. This preserves negative values without relying on a saturating float-to-u32 conversion. Leek emits no arithmetic coercion helper bodies. Proven integer operands use native casts and Baguette's `mulU32` primitive. Only locals whose complete set of reads and writes permits modulo-32 storage receive a native annotation. Number results are restored at expression boundaries.

The [typed-array adapter](loops.md) supplies Bake's missing built-in array recognition and native storage annotations. Bake performs the indexed-loop transformation. The iterable is evaluated once; labels and loop-local binding scopes are retained. Explicit typed-array annotations avoid unsupported inferred buffer generics.

`prepareWasmSource(input)` applies the extension to the staged project before Baguette's mandatory Bake stage. It writes staged implementation files and, when needed, an intrinsic reference module. `multiplyReference`, `integerReference` and `floatReference` provide the TypeScript checking contracts for existing native implementations; their bodies are omitted by Baguette. Required native binding names and width aliases are reserved. BigInt and non-numeric operands remain unchanged. Compound assignments and unary bitwise operations are outside this extension.

Numeric predicates on typed Number operands use the existing `F64.isNaN`, `F64.isFinite`, `F64.isInteger` and `F64.isSafeInteger` primitives in Baguette’s pinned AssemblyScript. The intrinsic reference is checked by Bake and omitted from native emission. Local Number declarations are not rewritten.

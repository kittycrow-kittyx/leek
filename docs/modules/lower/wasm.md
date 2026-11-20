# WASM source lowering

`lowerWasm(source, checker)` binds numeric bitwise expressions, shifts, standard Math.imul calls and typed-array iteration to the pinned compiler infrastructure. The returned `WasmLowering` contains staged text and flags for native multiplication, numeric predicates, coercion contracts and a list of buffer-view contracts.

General Math.imul calls use AssemblyScript's existing implementation. Bitwise operands with arbitrary Number values use its `NativeMath.imul(value, 1)` coercion, then an i32 cast before unsigned reinterpretation. This preserves negative values without relying on a saturating float-to-u32 conversion. Proven integer operands use native casts and Baguette's `mulU32` primitive. Only locals whose complete set of reads and writes permits modulo-32 storage receive a native annotation. Number results are restored at expression boundaries.

The [typed-array adapter](loops.md) supplies Bake's missing built-in array recognition and native storage annotations. Bake performs the indexed-loop transformation. The iterable is evaluated once; labels and loop-local binding scopes are retained. Explicit typed-array annotations avoid unsupported inferred buffer generics. BigInt typed-array iteration retains BigInt storage and bypasses Number and modulo-32 coercion.

The [staged preparation pipeline](prepare-wasm.md) applies this numeric lowering after the capture, exception and nullable passes. Checking-only intrinsic contracts describe existing native implementations; their bodies are omitted by Baguette. `multiplyReference`, `integerReference` and `floatReference` supply these contracts. Generated names avoid canonical native bindings, and width aliases remain reserved. BigInt bitwise expressions retain their original operators.

Numeric predicates on typed Number operands use the existing `F64.isNaN`, `F64.isFinite`, `F64.isInteger` and `F64.isSafeInteger` primitives in Baguette’s pinned AssemblyScript. The intrinsic reference is checked by Bake and omitted from native emission. Local Number declarations are not rewritten.

`uncheckedReference` supplies the checking-only identity signature for AssemblyScript's `unchecked` builtin. `WasmLowering.usesUnchecked` records its use in typed-array loops whose generated condition checks each element's index before reading it.

`wasmPrelude(compiler, work)` stages the pinned baseline prelude and aliases AssemblyScript's existing F64, NativeMath, Int64Array and Uint64Array exports. Its inline LeekMulU32 adapter calls Baguette's mulU32 without supplying another multiplication implementation. Instruction tests require the hot loop to retain native integer loads, XOR and multiplication.

The native profile binds JavaScript BigInt64Array and BigUint64Array names to AssemblyScript’s existing Int64Array and Uint64Array storage. Native tests cover length allocation, signed and unsigned boundary values, indexed defaults and iteration. Concrete ArrayBuffer constructors use the [native view adapter](views.md). Shared buffers and other constructor overloads still require compatibility lowering before whole-OS emission can succeed.

The staged profile also applies [local exception control flow](exceptions.md) before capture analysis. Only closed synchronous Error throws qualify; general exceptions and coroutine propagation remain unsupported.

`WasmLowering.views` records the typed-array class names whose checking contracts must be staged. The prelude delegates these constructors to the inherited native wrap implementation.

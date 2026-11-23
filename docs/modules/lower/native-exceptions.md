# Native exception regions

`lowerNativeExceptions(source, checker, intrinsicSpecifier, files)` returns staged text and a `used` flag. Synchronous catches with a proved Error domain become structured region markers. Calls, returns, loop exits and the original thrown objects remain in place. Error normalisation loses its fallback only after the domain proof. Subclass member reads use a checked narrowing through the inherited native cast.

`exceptionReference` supplies checking-only intrinsic declarations. `exceptionPrelude` declares their backend markers and the inline `changetype` adapter. Baguette omits the reference module; the [compiler transform](../native-exceptions.md) removes the marker imports before module verification.

The pass writes no canonical files. Async catches, finally, mutable catch bindings and unproved thrown domains retain diagnostics. The [staging pipeline](prepare-wasm.md) resolves every phase again before passing its output to Bake.

Converted throws end in `return unreachable()` so TypeScript retains explicit terminating-flow facts through async catch/finally paths. The AssemblyScript syntax adapter restores a terminating throw after the native raise, preserving the same backend flow proof.

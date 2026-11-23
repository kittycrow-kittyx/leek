# Nullable expression extension

`lowerNullable(source, checker, intrinsicSpecifier)` returns a `NullableLowering` with transformed `text` and a `usesReferenceRead` flag. It captures effectful, explicitly nullable reference operands in local typed temporaries. Bake's existing `lowerSourceFile` performs the null selection. Assignment stays at the original expression so getters and calls run once, fallbacks remain lazy, recursion has independent storage and loops evaluate each iteration. Captures remain in the original block's type scope. The original result type preserves narrowing through the backend.

For standard `Map.get(key) ?? fallback` with non-nullable key and value types, the pass captures the map and key once and uses the existing `Map.has` and `Map.get` operations. The missing-key branch evaluates the fallback. Zero, false, NaN and existing object references retain their values. A stored undefined value requires a different representation and retains the original expression. Local Map lookalikes are excluded.

Literals, construction and standard Number or Math calls can omit unreachable fallbacks while retaining evaluation. Generated `satisfies` expressions retain result types for Baguette's semantic materialisation; named reference types use its normal symbol resolution.

Indexed defaults on strings and typed arrays capture the receiver and numeric index, check bounds and integrality, then select the native element or fallback. String access uses UTF-16 code units. Reference arrays use `referenceRead` as their checking contract and the existing AssemblyScript `unchecked` operation after the bounds check. Native reference holes become null at this coalescing boundary. Numeric arrays with holes retain their source expression because zero cannot represent an absent Number element.

Typed-array index lowering accepts Number fallbacks. The source `values[index] ?? null` retains its original form pending optional primitive storage.

Primitive Map values also require fallbacks in the same native storage family. A numeric Map lookup with a null fallback retains its source form pending separate presence storage.

Reference-array `pop` and `shift` defaults capture the receiver and check its length before calling the existing array operation. Empty arrays select the fallback without invoking the native operation. A removed reference hole also selects the fallback. Bake lowers the resulting nullable selection after the checker is rebuilt.

Standard `at(index)` defaults share indexed lowering. The index is truncated towards zero and negative indices are offset from the captured receiver's length. The bounds check precedes the native read. NaN and signed zero select index zero; infinite indices select the fallback.

`nullableAliases` maps the checked `LeekArrayIndex` cast to native i32 after the bounds and integrality checks. Generated indexed bindings reject collisions with existing source identifiers.

| Checking type | Native type |
| --- | --- |
| `LeekArrayIndex = number` | `i32` |
| `Uint8Array<ArrayBufferLike>` | `Uint8Array` |

Undefined-only optional references (strings and objects) lower to a typed temporary and `== null` selection. Tagged object-and-primitive unions use the same treatment for a literal `?? null` fallback. Optional primitive-only values, unresolved generics and suspended expressions remain unchanged.

BigInt64Array and BigUint64Array defaults use the same bounds and integrality guard as Number typed arrays, with a BigInt fallback. Reads retain 64-bit storage; missing elements never become a stored zero value.

Standard string `codePointAt(index)` defaults reuse the same captured index and bounds checks. The index truncates towards zero without negative wrapping, and a validated native code-point read remains distinct from a missing result. Null fallbacks retain their optional primitive form until the immediate-consumer pass can provide separate presence storage. Tests include surrogate pairs, lone surrogates, fractional indices, NaN and infinities.

Standard library interfaces derived from Array, including regular-expression match arrays, share reference-array index handling. Missing captures select the fallback and empty captures remain present. User-defined array-like classes retain their original expressions. This does not supply a native regular-expression engine.

Nullable predicate applications used only as conditions can inline a proven guard-and-callback helper. The [application analysis](application.md) verifies the original helper body and preserves predicate timing without storing a nullable Boolean.

A verified checked-helper result can omit its unreachable fallback. The shared consumer analysis requires an explicit nullish argument boundary and proves that normal returns contain only the guarded input. Ordinary call return annotations alone are insufficient.

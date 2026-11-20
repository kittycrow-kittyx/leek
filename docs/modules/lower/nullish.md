# Nullable expression extension

`lowerNullable(source, checker, intrinsicSpecifier)` returns a `NullableLowering` with transformed `text` and a `usesReferenceRead` flag. It captures effectful, explicitly nullable reference operands in local typed temporaries. Bake's existing `lowerSourceFile` performs the null selection. Assignment stays at the original expression so getters and calls run once, fallbacks remain lazy, recursion has independent storage and loops evaluate each iteration. Captures remain in the original block's type scope. The original result type preserves narrowing through the backend.

For standard `Map.get(key) ?? fallback` with non-nullable key and value types, the pass captures the map and key once and uses the existing `Map.has` and `Map.get` operations. The missing-key branch evaluates the fallback. Zero, false, NaN and existing object references retain their values. A stored undefined value requires a different representation and retains the original expression. Local Map lookalikes are excluded.

Literals, construction and standard Number or Math calls can omit unreachable fallbacks while retaining evaluation. Generated `satisfies` expressions retain result types for Baguette's semantic materialisation; named reference types use its normal symbol resolution.

Indexed defaults on strings and typed arrays capture the receiver and numeric index, check bounds and integrality, then select the native element or fallback. String access uses UTF-16 code units. Reference arrays use `referenceRead` as their checking contract and the existing AssemblyScript `unchecked` operation after the bounds check. Native reference holes become null at this coalescing boundary. Numeric arrays with holes retain their source expression because zero cannot represent an absent Number element.

`nullableAliases` maps the checked `LeekArrayIndex` cast to native i32 after the bounds and integrality checks. Generated indexed bindings reject collisions with existing source identifiers.

| Checking type | Native type |
| --- | --- |
| `LeekArrayIndex = number` | `i32` |
| `Uint8Array<ArrayBufferLike>` | `Uint8Array` |

Bake handles selection for nullable identifiers. Other undefined-sensitive values, unresolved generics, primitive nullable representations and expressions containing suspension await further Leek transformations. Tests compare observable evaluation order with original TypeScript and execute the compiled nullable path in WebAssembly.

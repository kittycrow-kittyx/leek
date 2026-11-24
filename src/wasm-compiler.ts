import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { json } from "./project.ts";
import { viewPrelude } from "./lower/views.ts";
import { exceptionPrelude } from "./lower/native-exceptions.ts";
import { nativeWidths } from "./lower/integers.ts";
import { nullableAliases } from "./lower/nullish.ts";
import { requiredAliases } from "./lower/required.ts";

/** Type bindings paired with the compiler prelude and intrinsic reference modules. */
export const wasmTypeAliases = { ...nativeWidths, ...nullableAliases, ...requiredAliases };

/** Alias inherited native operations and supply the exception marker contracts. */
export function wasmPrelude(compiler: string, work: string): string {
  const path = resolve(work, "leek-prelude.ts");
  const inherited = readFileSync(resolve(compiler, "prelude/teto-baseline.ts"), "utf8");
  writeFileSync(path, inherited + '\nimport { Int64Array as BigInt64Array, Uint64Array as BigUint64Array } from "~lib/typedarray";\n' +
    'import { F64 as LeekF64 } from "~lib/number";\n' +
    'import { NativeMath as LeekNativeMath } from "~lib/math";\n' +
    '@inline function LeekReferenceAt<T>(values: Array<T>, index: i32): T | null { return unchecked(values[index]); }\n' +
    '@inline function LeekMulU32(left: u32, right: u32): u32 { return mulU32(left, right); }\n' + viewPrelude() + exceptionPrelude);
  return path;
}

/** Supply a Leek-owned AssemblyScript transform while running the original pinned Baguette CLI. */
export function wasmCompiler(compiler: string, work: string): string {
  const view = resolve(work, "compiler");
  mkdirSync(view, { recursive: true });
  symlinkSync(resolve(compiler, "node_modules"), resolve(view, "node_modules"), "dir");
  json(resolve(view, "asconfig.json"), {
    options: { transform: [resolve(dirname(fileURLToPath(import.meta.url)), "native-exceptions.ts")] }
  });
  return view;
}

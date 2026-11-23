import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { THISTLE_WASM_INITIAL_PAGES, THISTLE_WASM_MAXIMUM_PAGES } from "../mikuOS-thistle/thistle/src/core/kernel-memory.js";
import type { LoweredProject, SourceManifest } from "./lower/index.ts";
import type { BaguetteConfig } from "../baguette/src/contracts.ts";

interface ThistleWasm {
  intrinsicModules: string[];
  preservedModules: string[];
  memory: Pick<BaguetteConfig["memory"], "initialPages" | "maximumPages"> | null;
  typeAliases: NonNullable<BaguetteConfig["typeAliases"]>;
  abiTypes: NonNullable<BaguetteConfig["abiTypes"]>;
}

const manifest: (text: string) => SourceManifest = JSON.parse;
const hash = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");
const kernel = "src/native/kernel.ts";
const intrinsics = ["src/native/types.ts", "src/native/memory.ts", "src/native/word.ts", "src/core/rv64-numbers.ts"];

/** Bind the pinned native Thistle modules to Baguette's existing Teto prelude. */
export function thistleWasm(compiler: string, input: LoweredProject): ThistleWasm {
  const empty: ThistleWasm = { intrinsicModules: [], preservedModules: [], memory: null, typeAliases: {}, abiTypes: {} };
  const canonical = resolve(compiler, "../mikuOS-thistle/thistle");
  const modules = manifest(readFileSync(input.sourceManifest, "utf8")).modules;
  const candidates = modules.filter(module => module.path === kernel || module.path.endsWith("/" + kernel));
  if (!candidates.length) return empty;
  const receipt = candidates.find(module => module.sha256 === hash(resolve(canonical, kernel))) ?? null;
  if (!receipt) return empty;
  const prefix = receipt.path.slice(0, -kernel.length);
  const present = new Map(modules.map(module => [module.path, module.sha256]));
  for (const path of intrinsics) {
    if ((present.get(prefix + path) ?? null) !== hash(resolve(canonical, path))) {
      throw new Error("Native Thistle intrinsic does not match the pinned source: " + prefix + path);
    }
  }
  const roots = [kernel, "src/native/abi.ts", "src/native/vfs.ts", "src/native/thx.ts", "src/native/start.ts"];
  const native = ts.createProgram(roots.map(path => resolve(canonical, path)), {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], noEmit: true
  });
  const preservedModules: string[] = [];
  for (const file of native.getSourceFiles()) {
    if (file.isDeclarationFile) continue;
    const path = prefix + relative(canonical, file.fileName).replaceAll("\\", "/");
    const original = present.get(path) ?? null;
    if (original === null) continue;
    if (original !== hash(file.fileName)) throw new Error("Native Thistle module does not match the pinned source: " + path);
    const staged = resolve(dirname(input.project), "source", path);
    if (hash(staged) !== original) throw new Error("Native Thistle module was rewritten before profile selection: " + path);
    preservedModules.push(staged);
  }
  const typeAliases = {
    I8: "i8", U8: "u8", I16: "i16", U16: "u16", I32: "i32", U32: "u32",
    I64: "i64", U64: "u64", F32: "f32", F64: "f64", Ptr: "u32", ThistleMemory: "usize"
  };
  const abiTypes: ThistleWasm["abiTypes"] = {};
  for (const name of Object.keys(typeAliases)) abiTypes[name] = name === "I64" || name === "U64" ? "bigint" : "number";
  return { preservedModules, memory: { initialPages: THISTLE_WASM_INITIAL_PAGES, maximumPages: THISTLE_WASM_MAXIMUM_PAGES }, intrinsicModules: intrinsics.map(path => resolve(dirname(input.project), "source", prefix + path)), typeAliases, abiTypes };
}

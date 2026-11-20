import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { json } from "./project.ts";
import type { LoweredProject, SourceManifest } from "./lower/index.ts";
import type { WatLayout } from "../baguette/src/wat-modules.ts";
import { prepareWasmAbi } from "./wasm-abi.ts";
import { prepareWasmSource } from "./lower/prepare-wasm.ts";
import { wasmPrelude } from "./lower/wasm.ts";
import { nativeWidths } from "./lower/integers.ts";
import { nullableAliases } from "./lower/nullish.ts";
import { requiredAliases } from "./lower/required.ts";

const sourceManifest: (text: string) => SourceManifest = JSON.parse;
const watLayout: (text: string) => WatLayout = JSON.parse;

/** Use the released Baguette entry point until its emitter is available as a reusable API. */
export function emitWasm(compiler: string, input: LoweredProject, outputDir: string): void {
  const config = resolve(dirname(input.project), "baguette.config.json");
  const intrinsicModules = prepareWasmSource(input);
  const abi = prepareWasmAbi(input);
  json(config, {
    schema: 1,
    name: "Leek",
    project: input.project,
    ...abi,
    intrinsicModules,
    preludeFile: wasmPrelude(compiler, dirname(input.project)),
    typeAliases: { ...abi.typeAliases, ...nativeWidths, ...nullableAliases, ...requiredAliases },
    generatedDir: resolve(outputDir, "wat"),
    outDir: outputDir,
    moduleBaseName: "leek",
    abi: { exports: "all-exported-functions" },
    memory: { initialPages: 1024, maximumPages: 32768, import: true, export: false },
    runtime: "incremental",
    variants: [{ name: "leek", threaded: false }],
    allowedHostImports: [
      { module: "env", name: "memory", kind: "memory" },
      { module: "env", name: "abort", kind: "function" }
    ],
    completeKernel: false,
    materialiseInferredTypes: true,
    asyncLowering: "state-machine"
  });
  // Baguette performs its own Bake stage; select the hosted engine explicitly.
  execFileSync(process.execPath, [
    resolve(compiler, "src/compiler.ts"), "--config", config, "--emit-modular-wat"
  ], { cwd: compiler, stdio: "inherit", env: { ...process.env, BAKE_ENGINE: "host" } });
  const source = sourceManifest(readFileSync(input.sourceManifest, "utf8"));
  const layout = watLayout(readFileSync(resolve(outputDir, "wat/leek/layout.json"), "utf8"));
  const matched = new Set<string>();
  for (const module of source.modules.filter(module => !module.path.endsWith(".d.ts"))) {
    const candidates = layout.modules.filter(emitted => module.path === emitted.source || module.path.endsWith("/" + emitted.source));
    const emitted = candidates[0] ?? null;
    assert.ok(candidates.length === 1 && emitted !== null && !matched.has(emitted.source), "Missing or ambiguous WAT source module: " + module.path);
    matched.add(emitted.source);
  }
  copyFileSync(input.sourceManifest, resolve(outputDir, "canonical-source.json"));
}

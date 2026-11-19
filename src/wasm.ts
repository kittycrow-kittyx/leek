import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { json } from "./project.ts";
import type { LoweredProject } from "./lower/index.ts";
import { prepareWasmAbi } from "./wasm-abi.ts";
import { prepareWasmSource } from "./lower/wasm.ts";
import { nativeWidths } from "./lower/integers.ts";

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
    ...(intrinsicModules.length ? { preludeFile: resolve(compiler, "prelude/teto-baseline.ts") } : {}),
    typeAliases: { ...abi.typeAliases, ...nativeWidths },
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
}

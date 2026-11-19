import { resolve } from "node:path";
import { requireBake, requirePin, type Target } from "./project.ts";
import type { LoweredProject } from "./lower/index.ts";
import { emitWasm } from "./wasm.ts";

const compilers = { wasm: "baguette", clang: "croissant", rust: "crust" } as const;

interface Request {
  root: string;
  work: string;
  selected: Target;
  input: LoweredProject;
  validateOnly: boolean;
  emit: boolean;
}

// Each backend owns its Bake revision; analysis and validation must finish before any native emitter runs.
export async function build(req: Request): Promise<void> {
  const { root, work, selected, input, validateOnly, emit } = req;
  const compiler = requirePin(root, compilers[selected]);
  requireBake(compiler);
  if (selected === "wasm" && emit && !validateOnly) {
    emitWasm(compiler, input, resolve(root, "dist", selected));
    return;
  }
  const { bake, printBakeResult } = await compilerBake(selected);
  const lowered = resolve(work, "lowered");
  const result = bake({
    project: input.project, outDir: lowered,
    reportFile: resolve(work, "bake-report.json"),
    target: selected, engine: "host", wasmFile: null, validateOnly, failOnWarnings: true
  });
  printBakeResult(result);
  if (!result.success) throw new Error("Lowering failed");
  if (!emit || validateOnly || selected === "wasm") return;
  const manifestPath = resolve(lowered, "bake-manifest.json");
  const outputDir = resolve(root, "dist", selected);
  switch (selected) {
    case "clang": {
      const { compile } = await import("../croissant/src/compiler.ts");
      compile({ manifestPath, outputDir });
      break;
    }
    case "rust": {
      const { compile } = await import("../crust/src/compiler.ts");
      compile({ manifestPath, outputDir });
      break;
    }
  }
}

function compilerBake(selected: Target) {
  switch (selected) {
    case "wasm": return import("../baguette/bake/src/index.ts");
    case "clang": return import("../croissant/bake/src/index.ts");
    case "rust": return import("../crust/bake/src/index.ts");
  }
}

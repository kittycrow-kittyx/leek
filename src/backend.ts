import { resolve } from "node:path";
import { requireBake, requirePin, type Target } from "./project.ts";
import type { LoweredProject } from "./lower/index.ts";

const compilers = { wasm: "baguette", clang: "croissant", rust: "crust" } as const;

interface Request {
  root: string;
  work: string;
  selected: Target;
  input: LoweredProject;
  validateOnly: boolean;
  emit: boolean;
}

export async function build(req: Request): Promise<void> {
  const { root, work, selected, input, validateOnly, emit } = req;
  const compiler = requirePin(root, compilers[selected]);
  const bakeRoot = requireBake(compiler);
  const { bake, printBakeResult } = await import(resolve(bakeRoot, "src/index.ts")) as typeof import("../baguette/vendor/bake/src/index.ts");
  const lowered = resolve(work, "lowered");
  const result = bake({
    project: input.project, outDir: lowered,
    reportFile: resolve(work, "bake-report.json"),
    target: selected, engine: "host", validateOnly, failOnWarnings: true
  });
  printBakeResult(result);
  if (!result.success) throw new Error("Lowering failed");
  if (!emit || validateOnly) return;
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
    case "wasm":
      throw new Error("WASM emission requires Baguette's importable emitter API");
  }
}

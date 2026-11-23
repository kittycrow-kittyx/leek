import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import type { LoweredProject, SourceManifest } from "./index.ts";

const decodeManifest: (text: string) => SourceManifest = JSON.parse;
const hostModule = "thistle/src/core/kernel.ts";
const explicitOptions = "src/native/kernel-options.ts";
const hostImports = [
  'import { defaultKernelOptions } from "./host-options.js";',
  'import type { KernelOptions } from "./host-options.js";',
  'export type { KernelOptions } from "./host-options.js";',
];

/**
 * The mikuOS kernel constructor always receives explicit network/WASI options.
 * Rebind only Thistle's unused implicit *host* default to the canonical
 * mikuOS-owned adapter before Bake sees the native-target dependency graph.
 * Upstream Thistle and the original source receipts are never rewritten.
 */
export function bindNativeKernelOptions(input: LoweredProject): boolean {
  const root = resolve(dirname(input.project), "source");
  const kernel = resolve(root, hostModule);
  const adapter = resolve(root, explicitOptions);
  if (!existsSync(kernel) || !existsSync(adapter)) return false;

  const receipt = decodeManifest(readFileSync(input.sourceManifest, "utf8"));
  for (const path of [hostModule, explicitOptions, "src/main/boot.ts"]) {
    if (!receipt.modules.some(module => module.path === path)) {
      throw new Error("Canonical native host-options boundary missing source receipt: " + path);
    }
  }
  const boot = readFileSync(resolve(root, "src/main/boot.ts"), "utf8");
  if (!/new\s+Kern\s*\(\s*kernelOptions\s*\(/.test(boot)) {
    throw new Error("Native host-options binding requires explicit canonical mikuOS constructor options");
  }

  const path = relative(dirname(kernel), adapter).split(sep).join("/").replace(/\.ts$/, ".js");
  if (!path.startsWith("../")) throw new Error("Native host-options adapter escaped its expected source layout");
  let output = readFileSync(kernel, "utf8");
  for (const original of hostImports) {
    if (output.split(original).length !== 2) {
      throw new Error("Pinned Thistle host-options contract changed: " + original);
    }
    output = output.replace(original, original.replace("./host-options.js", path));
  }

  // Reject direct use of the implicit hosted default in the source graph.
  const config = ts.readJsonConfigFile(input.project, ts.sys.readFile);
  const parsed = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, dirname(input.project), {}, input.project);
  if (parsed.errors.length) throw new Error("Cannot inspect canonical source graph for native host binding");
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) &&
          node.expression.text === "Kern" && (!node.arguments || node.arguments.length === 0)) {
        throw new Error("Implicit Kern() construction is not supported by the native host-options boundary: " + file.fileName);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  writeFileSync(kernel, output);
  return true;
}

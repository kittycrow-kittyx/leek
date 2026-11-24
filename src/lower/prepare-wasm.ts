import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import type { LoweredProject } from "./index.ts";
import { lowerWasm, multiplyReference, floatReference, integerReference, uncheckedReference } from "./wasm.ts";
import { viewReference } from "./views.ts";
import { lowerNullable, referenceRead } from "./nullish.ts";
import { lowerClosures } from "./closures.ts";
import { lowerRequired } from "./required.ts";
import { lowerPlatform } from "./platform.ts";
import { exceptionReference, lowerNativeExceptions } from "./native-exceptions.ts";
import { bindNativeKernelOptions } from "./native-host-options.ts";

const intrinsicFile = "__leek_wasm_intrinsics.ts";

interface StagedGraph { files: string[]; options: ts.CompilerOptions; root: string; preserved: ReadonlySet<string> }

function stagedGraph(input: LoweredProject, preserved: readonly string[]): StagedGraph {
  const config = ts.readJsonConfigFile(input.project, ts.sys.readFile);
  const parsed = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, dirname(input.project), {}, input.project);
  if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  return { files: parsed.fileNames, options: parsed.options, root: resolve(dirname(input.project), "source"), preserved: new Set(preserved) };
}

/** Each phase resolves the previous phase's written source and validates every path before rewriting a file. */
function rewriteGraph(graph: StagedGraph, lower: (file: ts.SourceFile, checker: ts.TypeChecker, files: ts.SourceFile[]) => string, exclude = ""): void {
  const program = ts.createProgram(graph.files, graph.options);
  const checker = program.getTypeChecker();
  const files = stagedFiles(program, graph.root).filter(file => file.fileName !== exclude && !graph.preserved.has(file.fileName));
  for (const file of files) {
    const output = lower(file, checker, files);
    if (output !== file.text) writeFileSync(file.fileName, output);
  }
}

function intrinsicPath(file: ts.SourceFile, intrinsic: string): string {
  const path = relative(dirname(file.fileName), intrinsic).split(sep).join("/").replace(/\.ts$/, ".js");
  return path.startsWith(".") ? path : "./" + path;
}

/** Apply the WASM extension to the staged graph before Baguette's mandatory Bake stage. */
export function prepareWasmSource(input: LoweredProject, preserved: readonly string[] = []): string[] {
  const graph = stagedGraph(input, preserved);
  bindNativeKernelOptions(input);
  const intrinsic = resolve(graph.root, intrinsicFile);
  const references = new Set<string>();
  let intrinsicWritten = false;
  const writeReferences = (): void => {
    if (!references.size) return;
    writeFileSync(intrinsic, [...references].join(""), { flag: intrinsicWritten ? "w" : "wx" });
    intrinsicWritten = true;
  };
  rewriteGraph(graph, lowerPlatform);
  rewriteGraph(graph, lowerClosures);
  rewriteGraph(graph, (file, checker) => {
    const output = lowerNullable(file, checker, intrinsicPath(file, intrinsic));
    if (output.usesReferenceRead) references.add(referenceRead);
    return output.text;
  });
  writeReferences();
  rewriteGraph(graph, (file, checker) => lowerNullable(file, checker).text, intrinsic);
  const program = ts.createProgram(graph.files, graph.options);
  const checker = program.getTypeChecker();
  for (const [file, text] of lowerRequired(stagedFiles(program, graph.root).filter(file => file.fileName !== intrinsic && !graph.preserved.has(file.fileName)), checker)) {
    if (text !== readFileSync(file, "utf8")) writeFileSync(file, text);
  }
  rewriteGraph(graph, (file, checker, files) => {
    const output = lowerNativeExceptions(file, checker, intrinsicPath(file, intrinsic), files);
    if (output.used) references.add(exceptionReference);
    return output.text;
  }, intrinsic);
  writeReferences();
  rewriteGraph(graph, (file, checker) => {
    const output = lowerWasm(file, checker, intrinsicPath(file, intrinsic));
    if (output.usesMultiply) references.add(multiplyReference);
    if (output.usesPredicates) references.add(floatReference);
    if (output.usesCoercion) references.add(integerReference);
    if (output.usesUnchecked) references.add(uncheckedReference);
    for (const name of output.views) references.add(viewReference(name));
    return output.text;
  }, intrinsic);
  if (!references.size) return [];
  writeReferences();
  return [intrinsic];
}

function stagedFiles(program: ts.Program, root: string): ts.SourceFile[] {
  const files = program.getSourceFiles().filter(file => !file.isDeclarationFile && !program.isSourceFileFromExternalLibrary(file));
  for (const file of files) {
    const path = relative(root, realpathSync(file.fileName));
    if (isAbsolute(path) || path === ".." || path.startsWith(".." + sep)) throw new Error("WASM source outside staging tree: " + file.fileName);
  }
  return files;
}


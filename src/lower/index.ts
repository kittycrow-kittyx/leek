import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { createProject } from "../project.ts";
import { lowerNumeric } from "./numeric.ts";

export interface LoweredProject {
  project: string;
  entry: string;
  files: number;
}

/** Check the original graph first so lowering never copies invalid or out-of-tree source into the compiler workspace. */
export function stageSource(source: string, entry: string, work: string): LoweredProject {
  const original = resolve(work, "original.json");
  createProject(source, [entry], original);
  const parsed = ts.getParsedCommandLineOfConfigFile(original, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => fail([diagnostic])
  }) ?? null;
  if (!parsed) throw new Error("Cannot read staged compiler configuration");
  if (parsed.errors.length) fail(parsed.errors);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) fail(errors);
  const checker = program.getTypeChecker();
  const root = resolve(source, "src");
  const staged = resolve(work, "source");
  let files = 0;
  for (const file of program.getSourceFiles()) {
    if (program.isSourceFileDefaultLibrary(file) || program.isSourceFileFromExternalLibrary(file)) continue;
    const rel = relative(root, file.fileName);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep)) {
      throw new Error("Source dependency outside mikuOS/src: " + file.fileName);
    }
    const path = resolve(staged, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.isDeclarationFile ? file.text : lowerNumeric(file, checker));
    files++;
  }
  const stagedEntry = resolve(staged, relative(root, entry));
  const project = resolve(work, "tsconfig.json");
  createProject(source, [stagedEntry], project, staged);
  return { project, entry: stagedEntry, files };
}

function fail(diagnostics: readonly ts.Diagnostic[]): never {
  throw new Error(ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n"
  }));
}

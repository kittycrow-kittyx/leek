import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { createProject, json } from "../project.ts";
import { lowerNumeric } from "./numeric.ts";

export interface LoweredProject {
  project: string;
  entry: string;
  files: number;
  sourceManifest: string;
}

export interface SourceManifest {
  schema: 1;
  entry: string;
  modules: { path: string; sha256: string }[];
}

/** Check the original graph first so lowering never copies invalid or out-of-tree source into the compiler workspace. */
export function stageSource(source: string, entry: string, work: string, lowerPredicates = true): LoweredProject {
  const original = resolve(work, "original.json");
  createProject(source, [entry], original, source);
  const config = ts.readJsonConfigFile(original, ts.sys.readFile);
  const parsed = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, work, {}, original);
  if (parsed.errors.length) fail(parsed.errors);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) fail(errors);
  const checker = program.getTypeChecker();
  const root = realpathSync(source);
  const staged = resolve(work, "source");
  let files = 0;
  const modules: { path: string; sha256: string }[] = [];
  for (const file of program.getSourceFiles()) {
    if (program.isSourceFileDefaultLibrary(file) || program.isSourceFileFromExternalLibrary(file)) continue;
    const rel = relative(root, realpathSync(file.fileName));
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep)) {
      throw new Error("Source dependency outside canonical mikuOS checkout: " + file.fileName);
    }
    const path = resolve(staged, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.isDeclarationFile || !lowerPredicates ? file.text : lowerNumeric(file, checker));
    modules.push({ path: rel.split(sep).join("/"), sha256: createHash("sha256").update(readFileSync(file.fileName)).digest("hex") });
    files++;
  }
  const stagedEntry = resolve(staged, relative(root, entry));
  const project = resolve(work, "tsconfig.json");
  createProject(source, [stagedEntry], project, staged);
  const sourceManifest = resolve(work, "source-manifest.json");
  modules.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const manifest: SourceManifest = { schema: 1, entry: relative(root, entry).split(sep).join("/"), modules };
  json(sourceManifest, manifest);
  return { project, entry: stagedEntry, files, sourceManifest };
}

function fail(diagnostics: readonly ts.Diagnostic[]): never {
  throw new Error(ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n"
  }));
}

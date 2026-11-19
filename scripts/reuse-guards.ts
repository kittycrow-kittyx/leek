import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "@kitty-crow/code-guards/src/project.ts";
import { renderFindings } from "@kitty-crow/code-guards/src/diagnostics.ts";
import { crossModule, functionQuality, typeReuse } from "@kitty-crow/code-guards/src/guards/index.ts";
import { failed, type Finding } from "@kitty-crow/code-guards/src/model.ts";
import { json, requireBake, requirePin } from "../src/project.ts";
import { owned, scoped } from "./scope.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backends = ["baguette", "croissant", "crust"];

function trackedSources(checkout: string): string[] {
  return execFileSync("git", ["-C", checkout, "ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(path => /^(?:src|test|tests|scripts|prelude)\//.test(path) && /\.[cm]?tsx?$/.test(path) && !/\.d\.[cm]?ts$/.test(path));
}

function upstreamFiles(view: string): string[] {
  const files: string[] = [];
  for (const name of backends) {
    const compiler = requirePin(root, name);
    const bake = requireBake(compiler);
    files.push(...trackedSources(compiler).map(path => resolve(view, name, path)));
    // Every backend pins the same Bake revision. Scan one copy of it.
    if (name === "baguette") files.push(...trackedSources(bake).map(path => resolve(view, name, "bake", path)));
  }
  return files;
}

function overlaps(view: string, finding: Finding): boolean {
  if (!["CG101", "CG102", "CG103", "CG205", "CG304"].includes(finding.code) || !("related" in finding)) return false;
  return owned(view, resolve(view, finding.location.file)) !== owned(view, resolve(view, finding.related.file));
}

async function check(view: string): Promise<number> {
  const local = loadProject(resolve(view, "tsconfig.json"));
  const ownFiles = local.files.filter(file => owned(view, file.fileName)).map(file => file.fileName);
  const files = [...new Set([...upstreamFiles(view), ...ownFiles])];
  const config = resolve(view, "tsconfig.reuse.json");
  json(config, {
    extends: "./tsconfig.json",
    compilerOptions: { preserveSymlinks: true },
    files: files.map(file => relative(view, file)), include: [], exclude: []
  });
  const loaded = loadProject(config);
  const selected = new Set(files);
  // Drop transitive copies of Bake and dependencies outside the selected files.
  const project = { ...loaded, files: loaded.files.filter(file => selected.has(file.fileName)) };
  console.log("Cross-repository reuse scan: " + project.files.length + " source files");
  const findings = [
    ...await typeReuse(project, true),
    ...await functionQuality(project, true),
    ...crossModule(project)
  ].filter(finding => overlaps(view, finding));
  mkdirSync("logs", { recursive: true });
  writeFileSync("logs/code-guards-reuse.json", renderFindings(findings, { root: view, format: "json", colour: "never" }) + "\n");
  console.log(renderFindings(findings, { root: view, format: "text", colour: "auto" }));
  return failed(findings, true) ? 1 : 0;
}

process.exitCode = await scoped(check);

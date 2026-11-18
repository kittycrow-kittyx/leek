import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

export type Target = "wasm" | "clang" | "rust";
export const target = (value: string): Target => {
  if (value === "wasm" || value === "clang" || value === "rust") return value;
  throw new Error("Expected target wasm, clang or rust");
};

export const json = (file: string, value: object): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
};

export function sourceEntry(source: string, entry: string): string {
  const root = realpathSync(resolve(source, "src"));
  if (isAbsolute(entry)) throw new Error("Entry must be relative to mikuOS");
  const candidate = realpathSync(resolve(source, entry));
  const rel = relative(root, candidate);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel) || !candidate.endsWith(".ts") || candidate.endsWith(".d.ts")) {
    throw new Error("Entry must be a TypeScript implementation within mikuOS/src");
  }
  return candidate;
}

type JsonValue = null | boolean | number | string | JsonValue[] | JsonRecord;
interface JsonRecord { [key: string]: JsonValue }

// JSON without a reviver has only these value forms; validate the dependency
// record before using a path or revision from the file.
const decode: (text: string) => JsonValue = JSON.parse;
function record(value: JsonValue): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function list(value: JsonValue): value is JsonValue[] {
  return Array.isArray(value);
}

export function requirePin(root: string, name: string): string {
  const lock = decode(readFileSync(resolve(root, "project.dependencies.json"), "utf8"));
  if (!record(lock)) throw new Error("Invalid dependency lock");
  const dependencies = lock["dependencies"] ?? null;
  if (!list(dependencies)) throw new Error("Invalid dependency list");
  for (const item of dependencies) {
    if (!record(item)) continue;
    if ((item["path"] ?? null) !== name) continue;
    const commit = item["commit"] ?? null;
    if (typeof commit !== "string" || !/^[a-f0-9]{40}$/.test(commit)) break;
    return checkPin(resolve(root, name), commit);
  }
  throw new Error("Missing immutable pin for " + name);
}

function checkPin(checkout: string, commit: string): string {
  if (!existsSync(resolve(checkout, ".git"))) throw new Error("Initialise dependency " + checkout);
  const git = (...args: string[]): string => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
  if (git("rev-parse", "HEAD") !== commit) throw new Error("Dependency pin mismatch: " + checkout);
  if (git("status", "--porcelain", "--untracked-files=no", "--ignore-submodules=all")) throw new Error("Tracked source changes in " + checkout);
  return checkout;
}

export function requireBake(compiler: string): string {
  const entry = execFileSync("git", ["-C", compiler, "ls-tree", "HEAD", "--", "vendor/bake"], { encoding: "utf8" }).trim();
  if (!/^160000 commit [a-f0-9]{40}\tvendor\/bake$/.test(entry)) throw new Error("Compiler does not pin Bake");
  return checkPin(resolve(compiler, "vendor", "bake"), entry.slice(14, 54));
}

export function createProject(source: string, entries: readonly string[], project: string, rootDir = resolve(source, "src")): void {
  if (!entries.length) throw new Error("At least one mikuOS entry is required");
  json(project, {
    extends: resolve(source, "tsconfig.json"),
    compilerOptions: {
      noEmit: true, incremental: false, composite: false,
      declaration: false, declarationMap: false, sourceMap: false,
      rootDir
    },
    files: entries, include: [], exclude: []
  });
}

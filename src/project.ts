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

interface Dependency { path: string; commit: string; repository: string }
export function requirePin(root: string, name: string): string {
  const lock = JSON.parse(readFileSync(resolve(root, "project.dependencies.json"), "utf8")) as { dependencies: Dependency[] };
  const item = lock.dependencies.find(dep => dep.path === name);
  if (!item || !/^[a-f0-9]{40}$/.test(item.commit)) throw new Error("Missing immutable pin for " + name);
  return checkPin(resolve(root, item.path), item.commit);
}

function checkPin(checkout: string, commit: string): string {
  if (!existsSync(resolve(checkout, ".git"))) throw new Error("Initialise dependency " + checkout);
  const git = (...args: string[]): string => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
  if (git("rev-parse", "HEAD") !== commit) throw new Error("Dependency pin mismatch: " + checkout);
  if (git("status", "--porcelain", "--untracked-files=no", "--ignore-submodules=all")) throw new Error("Tracked source changes in " + checkout);
  return checkout;
}

export function requireBake(baguette: string): string {
  const entry = execFileSync("git", ["-C", baguette, "ls-tree", "HEAD", "--", "vendor/bake"], { encoding: "utf8" }).trim();
  const match = /^160000 commit ([a-f0-9]{40})\tvendor\/bake$/.exec(entry);
  if (!match?.[1]) throw new Error("Baguette does not pin Bake");
  return checkPin(resolve(baguette, "vendor", "bake"), match[1]);
}

export function createProject(source: string, entries: readonly string[], project: string): void {
  if (!entries.length) throw new Error("At least one mikuOS entry is required");
  json(project, {
    extends: resolve(source, "tsconfig.json"),
    compilerOptions: {
      noEmit: true, incremental: false, composite: false,
      declaration: false, declarationMap: false, sourceMap: false,
      rootDir: resolve(source, "src")
    },
    files: entries, include: [], exclude: []
  });
}

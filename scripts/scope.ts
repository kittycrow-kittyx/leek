import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(...args: string[]): string[] {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).split("\0").filter(Boolean);
}

const links = git("ls-files", "--stage", "-z")
  .filter(entry => entry.startsWith("160000 "))
  .map(entry => entry.slice(entry.indexOf("\t") + 1));

function dependency(path: string): boolean {
  return links.some(link => path === link || path.startsWith(link + sep));
}

function copy(view: string, path: string): void {
  const source = resolve(root, path);
  if (dependency(path) || !existsSync(source) || !lstatSync(source).isFile()) return;
  const destination = resolve(view, path);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function link(view: string, path: string): void {
  const destination = resolve(view, path);
  mkdirSync(dirname(destination), { recursive: true });
  symlinkSync(resolve(root, path), destination, "dir");
}

export function owned(view: string, file: string): boolean {
  const path = relative(view, file);
  return !dependency(path);
}

export function scoped<T>(analyse: (view: string) => Promise<T>): Promise<T> {
  const view = mkdtempSync(resolve(tmpdir(), "leek-guards-"));
  return scan(view, analyse);
}

async function scan<T>(view: string, analyse: (view: string) => Promise<T>): Promise<T> {
  try {
    const files = new Set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z"));
    for (const path of files) copy(view, path);
    for (const path of [...links, "node_modules"]) link(view, path);
    return await analyse(view);
  } finally {
    rmSync(view, { recursive: true, force: true });
  }
}

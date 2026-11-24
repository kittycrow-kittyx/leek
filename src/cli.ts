#!/usr/bin/env bun
import { realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { options } from "./args.ts";
import { build } from "./backend.ts";
import { stageSource } from "./lower/index.ts";
import { sourceEntry } from "./project.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = "leek [--target=wasm|clang|rust] [--source PATH] [--entry PATH] [--out-dir PATH] [--validate-only]";
const args = process.argv.slice(2);

async function main(): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage);
    return;
  }
  const { command, source: input, selected, entry, validateOnly, output } = options(args, process.cwd());
  const source = realpathSync(input);
  const original = sourceEntry(source, entry);
  const work = resolve(root, "build", selected);
  const rel = relative(work, source);
  if (!rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))) {
    throw new Error("Source must be outside the build working directory");
  }
  rmSync(work, { recursive: true, force: true });
  const staged = stageSource(source, original, work, selected !== "wasm");
  await build({
    root, work, selected, input: staged, output: output ?? resolve(root, "dist", selected),
    validateOnly: validateOnly || command === "analyse", emit: command === "compile"
  });
}

try { await main(); }
catch (error) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unexpected failure";
  console.error("Leek: " + message);
  process.exitCode = 1;
}

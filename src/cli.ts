#!/usr/bin/env bun
import { realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createProject, json, requireBake, requirePin, sourceEntry } from "./project.ts";

import { options } from "./args.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const usage = "Leek Extends the Environment of KittyX\n" +
  "leek analyse|lower --source PATH [--target wasm|clang|rust] [--entry src/sh/lex.ts]\n" +
  "leek wasm --source PATH [--entry src/sh/lex.ts] [--validate-only]\n";

async function main(): Promise<void> {
  if (!args.length || args.includes("--help")) { console.log(usage); return; }
  const { command, source: input, selected, entry, validateOnly } = options(args, process.cwd());
  const source = realpathSync(input);
  const original = sourceEntry(source, entry);
  const baguette = requirePin(root, "baguette");
  requireBake(baguette);
  const work = resolve(root, "build", command + "-" + selected);
  const rel = relative(work, source);
  if (!rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))) {
    throw new Error("Source must be outside the build working directory");
  }
  rmSync(work, { recursive: true, force: true });
  const project = resolve(work, "input", "tsconfig.json");
  createProject(source, [original], project);
  console.log("Leek: authoritative mikuOS entry " + entry + " (" + selected + ")");
  if (command !== "wasm") {
    // Import the real upstream source, without generating a host JavaScript build.
    const { bake, printBakeResult } = await import("../baguette/vendor/bake/src/index.ts");
    const result = bake({
      project, outDir: resolve(work, "lowered"),
      reportFile: resolve(work, "bake-report.json"),
      target: selected, engine: "host", validateOnly: command === "analyse",
      failOnWarnings: true
    });
    printBakeResult(result);
    if (!result.success) process.exitCode = 1;
    return;
  }

  const config = resolve(work, "baguette.config.json");
  json(config, {
    schema: 1, name: "mikuOS", project, entries: [original],
    generatedDir: resolve(work, "generated"), outDir: resolve(root, "dist", "wasm"),
    moduleBaseName: "mikuos", intrinsicModules: [],
    abi: { exports: "all-exported-functions" },
    memory: { initialPages: 256, maximumPages: 32768, import: true, export: false },
    runtime: "incremental",
    variants: [{ name: "mikuos", threaded: false }],
    allowedHostImports: [{ module: "env", name: "memory", kind: "memory" }],
    materialiseInferredTypes: true, asyncLowering: "state-machine"
  });
  execFileSync(process.execPath, [
    resolve(baguette, "src", "compiler.ts"), "--config", config,
    ...(validateOnly ? ["--validate-only"] : [])
  ], { cwd: root, stdio: "inherit", env: { ...process.env, BAGUETTE_BAKE_ENGINE: "host" } });
}

try { await main(); }
catch (error) {
  console.error("Leek: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}

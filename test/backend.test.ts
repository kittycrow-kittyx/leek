import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/backend.ts";
import { stageSource } from "../src/lower/index.ts";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("WASM analysis applies the emission profile before inherited Bake validation", async () => {
  const root = mkdtempSync(join(tmpdir(), "leek-analysis-"));
  try {
    const source = join(root, "canonical");
    mkdirSync(join(source, "src"), { recursive: true });
    writeFileSync(join(source, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", strict: true, types: [], noEmit: true } }));
    const entry = join(source, "src/entry.ts");
    const original = 'export function capacity(): number { if (typeof navigator === "undefined") return 1; return navigator.hardwareConcurrency; }';
    writeFileSync(entry, original);
    const work = join(root, "work");
    const input = stageSource(source, entry, work, false);
    await build({ root: repository, work, selected: "wasm", input, output: join(root, "output"), validateOnly: true, emit: false });
    assert.equal(readFileSync(entry, "utf8"), original);
    assert.doesNotMatch(readFileSync(input.entry, "utf8"), /navigator/);
    const report = readFileSync(join(work, "bake-report.json"), "utf8");
    assert.match(report, /"success": true/);
    assert.doesNotMatch(report, /BK1102/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

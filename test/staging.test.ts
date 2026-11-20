import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stageSource } from "../src/lower/index.ts";
import { prepareWasmSource } from "../src/lower/wasm.ts";

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

test("staging follows the canonical boot entry into inherited kernel modules", () => {
  const root = mkdtempSync(join(tmpdir(), "leek-graph-"));
  const files = {
    "src/main/boot.ts": 'import { run } from "../../thistle/src/core/kernel.js"; export const boot = run;\n',
    "thistle/src/core/kernel.ts": 'import { word } from "../native/word.js"; export const run = (): number => word(42);\n',
    "thistle/src/native/word.ts": "export const word = (value: number): number => value;\n"
  };
  try {
    put(root, "tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, types: [], moduleResolution: "Bundler", module: "ESNext" } }));
    for (const [path, text] of Object.entries(files)) put(root, path, text);
    put(root, "src/test/unrelated.ts", "this is deliberately not a production module");
    const work = join(root, "build");
    const input = stageSource(root, join(root, "src/main/boot.ts"), work, false);
    assert.equal(input.files, 3);
    assert.equal(input.entry, join(work, "source/src/main/boot.ts"));
    const modules = Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1)
      .map(([path, text]) => ({ path, sha256: createHash("sha256").update(text).digest("hex") }));
    assert.equal(readFileSync(input.sourceManifest, "utf8"), JSON.stringify({ schema: 1, entry: "src/main/boot.ts", modules }, null, 2) + "\n");
    for (const [path, text] of Object.entries(files)) {
      assert.equal(readFileSync(join(work, "source", path), "utf8"), text);
      assert.equal(readFileSync(join(root, path), "utf8"), text);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a symlink cannot substitute source from outside the canonical checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "leek-boundary-"));
  try {
    put(root, "canon/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, types: [], moduleResolution: "Bundler", module: "ESNext" } }));
    put(root, "canon/src/entry.ts", 'export { value } from "./linked.js";');
    put(root, "outside.ts", "export const value = 42;");
    symlinkSync(join(root, "outside.ts"), join(root, "canon/src/linked.ts"));
    assert.throws(() => stageSource(join(root, "canon"), join(root, "canon/src/entry.ts"), join(root, "build"), false), /outside canonical mikuOS/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("absolute canonical imports cannot cause WASM passes to rewrite original files", () => {
  const root = mkdtempSync(join(tmpdir(), "leek-staged-boundary-"));
  try {
    const kernel = join(root, "canonical/thistle/kernel.ts");
    const original = 'function maybe(): string | null { return null; } export const value = (): string => maybe() ?? "fallback";';
    put(root, "canonical/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, types: [], moduleResolution: "Bundler", module: "ESNext" } }));
    put(root, "canonical/src/entry.ts", "export { value } from " + JSON.stringify(kernel.replace(/\.ts$/, ".js")) + ";");
    put(root, "canonical/thistle/kernel.ts", original);
    const input = stageSource(join(root, "canonical"), join(root, "canonical/src/entry.ts"), join(root, "build"), false);
    assert.throws(() => prepareWasmSource(input), /outside staging tree/);
    assert.equal(readFileSync(kernel, "utf8"), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

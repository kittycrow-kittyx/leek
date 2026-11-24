import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { bindNativeKernelOptions } from "../src/lower/native-host-options.ts";
import type { LoweredProject, SourceManifest } from "../src/lower/index.ts";

const imports = [
  'import { defaultKernelOptions } from "./host-options.js";',
  'import type { KernelOptions } from "./host-options.js";',
  'export type { KernelOptions } from "./host-options.js";',
];

function scenario(implicit = false): { input: LoweredProject; remove: () => void; kernel: string; host: string } {
  const workspace = mkdtempSync(join(tmpdir(), "leek-native-options-"));
  const root = join(workspace, "source");
  const kernel = resolve(root, "thistle/src/core/kernel.ts");
  const host = resolve(root, "thistle/src/net/host-fetch.ts");
  const boot = resolve(root, "src/main/boot.ts");
  const adapter = resolve(root, "src/native/kernel-options.ts");
  const hostOptions = resolve(root, "thistle/src/core/host-options.ts");
  const write = (path: string, content: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  write(kernel, imports.join("\n") + '\nexport class Kern { constructor(options: KernelOptions = defaultKernelOptions()) { void options; } }\n');
  write(host, 'export const hostFetch = (): typeof fetch => fetch;\n');
  write(hostOptions, 'import { hostFetch } from "../net/host-fetch.js";\nexport interface KernelOptions { name: string }\nexport const defaultKernelOptions = (): KernelOptions => ({name: String(hostFetch())});\n');
  write(adapter, 'export interface KernelOptions { name: string }\nexport const kernelOptions = (): KernelOptions => ({ name: "mikuOS" });\nexport const defaultKernelOptions = (): KernelOptions => { throw new Error("explicit only"); };\n');
  write(boot, 'import { Kern } from "../../thistle/src/core/kernel.js";\nimport { kernelOptions } from "../native/kernel-options.js";\nexport const boot = (): Kern => new Kern(' + (implicit ? "" : "kernelOptions()") + ');\n');
  const manifest: SourceManifest = {
    schema: 1, entry: "src/main/boot.ts", modules: [
      "thistle/src/core/kernel.ts", "src/native/kernel-options.ts", "src/main/boot.ts"
    ].map(path => ({ path, sha256: "original source receipt" }))
  };
  const sourceManifest = join(workspace, "source-manifest.json");
  writeFileSync(sourceManifest, JSON.stringify(manifest));
  const project = join(workspace, "tsconfig.json");
  writeFileSync(project, JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true,
    skipLibCheck: true
  }, files: [boot] }));
  return {
    kernel, host,
    input: { project, entry: boot, sourceManifest, files: 5 },
    remove: (): void => rmSync(workspace, { force: true, recursive: true }),
  };
}

test("native integration removes only the unused implicit host provider dependency", () => {
  const fixture = scenario();
  try {
    assert.equal(bindNativeKernelOptions(fixture.input), true);
    const lowered = readFileSync(fixture.kernel, "utf8");
    assert.ok(lowered.includes("../../../src/native/kernel-options.js"));
    assert.ok(!lowered.includes('from "./host-options.js"'));
    const program = ts.createProgram([fixture.input.entry], {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    });
    assert.ok(!program.getSourceFiles().some(file => file.fileName === fixture.host),
      "native entry retains host-fetch via unused default provider");
    assert.ok(program.getSourceFiles().some(file => file.fileName === fixture.kernel));
  } finally { fixture.remove(); }
});

test("native host binding rejects implicit constructor calls instead of providing a fake host", () => {
  const fixture = scenario(true);
  try {
    assert.throws(() => bindNativeKernelOptions(fixture.input), /explicit canonical mikuOS constructor options/);
    assert.ok(readFileSync(fixture.kernel, "utf8").includes('from "./host-options.js"'),
      "failed binding unexpectedly rewrote the canonical staged source");
  } finally { fixture.remove(); }
});

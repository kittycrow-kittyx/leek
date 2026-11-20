import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { lowerPlatform } from "../src/lower/platform.ts";

// These test scripts return a Number or string; validate that boundary before comparison.
const evaluate: (source: string, context: Record<string, never>) => number | string = runInNewContext;

function check(source: string, result: string): string {
  const root = mkdtempSync(join(tmpdir(), "leek-platform-"));
  try {
    const file = join(root, "entry.ts"); writeFileSync(file, source);
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, typeRoots: [resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/@types")], noEmit: true };
    const program = ts.createProgram([file], options);
    const input = program.getSourceFile(file) ?? null; assert.ok(input);
    const output = lowerPlatform(input, program.getTypeChecker());
    writeFileSync(file, output);
    const checked = ts.createProgram([file], options);
    assert.deepEqual(ts.getPreEmitDiagnostics(checked).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
    const execute = (text: string): string => {
      const value = evaluate(ts.transpile(text + "\n" + result, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), {});
      assert.ok(typeof value === "number" || typeof value === "string");
      return JSON.stringify(value);
    };
    assert.equal(execute(output), execute(source));
    return output;
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("native host probes retain canonical fallbacks without ambient JavaScript capabilities", () => {
  const source = `function capacity(): number {
    const browser = typeof navigator === "undefined" ? null : navigator;
    const memory = browser === null ? null : (browser as Navigator & {deviceMemory: number}).deviceMemory;
    if (memory !== null && memory > 0) return memory;
    if (typeof process === "undefined") return 2;
    const value = process.env["CAPACITY"];
    return value === "large" ? 4 : 3;
  }`;
  const output = check(source, "capacity()");
  assert.doesNotMatch(output, /process\.env|navigator;/);
});

test("local capability bindings retain their implementation", () => {
  const source = `function run(process: {value: number}, navigator: {value: number}): number { return (typeof process === "undefined" ? 0 : process.value) + (typeof navigator === "undefined" ? 0 : navigator.value); }`;
  assert.equal(check(source, "run({value: 3}, {value: 4})"), source);
});

test("unguarded host reads remain explicit capability requirements", () => {
  const source = 'function run(): number { return navigator.hardwareConcurrency; }';
  const root = mkdtempSync(join(tmpdir(), "leek-host-read-"));
  try {
    const file = join(root, "entry.ts"); writeFileSync(file, source);
    const program = ts.createProgram([file], { target: ts.ScriptTarget.ES2022, types: [] });
    const input = program.getSourceFile(file) ?? null; assert.ok(input);
    assert.equal(lowerPlatform(input, program.getTypeChecker()), source);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("hoisted declarations remain available before unreachable declaration statements", () => {
  const source = `function value(): number { return helper(); function helper(): number { return 42; } }
  function probe(): number { if (typeof process === "undefined") return value(); return 0; }`;
  assert.match(check(source, "probe()"), /function helper/);
});

test("early-exit pruning preserves lexical bindings observed through closures", () => {
  const source = `function value(): number { const read = (): number => later; return read(); const later = 42; }
  function probe(): string { if (typeof process === "undefined") { try { value(); } catch (error) { return error instanceof ReferenceError ? "temporal" : "other"; } } return "unexpected"; }`;
  assert.match(check(source, "probe()"), /const later/);
});

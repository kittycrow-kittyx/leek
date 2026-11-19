import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { floatReference, integerReference, lowerWasm, multiplyReference } from "../src/lower/wasm.ts";

function lowered(text: string, ambient = ""): string {
  const root = mkdtempSync(join(tmpdir(), "leek-wasm-"));
  try {
    const file = join(root, "source.ts");
    writeFileSync(file, text);
    const declarations = join(root, "ambient.d.ts");
    writeFileSync(declarations, ambient);
    const program = ts.createProgram([file, declarations], {
      target: ts.ScriptTarget.ES2022, strict: true, types: [],
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true
    });
    const source = program.getSourceFile(file) ?? null;
    assert.ok(source);
    return lowerWasm(source, program.getTypeChecker()).text;
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function execute(text: string, expression: string): string {
  const root = mkdtempSync(join(tmpdir(), "leek-wasm-reference-"));
  try {
    const file = join(root, "source.ts");
    writeFileSync(join(root, "__leek_wasm_intrinsics.ts"), multiplyReference + floatReference + integerReference);
    writeFileSync(file, text + "\nconsole.log(JSON.stringify(" + expression + "));");
    return execFileSync(process.execPath, [file], { encoding: "utf8" }).trim();
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("native numeric bindings preserve Number coercion and wraparound", () => {
  const input = "function calculate(a: number, b: number): number[] { return [a ^ b, a & b, a | b, a << b, a >> b, a >>> b, Math.imul(a, b)]; }";
  const output = lowered(input);
  assert.ok(output.includes("Math.imul(a, b)"));
  assert.match(output, /import \{ NativeMath \}/);
  assert.ok(!output.includes("function __leek_"));
  assert.ok(!output.includes("65535"));
  const values = "[NaN,Infinity,-Infinity,-4294967297,-2147483648,-1.9,-0,0,1.9,2147483647,4294967295,4294967296,9007199254740991]";
  const expression = values + ".flatMap(a => " + values + ".map(b => calculate(a,b)))";
  assert.equal(execute(output, expression), execute(input, expression));
});

test("typed-array loops preserve checksum and evaluate the iterable once", () => {
  const input = "let calls = 0; function bytes(): Uint8Array { calls++; return new Uint8Array([0,1,255,42]); } function checksum(): number { let value = 0x811c9dc5; for (const byte of bytes()) value = Math.imul(value ^ byte, 0x01000193); return value >>> 0; }";
  const output = lowered(input);
  assert.ok(!output.includes(" of bytes()"));
  assert.match(output, /for \(let /);
  assert.equal(execute(output, "[checksum(), calls]"), execute(input, "[checksum(), calls]"));
});

test("typed-array parameters retain their built-in identity after ambient augmentation", () => {
  const input = "function checksum(bytes: Uint8Array): number { let value = 0x811c9dc5; for (const byte of bytes) value = Math.imul(value ^ byte, 0x01000193); return value >>> 0; }";
  const ambient = "interface Uint8Array<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> { readonly leekFixture: number; }";
  const output = lowered(input, ambient);
  assert.ok(!output.includes(" of bytes"));
  assert.match(output, /for \(let /);
  const expression = "[[],[0],[255],[0,1,255,42]].map(bytes => checksum(new Uint8Array(bytes)))";
  assert.equal(execute(output, expression), execute(input, expression));
});

test("a locally declared typed-array lookalike is not a library array", () => {
  const input = "export {}; class Uint8Array { *[Symbol.iterator](): IterableIterator<number> { yield 1; } } function run(bytes: Uint8Array): void { for (const byte of bytes) { console.log(byte); } }";
  assert.equal(lowered(input), input);
});

test("WASM Number predicates bind the existing AssemblyScript F64 methods", () => {
  const input = "function check(n: number): boolean[] { return [Number.isNaN(n), Number.isFinite(n), Number.isInteger(n), Number.isSafeInteger(n)]; }";
  const output = lowered(input);
  assert.match(output, /import \{ F64 \}/);
  for (const method of ["isNaN", "isFinite", "isInteger", "isSafeInteger"]) assert.ok(output.includes("F64." + method + "("));
  assert.ok(!output.includes("__leek_is"));
  const expression = "[NaN,Infinity,-Infinity,-0,0,0.5,-0.5,42,-42,Number.MAX_VALUE,Number.MIN_VALUE,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1].map(check)";
  assert.equal(execute(output, expression), execute(input, expression));
});

test("WASM predicate binding respects local shadows", () => {
  const input = "function check(Number: { isFinite(n: number): boolean }): boolean { return Number.isFinite(3); }";
  assert.equal(lowered(input), input);
});

test("native storage requires every read and write to preserve modulo-32 semantics", () => {
  const cases = [
    "function run(): number { let value = 4294967295; value = Math.imul(value, 1); return value; }",
    "function run(): number { let value = 1; value += 4294967296; return value ^ 0; }",
    "function run(): number { let value = 1; const read = (): number => value; value = Math.imul(value, 1); return read(); }",
    "function run(): number { let value = 0; return (value = Math.imul(-1, 1)) > 0 ? 1 : 0; }"
  ];
  for (const input of cases) {
    const output = lowered(input);
    assert.ok(!output.includes("value: LeekNativeU32"));
    assert.equal(execute(output, "run()"), execute(input, "run()"));
  }
});

test("Bake's typed-array loop adapter preserves labels, nested loops and side effects", () => {
  const input = "function run(): number { let calls = 0; function bytes(): Uint8Array { calls++; return new Uint8Array([1,2,3]); } let sum = 0; outer: for (const a of bytes()) { for (const b of bytes()) { if (b === 2) continue outer; sum += a + b; } } return sum + calls * 100; }";
  const output = lowered(input);
  assert.match(output, /outer: for/);
  assert.equal(execute(output, "run()"), execute(input, "run()"));
});

test("integer coercion ignores locally shadowed Math objects", () => {
  const input = "function run(Math: { imul(a: number, b: number): number }): number { return 3.8 ^ 2.1; }";
  const output = lowered(input);
  assert.match(output, /NativeMath\.imul/);
  assert.equal(execute(output, "run({ imul: () => 99 })"), execute(input, "run({ imul: () => 99 })"));
});

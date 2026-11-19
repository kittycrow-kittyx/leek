import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { lowerWasm } from "../src/lower/wasm.ts";

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
    return lowerWasm(source, program.getTypeChecker());
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function execute(text: string, expression: string): string {
  const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return execFileSync(process.execPath, ["-e", code + "\nconsole.log(JSON.stringify(" + expression + "));"], { encoding: "utf8" }).trim();
}

test("WASM integer helpers preserve Number coercion and wraparound", () => {
  const input = "function calculate(a: number, b: number): number[] { return [a ^ b, a & b, a | b, a << b, a >> b, a >>> b, Math.imul(a, b)]; }";
  const output = lowered(input);
  assert.ok(!output.includes("Math.imul"));
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

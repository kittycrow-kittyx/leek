import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { lowerNullable } from "../src/lower/nullish.ts";

function check(input: string, transform = true): string {
  const root = mkdtempSync(join(tmpdir(), "leek-nullable-"));
  try {
    const file = join(root, "entry.ts");
    writeFileSync(file, input);
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, strict: true, types: [], noEmit: true, alwaysStrict: true };
    const program = ts.createProgram([file], options);
    const source = program.getSourceFile(file) ?? null;
    assert.ok(source);
    const lowered = transform ? lowerNullable(source, program.getTypeChecker()) : input;
    writeFileSync(file, lowered);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options));
    assert.deepEqual(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
    return execFileSync(process.execPath, [file], { encoding: "utf8" });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("nullable getters and fallbacks run once, in order and only when selected", () => {
  const source = `const events: string[] = [];
function fallback(): string { events.push("fallback"); return "fallback"; }
function run(value: string | null): string {
  const object = { get value(): string | null { events.push("getter"); return value; } };
  return object.value ?? fallback();
}
console.log(JSON.stringify([run(""), run("present"), run(null), events]));`;
  assert.equal(check(source), check(source, false));
});

test("nullable captures preserve recursion, lazy chains, loop evaluations and local type scopes", () => {
  const source = `let reads = 0;
function maybe(value: string | null): string | null { reads++; return value; }
function run(depth: number): string {
  if (depth === 0) return "root";
  { type Local = { value: string }; const obj = (): Local | null => depth > 1 ? { value: "v" } : null;
    const local = obj() ?? { value: run(depth - 1) };
    let result = local.value;
    for (let i = 0; i < 3; i++) result += maybe(null) ?? maybe(i === 1 ? "x" : null) ?? "y";
    return result;
  }
}
console.log(JSON.stringify([run(1), run(2), reads]));`;
  assert.equal(check(source), check(source, false));
});

test("undefined, generic values and suspended expressions are left for explicit lowering", () => {
  const source = `function get(): string | null | undefined { return undefined; }
function unresolved<T>(value: () => T | null, fallback: T): T { return value() ?? fallback; }
async function suspended(value: Promise<string | null>): Promise<string> { return await value ?? "fallback"; }
console.log(get() ?? "fallback", unresolved(() => undefined, "ok"));`;
  assert.equal(check(source), check(source, false));
  const root = mkdtempSync(join(tmpdir(), "leek-nullable-unresolved-"));
  try {
    const file = join(root, "entry.ts");
    writeFileSync(file, source);
    const program = ts.createProgram([file], { strict: true, types: [], target: ts.ScriptTarget.ES2022 });
    const input = program.getSourceFile(file) ?? null;
    assert.ok(input);
    assert.equal(lowerNullable(input, program.getTypeChecker()), readFileSync(file, "utf8"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Map defaults evaluate receiver and key once and preserve false, zero, NaN and lazy fallbacks", () => {
  const source = `const events: string[] = [];
const map = new Map<string, number>([["zero", 0], ["nan", NaN], ["value", 42]]);
function receiver(): Map<string, number> { events.push("receiver"); return map; }
function key(value: string): string { events.push("key:" + value); return value; }
function fallback(): number { events.push("fallback"); return -1; }
function run(value: string): number { return receiver().get(key(value)) ?? fallback(); }
const bool = new Map<string, boolean>([["false", false]]);
function flag(): boolean { return bool.get("false") ?? true; }
console.log(JSON.stringify([["zero", "nan", "value", "missing"].map(run), flag(), events]));`;
  assert.equal(check(source), check(source, false));
});

test("statically present values retain their effects and omit unreachable fallbacks", () => {
  const source = `const events: string[] = [];
function present(value: number): number { events.push("present"); return value; }
function fallback(): number { events.push("fallback"); return 9; }
function run(): number[] { return [Number(present(0)) ?? fallback(), Number(present(NaN)) ?? fallback()]; }
console.log(JSON.stringify([run(), events]));`;
  assert.equal(check(source), check(source, false));
});

test("type assertions do not erase missing-value fallbacks", () => {
  const source = `const values: number[] = new Array<number>(1);
function value(): number { return values[0]!; }
function run(): number[] { return [values[0]! ?? 7, value() ?? 9]; }
console.log(JSON.stringify(run()));`;
  assert.equal(check(source), check(source, false));
});

test("Map lookalikes and stored undefined values retain their original lookup behaviour", () => {
  const source = `export {};
class Map { get(key: string): string | undefined { return key === "present" ? "value" : undefined; } }
function lookup(key: string): string { return new Map().get(key) ?? "missing"; }
console.log(lookup("present"), lookup("absent"));`;
  assert.equal(check(source), check(source, false));
  const stored = `const map = new Map<string, number | undefined>([["key", undefined]]);
function run(): number { return map.get("key") ?? 7; }
console.log(run());`;
  assert.equal(check(stored), check(stored, false));
});

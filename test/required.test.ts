import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { lowerRequired } from "../src/lower/required.ts";

function transform(input: string, helper: string): { text: string; output: string } {
  const root = mkdtempSync(join(tmpdir(), "leek-required-"));
  try {
    const entry = join(root, "entry.ts");
    const library = join(root, "helper.ts");
    writeFileSync(entry, input); writeFileSync(library, helper);
    const expected = execFileSync(process.execPath, [entry], { encoding: "utf8" });
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noUncheckedIndexedAccess: true, types: [], noEmit: true };
    const program = ts.createProgram([entry, library], options);
    const files = program.getSourceFiles().filter(file => !file.isDeclarationFile);
    for (const [file, output] of lowerRequired(files, program.getTypeChecker())) writeFileSync(file, output);
    const checked = ts.createProgram([entry, library], options);
    assert.deepEqual(ts.getPreEmitDiagnostics(checked).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
    const actual = execFileSync(process.execPath, [entry], { encoding: "utf8" });
    assert.equal(actual, expected);
    return { text: readFileSync(entry, "utf8"), output: actual };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("numeric nullable consumers preserve presence, exception paths and argument order across modules", () => {
  const helper = `export const events: string[] = [];
export function checked<T>(value: T | null, expression: string): T {
  events.push("helper:" + expression);
  if (value === null) throw new Error("missing:" + expression);
  return value;
}`;
  const input = `import { checked as get, events } from "./helper.js";
const values = new Float64Array([0, -0, NaN, Infinity, -7]);
function array(): Float64Array { events.push("array"); return values; }
function key(index: number): number { events.push("index"); return index; }
function label(): string { events.push("label"); return "value"; }
function run(index: number): string {
  try { const value = get(array()[key(index)] ?? null, label()); return Object.is(value, -0) ? "-0" : String(value); }
  catch (error) { return error instanceof Error ? error.message : "unexpected"; }
}
console.log(JSON.stringify([[-1, -0, 0, 0.5, 1, 2, 3, 4, 5, NaN, Infinity].map(run), events]));`;
  const output = transform(input, helper);
  assert.match(output.text, /LeekRequiredIndex/);
  assert.doesNotMatch(output.text, /get\(array\(\)\[/);
});

test("mutable nullable parameters and rebound helpers retain their original calls", () => {
  const helper = `export function checked<T>(value: T | null, fallback: T): T { if (value === null) return fallback; [value] = [fallback]; return value; }`;
  const input = `import { checked } from "./helper.js";
function run(): number { return checked(new Uint8Array([0])[0] ?? null, 42); }
console.log(run());`;
  assert.equal(transform(input, helper).text, input);
  const rebound = `export {};
function checked<T>(value: T | null, fallback: T): T { if (value === null) return fallback; return value; }
let use = checked;
use = <T>(value: T | null, fallback: T): T => fallback;
function run(): number { return use(new Uint8Array([0])[0] ?? null, 42); }
console.log(run());`;
  assert.equal(transform(rebound, "export {};").text, rebound);
});

test("same-module eager calls see their specialisation before module statements execute", () => {
  const input = `export {};
function checked<T>(value: T | null, fallback: T): T { if (value === null) return fallback; return value; }
function run(index: number): number { return checked(new Uint8Array([0, 42])[index] ?? null, -7); }
console.log(run(0), run(1), run(2));`;
  assert.match(transform(input, "export {};").text, /namespace __leek_/);
});

test("cyclic helper modules retain hoisted calls during dependency initialisation", () => {
  const helper = `import { run } from "./entry.js";
console.log("early:" + run(0));
export function checked<T>(value: T | null, fallback: T): T { if (value === null) return fallback; return value; }`;
  const input = `import { checked } from "./helper.js";
export function run(index: number): number { return checked(new Uint8Array([0, 42])[index] ?? null, -7); }
console.log(run(2));`;
  assert.equal(transform(input, helper).text, input);
});

test("map consumers distinguish missing entries from zero, signed zero and NaN", () => {
  const helper = `export const events: string[] = [];
export function checked<T>(value: T | null, label: string): T { events.push("helper:" + label); if (value === null) throw new Error("missing"); return value; }`;
  const input = `import { checked, events } from "./helper.js";
const values = new Map<string, number>([["zero", 0], ["negative", -0], ["nan", NaN]]);
function receiver(): Map<string, number> { events.push("map"); return values; }
function key(value: string): string { events.push("key"); return value; }
function label(): string { events.push("label"); return "lookup"; }
function run(name: string): string { try { const result = checked(receiver().get(key(name)) ?? null, label()); return Object.is(result, -0) ? "-0" : String(result); } catch (error) { return error instanceof Error ? error.message : "other"; } }
console.log(JSON.stringify([["zero", "negative", "nan", "missing"].map(run), events]));`;
  assert.match(transform(input, helper).text, /\.has\(/);
});

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

test("bigint consumers preserve zero, 64-bit boundaries, missing keys and evaluation order", () => {
  const helper = `export const events: string[] = [];
export function checked<T>(value: T | null, message: string): T {
  events.push(message);
  if (value === null) throw new Error(message);
  return value;
}`;
  const input = `import { checked, events } from "./helper.js";
const values = new BigInt64Array([0n, -1n, 9223372036854775807n, -9223372036854775808n]);
const map = new Map<string, bigint>([["zero", 0n], ["high", 18446744073709551615n]]);
function receiver(): BigInt64Array { events.push("receiver"); return values; }
function label(): string { events.push("label"); return "absent"; }
function run(index: number): string { try { return String(checked(receiver()[index] ?? null, label())); } catch (error) { return error instanceof Error ? error.message : "unexpected"; } }
function lookup(key: string): string { try { return String(checked(map.get(key) ?? null, key)); } catch (error) { return error instanceof Error ? error.message : "unexpected"; } }
console.log(JSON.stringify([[-1,-0,0,0.5,1,2,3,4,NaN,Infinity].map(run), ["zero","high","missing"].map(lookup), events]));`;
  const output = transform(input, helper);
  assert.doesNotMatch(output.text, /checked\(receiver\(\)\[|checked\(map.get/);
  assert.match(output.text, /0n/);
});


test("checked code points distinguish NUL from absence after index conversion", () => {
  const helper = `export const events: string[] = [];
export function checked<T>(value: T | null, label: string): T { events.push(label); if (value === null) throw new Error(label); return value; }`;
  const input = `import { checked, events } from "./helper.js";
function source(): string { events.push("source"); return "\\0😀\\ud800Z"; }
function index(value: number): number { events.push("index"); return value; }
function label(): string { events.push("label"); return "missing"; }
function run(value: number): string { try { return String(checked(source().codePointAt(index(value)) ?? null, label())); } catch(error) { return error instanceof Error ? error.message : "unexpected"; } }
console.log(JSON.stringify([[-1,-0.5,-0,0,0.5,1,1.5,2,3,4,5,NaN,Infinity,-Infinity].map(run), events]));`;
  assert.doesNotMatch(transform(input, helper).text, /checked\(source\(\).codePointAt/);
});

test("optional primitive equality snapshots reads before later operands and distinguishes null from zero", () => {
  const input = `export {};
const events: string[] = [];
const values = new Float64Array([0,-0,NaN,7]);
const map = new Map<string,number>([["zero",0],["nan",NaN]]);
function receiver():Float64Array { events.push("receiver"); return values; }
function index(value:number):number { events.push("index"); return value; }
function other():number { events.push("other"); values[0]=9; return 0; }
function run(at:number):boolean[] {
  values[0]=0;
  const result = [(receiver()[index(at)] ?? null) === other()];
  values[0]=0;
  result.push(other() === (receiver()[index(at)] ?? null));
  for(const value of [0,-0,NaN,7]) result.push((values[at] ?? null) === value, value !== (values[at] ?? null));
  result.push((values[at] ?? null) === null, null !== (values[at] ?? null));
  return result;
}
function lookup(key:string,value:number):boolean[] { return [(map.get(key) ?? null) === value, value !== (map.get(key) ?? null), (map.get(key) ?? null) === null]; }
function wide(at:number):boolean[] { const items=new BigInt64Array([0n,-1n]); return [(items[at] ?? null) === 0n, -1n !== (items[at] ?? null), (items[at] ?? null) === null]; }
function point(at:number):boolean[] { const text="\\0😀"; return [(text.codePointAt(at) ?? null) === 0, 128512 !== (text.codePointAt(at) ?? null), (text.codePointAt(at) ?? null) !== null]; }
console.log(JSON.stringify([[-1,-0.5,-0,0,0.5,1,2,3,4,NaN,Infinity,4294967296].map(run),["zero","nan","missing"].map(key=>lookup(key,0)),[-1,0,1,2].map(wide),[-1,0,0.5,1,2,3,NaN,Infinity].map(point),events]));`;
  const output = transform(input, "export {};");
  assert.doesNotMatch(output.text, /\?\? null/);
  assert.match(output.text, /satisfies boolean/);
});

test("optional primitive comparisons retain coercing equality and unsupported storage domains", () => {
  const input = `export {};
function run(values:number[], key:number):boolean { return (values[key] ?? null) === 0; }
function loose(values:Uint8Array,key:number):boolean { return (values[key] ?? null) == 0; }
function missing(values:Map<number,number>,key:number):boolean { return (values.get(key) ?? null) === 0; }
console.log(run([],0),loose(new Uint8Array([0]),0),missing(new Map(),0));`;
  assert.equal(transform(input, "export {};").text, input);
});

test("String conversion of optional typed-array values preserves null, zero and evaluation order", () => {
  const input = `export {};
const events: string[] = [];
const values = new BigInt64Array([0n, -1n, 9223372036854775807n, -9223372036854775808n]);
function receiver(): BigInt64Array { events.push("receiver"); return values; }
function key(n: number): number { events.push("key:" + String(n)); return n; }
function run(n: number): string { return String(receiver()[key(n)] ?? null); }
console.log(JSON.stringify([[-2,-1,-0,0,0.5,1,2,3,4,NaN,Infinity].map(run),events]));`;
  const lowered = transform(input, "export {};");
  assert.doesNotMatch(lowered.text, /\?\? null/);
  assert.match(lowered.text, /satisfies string/);
  assert.match(lowered.text, /LeekRequiredIndex/);
});

test("optional primitive stringification respects shadowed String and existing source evaluation", () => {
  const source = `export {};
function run(String: (value: bigint | null) => string, values: BigInt64Array, index: number): string {
  return String(values[index] ?? null);
}
console.log(run(value => value === null ? "missing" : value.toString(), new BigInt64Array([0n]), 2));`;
  assert.equal(transform(source, "export {};").text, source);
});

test("optional numeric typed-array strings distinguish missing entries from signed zero and NaN", () => {
  const source = `export {};
const values = new Float64Array([0, -0, NaN, Infinity, -7]);
function run(n: number): string { return String(values[n] ?? null); }
console.log(JSON.stringify([-1,0,1,2,3,4,5,0.5,NaN,Infinity].map(run)));`;
  const output = transform(source, "export {};");
  assert.match(output.text, /satisfies string/);
});

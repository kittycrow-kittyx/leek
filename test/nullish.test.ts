import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { withTransformedSource, compareTransformedExecution } from "./transformed-source.ts";
import { lowerNullable, referenceRead } from "../src/lower/nullish.ts";

function check(input: string, transform = true): string {
  const root = mkdtempSync(join(tmpdir(), "leek-nullable-"));
  try {
    const file = join(root, "entry.ts");
    writeFileSync(file, input);
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, strict: true, types: [], noEmit: true, alwaysStrict: true };
    const program = ts.createProgram([file], options);
    const source = program.getSourceFile(file) ?? null;
    assert.ok(source);
    const lowered = transform ? lowerNullable(source, program.getTypeChecker()).text : input;
    writeFileSync(join(root, "__leek_wasm_intrinsics.ts"), referenceRead);
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
    assert.equal(lowerNullable(input, program.getTypeChecker()).text, readFileSync(file, "utf8"));
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

test("indexed defaults retain bounds, holes, UTF-16 units and evaluation order", () => {
  const source = `export {};
const events: string[] = [];
const strings = new Array<string>(3); strings[0] = ""; strings[2] = "last";
const bytes = new Uint8Array([0, 128, 255]);
function receiver(): string[] { events.push("receiver"); return strings; }
function key(value: number): number { events.push("key"); return value; }
function fallback(): string { events.push("fallback"); return "missing"; }
function run(index: number): object {
  return [receiver()[key(index)] ?? fallback(), bytes[key(index)] ?? -7, "A😀Z"[key(index)] ?? "missing"];
}
console.log(JSON.stringify([[-1, -0, 0, 0.5, 1, 2, 3, 4, NaN, Infinity, 4294967296].map(run), events]));`;
  assert.equal(check(source), check(source, false));
});

test("indexed native bindings reject source name collisions", () => {
  assert.throws(() => check('type LeekArrayIndex = string; function run(i: number): number { return new Uint8Array(1)[i] ?? 7; }'), /reserved indexed binding LeekArrayIndex/);
  assert.throws(() => check('function LeekReferenceAt(): void {} function run(i: number): string { return ["value"][i] ?? "missing"; }'), /reserved indexed binding LeekReferenceAt/);
});

test("reference removals preserve mutation, holes, receiver effects and lazy defaults", () => {
  const source = `export {};
const events: string[] = [];
const values = new Array<string>(3); values[0] = ""; values[2] = "last";
function receiver(): string[] { events.push("receiver"); return values; }
function fallback(): string { events.push("fallback:" + values.length); return "missing"; }
function run(): string[] { return [receiver().pop() ?? fallback(), receiver().shift() ?? fallback(), receiver().pop() ?? fallback(), receiver().shift() ?? fallback()]; }
console.log(JSON.stringify([run(), values.length, events]));`;
  assert.equal(check(source), check(source, false));
});

test("relative defaults preserve truncation, negative offsets and receiver evaluation", () => {
  const source = `export {};
const events: string[] = [];
const values = new Array<string>(3); values[0] = ""; values[2] = "last";
function receiver(): string[] { events.push("receiver"); return values; }
function key(value: number): number { events.push("key"); return value; }
function fallback(): string { events.push("fallback"); return "missing"; }
function run(index: number): string[] { return [receiver().at(key(index)) ?? fallback(), "A😀Z".at(key(index)) ?? fallback()]; }
console.log(JSON.stringify([[-5, -4, -3, -2, -1, -0.5, -0, 0, 0.5, 1, 2, 3, 4, NaN, Infinity, -Infinity].map(run), events]));`;
  assert.equal(check(source), check(source, false));
});

test("typed-array defaults requiring optional primitive storage retain their source form", () => {
  const source = 'function run(values: Uint8Array, index: number): number | null { return values[index] ?? null; }';
  const root = mkdtempSync(join(tmpdir(), "leek-nullable-number-"));
  try {
    const file = join(root, "entry.ts");
    writeFileSync(file, source);
    const program = ts.createProgram([file], { strict: true, noUncheckedIndexedAccess: true, types: [], target: ts.ScriptTarget.ES2022 });
    const input = program.getSourceFile(file) ?? null;
    assert.ok(input);
    assert.equal(lowerNullable(input, program.getTypeChecker()).text, source);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("primitive map defaults retain diagnostics until missing values have distinct storage", () => {
  const source = 'function run(values: Map<string, number>, key: string): number | null { return values.get(key) ?? null; }';
  const root = mkdtempSync(join(tmpdir(), "leek-nullable-map-"));
  try {
    const file = join(root, "entry.ts");
    writeFileSync(file, source);
    const program = ts.createProgram([file], { strict: true, types: [], target: ts.ScriptTarget.ES2022 });
    const input = program.getSourceFile(file) ?? null;
    assert.ok(input);
    assert.equal(lowerNullable(input, program.getTypeChecker()).text, source);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bigint typed-array defaults keep signed and unsigned values without numeric conversion", () => {
  const source = `const events: string[] = [];
const signed = new BigInt64Array([0n, -1n, 9223372036854775807n, -9223372036854775808n]);
const unsigned = new BigUint64Array([0n, 18446744073709551615n]);
function fallback(): bigint { events.push("fallback"); return 42n; }
function run(index: number): string[] { return [String(signed[index] ?? fallback()), String(unsigned[index] ?? fallback()), String(signed.at(index) ?? fallback())]; }
console.log(JSON.stringify([[-5,-1,-0,0,0.5,1,2,3,4,NaN,Infinity,-Infinity].map(run), events]));`;
  assert.equal(check(source), check(source, false));
});


test("code-point defaults preserve UTF-16 indexing, integer conversion and lazy fallbacks", () => {
  const source = `const events: string[] = [];
function receiver(): string { events.push("receiver"); return "A😀\\ud800Z"; }
function key(index: number): number { events.push("key"); return index; }
function fallback(): number { events.push("fallback"); return 42; }
function run(index: number): number { return receiver().codePointAt(key(index)) ?? fallback(); }
console.log(JSON.stringify([[-1,-0.5,-0,0,0.5,1,1.9,2,3,4,5,NaN,Infinity,-Infinity,4294967296].map(run), events]));`;
  assert.equal(check(source), check(source, false));
});


test("standard array-derived match results preserve missing captures and indexed defaults", () => {
  const source = `const events: string[] = [];
function fallback(): string { events.push("fallback"); return "missing"; }
function run(input: string, index: number): string {
  const match = /^(a)?(b*)$/.exec(input);
  if (match === null) return "no match";
  return match[index] ?? fallback();
}
console.log(JSON.stringify(["", "a", "bbb", "abbb", "x"].flatMap(input => [-1,-0,0,0.5,1,2,3,NaN,Infinity].map(index => run(input,index))), events));`;
  assert.equal(check(source), check(source, false));
});


test("nullable predicate applications preserve lazy effects and truth-only results", () => {
  const source = `const events: string[] = [];
function apply<T,R>(value: T | null, use: (value:T)=>R): R | null { if (value === null) return null; return use(value); }
function input(value: string | null): string | null { events.push("input"); return value; }
function predicate(value: string): boolean { events.push("predicate:" + value); return value.startsWith("-"); }
function run(value: string | null): number {
  (apply(input(value), item => predicate(item)) ?? null) && events.push("selected");
  if (false || (true && (apply(input(value), item => predicate(item)) ?? null))) return 1;
  return !!(apply(input(value), item => predicate(item)) ?? null) ? 2 : 3;
}
console.log(JSON.stringify([[null,"", "-S", "plain"].map(run), events]));`;
  assert.equal(check(source), check(source, false));
});


test("nullable applications retain value contexts, effectful helpers and generator semantics", () => {
  const helper = 'function apply<T,R>(value:T|null,use:(value:T)=>R):R|null { if(value===null)return null; return use(value); }';
  const sources = [
    helper + ' function run(value:{flag:boolean}|null):boolean|null { return apply(value,item=>item.flag) ?? null; }',
    helper + ' function run(value:{flag:boolean}|null):boolean|null { return (apply(value,item=>item.flag) ?? null) && true; }',
    helper + ' function run(value:{flag:boolean}|null):boolean { if(apply(value,item=>item.flag) ?? true)return true; return false; }',
    'function apply<T,R>(value:T|null,use:(value:T)=>R):R|null { console.log("helper"); if(value===null)return null; return use(value); } function run(value:{flag:boolean}|null):boolean { return !!(apply(value,item=>item.flag) ?? null); }',
    'function* apply<T,R>(value:T|null,use:(value:T)=>R):Generator<never,R|null,unknown> { if(value===null)return null; return use(value); } function run(value:{flag:boolean}|null):boolean { return !!(apply(value,item=>item.flag) ?? null); }',
    helper + ' function run(value:{flag:boolean}|null):boolean { return !!(apply(value,item=>(item={flag:false},item.flag)) ?? null); }',
    helper + ' let current = apply; current = <T,R>(_value:T|null,_use:(value:T)=>R):R|null => null; function run(value:{flag:boolean}|null):boolean { return !!(current(value,item=>item.flag) ?? null); }'
  ];
  for (const source of sources) withTransformedSource(source, (input, checker) => lowerNullable(input, checker).text, (_file, output) => assert.equal(output, source));
});


test("guarded result fallbacks preserve calls, errors, argument order and present falsy values", () => {
  const source = `const events:string[]=[];
function checked<T>(value:T|null,label:string):T { events.push("helper:"+label); if(value===null)throw new Error("missing"); return value; }
function label():string { events.push("label"); return "value"; }
function fallback():number { events.push("fallback"); return 99; }
function run(value:number|null|undefined):string {
  try { const result=checked(value??null,label())??fallback(); return Object.is(result,-0)?"-0":String(result); }
  catch(error) { return error instanceof Error?error.message:"other"; }
}
console.log(JSON.stringify([[null,undefined,0,-0,7,NaN,Infinity].map(run),events]));`;
  const output=compareTransformedExecution(source,(input,checker)=>lowerNullable(input,checker).text).text;
  assert.doesNotMatch(output,/\?\? fallback\(\)/);
});

test("return annotations, unchecked assertions and rebound helpers do not prove a present result", { timeout: 30000 }, () => {
  const helper='function checked<T>(value:T|null):T { if(value===null)throw new Error("missing"); return value; }';
  const sources=[
    helper+' function run(value:string):string { return checked(value)??"fallback"; }',
    'function identity<T>(value:T):T { return value; } function run(value:string):string { return identity(value??null)??"fallback"; }',
    'function checked<T>(value:T|null):T { if(value===null)throw new Error("missing"); eval("value=null"); return value; } function run(value:string|null):string { return checked(value??null)??"fallback"; }',
    'function unchecked<T>(value:T|null):T { return value!; } function run(value:string|null):string { return unchecked(value??null)??"fallback"; }',
    'function unchecked<T>(value:T|null):T { if(value===null)return null as T; return value; } function run(value:string|null):string { return unchecked(value??null)??"fallback"; }',
    helper+' let use=checked; use=<T>(value:T|null):T=>null as T; function run(value:string|null):string { return use(value??null)??"fallback"; }'
  ];
  for(const source of sources) withTransformedSource(source,(input,checker)=>lowerNullable(input,checker).text,(_file,output)=>assert.equal(output,source));
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import binaryen from "binaryen";
import { stageSource } from "../src/lower/index.ts";
import { emitWasm } from "../src/wasm.ts";
import { requirePin } from "../src/project.ts";
import { linkWat } from "../src/wat.ts";
import * as reference from "./fixtures/wasm.ts";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function call(exports: WebAssembly.Exports, name: string, ...args: number[]): number {
  const fn = exports[name] ?? null;
  assert.equal(typeof fn, "function", name);
  if (typeof fn !== "function") throw new Error("Missing native export " + name);
  // The compiled fixture's checked ABI consists of numeric parameters and results.
  const numeric = fn as (...values: number[]) => number;
  const result = numeric(...args);
  assert.equal(typeof result, "number", name);
  if (typeof result !== "number") throw new Error("Invalid native result " + name);
  return result;
}

function numericCases(): number[] {
  const values = [NaN, Infinity, -Infinity, -0, 0, Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE,
    -4294967297, -2147483648, -1.9, 1.9, 2147483647, 2147483648, 4294967295, 4294967296,
    9007199254740991, -9007199254740991, 32, 33, -33];
  let seed = 0x811c9dc5;
  for (let index = 0; index < 32; index++) {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    values.push(seed * 2 ** (index % 24) + 0.75);
  }
  return values;
}

function checkNumbers(exports: WebAssembly.Exports): void {
  const operations = { multiply: reference.multiply, xor: reference.xor, and: reference.and, or: reference.or,
    shl: reference.shl, shr: reference.shr, ushr: reference.ushr };
  const values = numericCases();
  for (const [name, operation] of Object.entries(operations)) {
    for (const a of values) for (const b of values) assert.equal(call(exports, name, a, b), operation(a, b), `${name}(${a}, ${b})`);
  }
  for (const value of values) assert.equal(call(exports, "predicates", value), reference.predicates(value));
  for (const value of values) assert.equal(call(exports, "canonicalBindings", value), reference.canonicalBindings(value));
  for (const value of values) for (const present of [0, 1]) assert.equal(call(exports, "mapDefault", present, value), reference.mapDefault(present, value));
  for (const value of values) for (const present of [0, 1]) assert.equal(call(exports, "mapReferenceDefault", present, value), reference.mapReferenceDefault(present, value));
  for (const value of [0, 1]) assert.equal(call(exports, "nullableEffect", value), reference.nullableEffect(value));
  for (const value of [0, 1]) assert.equal(call(exports, "removedReference", value), reference.removedReference(value));
  const indexed = { indexedByte: reference.indexedByte, indexedString: reference.indexedString, indexedReference: reference.indexedReference, indexedObject: reference.indexedObject, indexedReadonly: reference.indexedReadonly };
  for (const [name, operation] of Object.entries(indexed)) for (const value of [...values, 0, 0.5, 1, 2, 3, 4]) assert.equal(call(exports, name, value), operation(value), `${name}(${value})`);
  for (const [name, expected] of [["signedRead", -1], ["widerWrite", 1], ["assignmentResult", 0]] as const) assert.equal(call(exports, name), expected);
}

async function checkClosures(exports: WebAssembly.Exports): Promise<void> {
  for (const input of [-1, 0, 4, 7]) {
    assert.equal(call(exports, "beginClosure", input), reference.beginClosure(input));
    for (let step = 0; !reference.closureReady() && step < 100; step++) await Promise.resolve();
    assert.equal(reference.closureReady(), 1);
    assert.equal(call(exports, "closureReady"), 1);
    assert.equal(call(exports, "closureValue"), reference.closureValue());
  }
}

/** Byte setters and bulk views must address the same rooted array. Releasing
 * one handle must invalidate its bridge access while the other handles remain live.
 */
function checkBytes(exports: WebAssembly.Exports, memory: WebAssembly.Memory): void {
  const inputs = [[], [0], [255], [0, 1, 255, 42], Array.from(new Uint8Array(256), (value, index) => index)];
  const handles = inputs.map(bytes => call(exports, "leekBytesNew", bytes.length));
  for (const [index, bytes] of inputs.entries()) {
    const handle = handles[index] ?? 0;
    assert.ok(handle);
    for (const [offset, value] of bytes.entries()) assert.equal(call(exports, "leekBytesSet", handle, offset, value), 1);
    assert.equal(call(exports, "leekBytesSet", handle, -1, 0), 0);
    assert.equal(call(exports, "leekBytesSet", handle, bytes.length, 0), 0);
    assert.equal(call(exports, "leekBytesSet", handle, 0, 256), 0);
    assert.equal(call(exports, "checksum", handle), reference.checksum(new Uint8Array(bytes)));
    const pointer = call(exports, "leekBytesData", handle);
    assert.ok(pointer > 0);
    assert.notEqual(pointer, handle, "managed references and buffer addresses are distinct");
    assert.equal(call(exports, "leekBytesLength", handle), bytes.length);
    const bulk = Uint8Array.from(bytes, value => 255 - value);
    new Uint8Array(memory.buffer, pointer, bulk.length).set(bulk);
    assert.equal(call(exports, "checksum", handle), reference.checksum(bulk));
  }
  for (const handle of handles.reverse()) {
    assert.equal(call(exports, "leekBytesRelease", handle), 1);
    assert.equal(call(exports, "leekBytesRelease", handle), 0);
    assert.equal(call(exports, "leekBytesSet", handle, 0, 1), 0);
    assert.equal(call(exports, "leekBytesData", handle), 0);
    assert.equal(call(exports, "leekBytesLength", handle), -1);
  }
}

function watBlock(text: string, start: number): string {
  assert.ok(start >= 0, "required native instruction block exists");
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    if (text.charAt(index) === "(") depth++;
    if (text.charAt(index) === ")" && --depth === 0) return text.slice(start, index + 1);
  }
  throw new Error("Unbalanced native instruction block");
}

function checkInstructions(bytes: Uint8Array): void {
  const module = binaryen.readBinary(bytes);
  try {
    const wat = module.emitText();
    const match = /\(export "checksum" \(func (\$[^\s)]+)\)\)/.exec(wat) ?? [];
    const name = match[1] ?? "";
    assert.ok(name, "checksum has a native export");
    const body = watBlock(wat, wat.indexOf("(func " + name + " "));
    const loop = watBlock(body, body.indexOf("(loop "));
    assert.match(loop, /i32\.load8_u/);
    assert.match(loop, /i32\.xor/);
    assert.match(loop, /i32\.mul/);
    assert.doesNotMatch(loop, /f64\./);
    assert.equal((body.match(/f64\.convert_i32_u/g) ?? []).length, 1, "only the unsigned result crosses the Number boundary");
  } finally { module.dispose(); }
}

test("compiled WASM preserves numeric semantics, native closures, rooted buffers and checksum instructions", { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "leek-native-"));
  try {
    mkdirSync(join(root, "src"));
    const entry = join(root, "src", "entry.ts");
    writeFileSync(entry, readFileSync(join(repository, "test/fixtures/wasm.ts"), "utf8"));
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], noEmit: true } }));
    const input = stageSource(root, entry, join(root, "work"), false);
    emitWasm(requirePin(repository, "baguette"), input, join(root, "output"));
    const bytes = readFileSync(join(root, "output", "leek.wasm"));
    const linked = join(root, "linked.wat");
    writeFileSync(linked, linkWat(join(root, "output/wat/leek/layout.json")));
    const rebuilt = join(root, "rebuilt.wasm");
    execFileSync(process.execPath, [join(repository, "baguette/node_modules/.bin/wasm-opt"), linked,
      "-O3", "--all-features", "--strip-debug", "-o", rebuilt]);
    assert.deepEqual(readFileSync(rebuilt), bytes, "independent modular WAT compilation reproduces Baguette's reference binary");
    const memory = new WebAssembly.Memory({ initial: 1024, maximum: 32768 });
    const module = new WebAssembly.Module(bytes);
    assert.deepEqual(WebAssembly.Module.imports(module).map(item => item.module + "." + item.name).sort(), ["env.abort", "env.memory"]);
    const instance = new WebAssembly.Instance(module, { env: { memory, abort: () => { throw new Error("Native abort"); } } });
    checkNumbers(instance.exports);
    await checkClosures(instance.exports);
    checkBytes(instance.exports, memory);
    checkInstructions(bytes);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

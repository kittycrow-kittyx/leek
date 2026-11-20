import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareWasmAbi } from "../src/wasm-abi.ts";

test("explicit byte-array arguments activate the managed byte ABI", () => {
  const root = mkdtempSync(join(tmpdir(), "leek-abi-"));
  try {
    mkdirSync(join(root, "source"));
    const entry = join(root, "source", "entry.ts");
    writeFileSync(entry, "export function check(bytes: Uint8Array): number { return bytes.length; }");
    const result = prepareWasmAbi({ project: join(root, "tsconfig.json"), entry });
    assert.equal(result.entries.length, 2);
    assert.deepEqual(result.abiTypes, { Uint8Array: "number", LeekByteIndex: "number", LeekByteValue: "number", LeekBytePointer: "number" });
    assert.deepEqual(result.typeAliases, { LeekByteIndex: "i32", LeekByteValue: "u8", LeekBytePointer: "u32" });
    const bridge = readFileSync(join(root, "source", "__leek_byte_abi.ts"), "utf8");
    assert.match(bridge, /roots.add\(bytes\)/);
    assert.match(bridge, /roots.delete\(bytes\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("scalar entry does not activate the byte ABI", () => {
  const root = mkdtempSync(join(tmpdir(), "leek-abi-"));
  try {
    const entry = join(root, "entry.ts");
    writeFileSync(entry, "export function add(a: number, b: number): number { return a + b; }");
    const result = prepareWasmAbi({ project: join(root, "tsconfig.json"), entry });
    assert.deepEqual(result, { entries: [entry], typeAliases: {}, abiTypes: {} });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import type { LoweredProject } from "./lower/index.ts";

interface WasmAbi {
  entries: string[];
  typeAliases: Record<string, string>;
  abiTypes: Record<string, "number">;
}

// The references returned by this bridge are managed objects, not data addresses.
const byteBridge = `type LeekByteIndex = number;
type LeekByteValue = number;
const roots: Uint8Array[] = [];

export function leekBytesNew(length: LeekByteIndex): Uint8Array {
  const bytes: Uint8Array = new Uint8Array(length);
  roots.push(bytes);
  return bytes;
}

export function leekBytesSet(bytes: Uint8Array, index: LeekByteIndex, value: LeekByteIndex): boolean {
  if (roots.indexOf(bytes) < 0 || index < 0 || index >= bytes.length || value < 0 || value > 255) return false;
  bytes[index] = value as LeekByteValue;
  return true;
}

export function leekBytesRelease(bytes: Uint8Array): boolean {
  const slot: LeekByteIndex = roots.indexOf(bytes);
  if (slot < 0) return false;
  roots.splice(slot, 1);
  return true;
}
`;

function byteParameter(node: ts.ParameterDeclaration): boolean {
  const type = node.type ?? null;
  return !!type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === "Uint8Array";
}

function needsByteBridge(entry: string): boolean {
  const source = ts.createSourceFile(entry, readFileSync(entry, "utf8"), ts.ScriptTarget.Latest, true);
  return source.statements.some(statement => ts.isFunctionDeclaration(statement) &&
    (statement.modifiers ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
    statement.parameters.some(byteParameter));
}

/** Supply target-specific ABI extensions without changing mikuOS or its upstream compiler. */
export function prepareWasmAbi(input: LoweredProject): WasmAbi {
  if (!needsByteBridge(input.entry)) return { entries: [input.entry], typeAliases: {}, abiTypes: {} };
  const bridge = resolve(dirname(input.project), "source", "__leek_byte_abi.ts");
  writeFileSync(bridge, byteBridge, { flag: "wx" });
  return {
    entries: [input.entry, bridge],
    typeAliases: { LeekByteIndex: "i32", LeekByteValue: "u8" },
    abiTypes: { Uint8Array: "number", LeekByteIndex: "number", LeekByteValue: "number" }
  };
}

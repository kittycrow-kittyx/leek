import ts from "typescript";
import { arrayType, librarySymbol, typedArrays } from "./integers.ts";
import { parameterWritten } from "./captures.ts";

/** Only unmodified standard constructors and concrete ArrayBuffers can reuse the native view operation. */
export function bufferView(node: ts.Node, checker: ts.TypeChecker): { name: string; empty: boolean } | null {
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression)) return null;
  const name = arrayType(checker.getTypeAtLocation(node));
  const symbol = checker.getSymbolAtLocation(node.expression) ?? null;
  if (!name || node.expression.text !== name || !librarySymbol(symbol) || !symbol || parameterWritten(node.getSourceFile(), symbol, checker)) return null;
  const args = node.arguments ?? [];
  if (!args.length) return { name, empty: true };
  const first = args[0] ?? null;
  const buffer = first ? checker.getTypeAtLocation(first).getSymbol() ?? null : null;
  if (!buffer || buffer.getName() !== "ArrayBuffer" || !librarySymbol(buffer) || args.length > 3 || args.some(ts.isSpreadElement)) return null;
  return args.slice(1).every(argument => Boolean(checker.getTypeAtLocation(argument).flags & ts.TypeFlags.NumberLike)) ? { name, empty: false } : null;
}

export const viewName = (name: string): string => "LeekBufferView" + name;

/** Bake checks the source constructor contract; Baguette omits it in favour of the pinned native wrap operation. */
export function viewReference(name: string): string {
  return "export function " + viewName(name) + "(buffer: ArrayBuffer, offset: number, length: number, explicit: boolean): " + name +
    " { return explicit ? new " + name + "(buffer, offset, length) : new " + name + "(buffer, offset); }\n";
}

/** Validate Number indices before narrowing and let the standard library construct and root the actual typed view. */
export function viewPrelude(): string {
  const index = `@inline function LeekViewIndex(value: f64): i32 {
  const index = value != value ? 0.0 : Math.trunc(value);
  if (index < 0.0 || index > 2147483647.0) throw new RangeError("typed view index out of range");
  return <i32>index;
}\n`;
  return index + typedArrays.map(name => `@inline function ${viewName(name)}(buffer: ArrayBuffer, offset: f64, length: f64, explicit: bool): ${name} {
  const at = LeekViewIndex(offset);
  const count = explicit ? LeekViewIndex(length) : -1;
  if (explicit && <f64>count > (<f64>buffer.byteLength - <f64>at) / <f64>${name}.BYTES_PER_ELEMENT) throw new RangeError("typed view length out of range");
  return ${name}.wrap(buffer, at, count);
}\n`).join("");
}

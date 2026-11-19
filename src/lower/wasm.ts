import { writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { nativeVariable } from "../../baguette/src/ast.ts";
import type { LoweredProject } from "./index.ts";

const signed = "LeekNativeI32";
const unsigned = "LeekNativeU32";
const intrinsicFile = "__leek_wasm_intrinsics.ts";

// TypeScript reference for Baguette’s native mulU32 intrinsic. Bake checks this
// module; Baguette omits its body and resolves the call to its pinned prelude.
export const multiplyReference = "export function mulU32(left: number, right: number): number { return Math.imul(left, right) >>> 0; }\n";
const typedArrays = new Set(["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array"]);
const operators = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.CaretToken, "xor"],
  [ts.SyntaxKind.AmpersandToken, "and"],
  [ts.SyntaxKind.BarToken, "or"],
  [ts.SyntaxKind.LessThanLessThanToken, "shl"],
  [ts.SyntaxKind.GreaterThanGreaterThanToken, "shr"],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken, "ushr"]
]);

function librarySymbol(symbol: ts.Symbol | null): boolean {
  if (symbol === null) return false;
  const declarations = symbol.declarations ?? [];
  // Ambient library augmentations add declarations to the same built-in symbol.
  return declarations.some(decl => /(?:^|[\\/])lib\.[^\\/]+\.d\.ts$/.test(decl.getSourceFile().fileName));
}

function arrayName(node: ts.Expression, checker: ts.TypeChecker): string | null {
  const symbol = checker.getTypeAtLocation(node).getSymbol() ?? null;
  if (symbol === null) return null;
  const name = symbol.getName();
  return typedArrays.has(name) && librarySymbol(symbol) ? name : null;
}

function numberLike(node: ts.Expression, checker: ts.TypeChecker): boolean {
  return Boolean(checker.getTypeAtLocation(node).flags & ts.TypeFlags.NumberLike);
}

function operation(node: ts.Node, checker: ts.TypeChecker): string | null {
  if (ts.isBinaryExpression(node) && numberLike(node.left, checker) && numberLike(node.right, checker)) {
    return operators.get(node.operatorToken.kind) ?? null;
  }
  if (!ts.isCallExpression(node) || node.arguments.length !== 2 || !ts.isPropertyAccessExpression(node.expression)) return null;
  const member = node.expression;
  if (!ts.isIdentifier(member.expression) || member.expression.text !== "Math" || member.name.text !== "imul") return null;
  if (!librarySymbol(checker.getSymbolAtLocation(member.expression) ?? null)) return null;
  return node.arguments.every(arg => numberLike(arg, checker) && !ts.isSpreadElement(arg)) ? "imul" : null;
}

function integerHelpers(names: Map<string, string>, toUnsigned: string): string {
  const body: string[] = [];
  if (!names.size) return "";
  body.push(`function ${toUnsigned}(value: number): number {
    if (value !== value || value > 1.7976931348623157e308 || value < -1.7976931348623157e308) return 0;
    const remainder: number = Math.trunc(value) % 4294967296;
    return remainder < 0 ? remainder + 4294967296 : remainder;
  }`);
  const tokens = new Map([["xor", "^"], ["and", "&"], ["or", "|"], ["shl", "<<"], ["shr", ">>"], ["ushr", ">>>"]]);
  for (const [key, name] of names) {
    const width = key === "ushr" ? unsigned : signed;
    const setup = `const x: ${width} = (${toUnsigned}(a) as ${unsigned}) as ${width};
    const y: ${width} = (${toUnsigned}(b) as ${unsigned}) as ${width};`;
    const token = tokens.get(key) ?? null;
    const expression = token === null
      ? `return ((mulU32(x as ${unsigned}, y as ${unsigned}) as ${signed}) | 0) as number;`
      : `return (x ${token} y) as number;`;
    body.push(`function ${name}(a: number, b: number): number { ${setup}\n${expression} }`);
  }
  return body.join("\n");
}

type Visit = ts.Visitor<ts.Node, ts.Node>;
type Allocate = (stem: string) => string;

function indexedLoop(node: ts.ForOfStatement, name: string, factory: ts.NodeFactory, allocate: Allocate, visit: Visit): ts.ForStatement {
  const initializer = node.initializer;
  if (!ts.isVariableDeclarationList(initializer) || initializer.declarations.length !== 1) throw new Error("Leek WASM: typed-array iteration requires one declared binding");
  const binding = initializer.declarations[0] ?? null;
  if (!binding || !ts.isIdentifier(binding.name)) throw new Error("Leek WASM: typed-array iteration requires an identifier");
  const array = factory.createIdentifier(allocate("__leek_array"));
  const index = factory.createIdentifier(allocate("__leek_index"));
  const number = factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
  const body = ts.visitNode(node.statement, visit, ts.isStatement) ?? node.statement;
  const expression = ts.visitNode(node.expression, visit, ts.isExpression) ?? node.expression;
  const item = factory.createVariableStatement([], factory.createVariableDeclarationList([
    nativeVariable(binding.name, number, factory.createAsExpression(factory.createElementAccessExpression(array, index), number))
  ], initializer.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)));
  return factory.createForStatement(
    factory.createVariableDeclarationList([
      nativeVariable(array, factory.createTypeReferenceNode(name), expression),
      nativeVariable(index, factory.createTypeReferenceNode(signed), factory.createNumericLiteral(0))
    ], ts.NodeFlags.Let),
    factory.createBinaryExpression(index, ts.SyntaxKind.LessThanToken, factory.createPropertyAccessExpression(array, "length")),
    factory.createPostfixUnaryExpression(index, ts.SyntaxKind.PlusPlusToken),
    factory.createBlock([item, body], true)
  );
}

/** Lower operations whose JavaScript numeric or iteration semantics differ from AssemblyScript. */
export interface WasmLowering {
  text: string;
  usesMultiply: boolean;
}

export function lowerWasm(source: ts.SourceFile, checker: ts.TypeChecker, intrinsicSpecifier = "./__leek_wasm_intrinsics.js"): WasmLowering {
  const identifiers = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(source);
  const allocate: Allocate = stem => {
    let name = stem;
    while (identifiers.has(name)) name += "_";
    identifiers.add(name);
    return name;
  };
  const toUnsigned = allocate("__leek_uint32");
  const names = new Map<string, string>();
  const helper = (key: string): string => {
    const existing = names.get(key) ?? null;
    if (existing) return existing;
    const name = allocate("__leek_" + key);
    names.set(key, name);
    return name;
  };
  let changed = false;
  let widths = false;
  const result = ts.transform(source, [context => root => {
    const factory = context.factory;
    const visit: Visit = node => {
      const key = operation(node, checker);
      if (key && (ts.isBinaryExpression(node) || ts.isCallExpression(node))) {
        const args = ts.isBinaryExpression(node) ? [node.left, node.right] : node.arguments;
        changed = widths = true;
        return factory.createCallExpression(factory.createIdentifier(helper(key)), [], args.map(arg => ts.visitNode(arg, visit, ts.isExpression) ?? arg));
      }
      const array = ts.isForOfStatement(node) && !Boolean(node.awaitModifier ?? null) ? arrayName(node.expression, checker) : null;
      if (array && ts.isForOfStatement(node)) {
        changed = widths = true;
        return indexedLoop(node, array, factory, allocate, visit);
      }
      const initializer = ts.isVariableDeclaration(node) ? node.initializer ?? null : null;
      const concrete = initializer && ts.isNewExpression(initializer) ? arrayName(initializer, checker) : null;
      if (concrete && ts.isVariableDeclaration(node) && !Boolean(node.type ?? null)) {
        changed = true;
        return nativeVariable(node.name, factory.createTypeReferenceNode(concrete), initializer, Boolean(node.exclamationToken ?? null));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit, ts.isSourceFile) ?? root;
  }]);
  try {
    if (!changed) return { text: source.text, usesMultiply: false };
    if (widths && (identifiers.has(signed) || identifiers.has(unsigned))) throw new Error("Leek WASM: reserved native width alias in " + source.fileName);
    const aliases = widths ? `type ${signed} = number;\ntype ${unsigned} = number;\n` : "";
    const body = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0] ?? source);
    const usesMultiply = names.has("imul");
    if (usesMultiply && identifiers.has("mulU32")) throw new Error("Leek WASM: reserved intrinsic mulU32 in " + source.fileName);
    const imports = usesMultiply ? "import { mulU32 } from " + JSON.stringify(intrinsicSpecifier) + ";\n" : "";
    return { text: imports + aliases + body + "\n" + integerHelpers(names, toUnsigned) + "\n", usesMultiply };
  } finally { result.dispose(); }
}

/** Apply the WASM extension to the staged module graph before invoking Bake. */
export function prepareWasmSource(input: LoweredProject): string[] {
  const config = ts.readJsonConfigFile(input.project, ts.sys.readFile);
  const parsed = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, dirname(input.project), {}, input.project);
  if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const root = resolve(dirname(input.project), "source");
  const intrinsic = resolve(root, intrinsicFile);
  let usesMultiply = false;
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || program.isSourceFileFromExternalLibrary(file)) continue;
    const path = relative(root, file.fileName);
    if (isAbsolute(path) || path === ".." || path.startsWith(".." + sep)) throw new Error("WASM source outside staging tree: " + file.fileName);
    const modulePath = relative(dirname(file.fileName), intrinsic).split(sep).join("/").replace(/\.ts$/, ".js");
    const specifier = modulePath.startsWith(".") ? modulePath : "./" + modulePath;
    const output = lowerWasm(file, checker, specifier);
    usesMultiply = usesMultiply || output.usesMultiply;
    if (output.text !== file.text) writeFileSync(file.fileName, output.text);
  }
  if (!usesMultiply) return [];
  writeFileSync(intrinsic, multiplyReference, { flag: "wx" });
  return [intrinsic];
}

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { nativeVariable } from "../../baguette/src/ast.ts";
import type { LoweredProject } from "./index.ts";
import { numericCall } from "./numeric.ts";
import { arrayType, integerOperation, integerStorage, integerValue, nativeWidths, signed, unsigned, unwrap } from "./integers.ts";
import { lowerArrayLoop } from "./loops.ts";
import { lowerNullable, referenceRead } from "./nullish.ts";
import { lowerClosures } from "./closures.ts";
import { lowerRequired } from "./required.ts";

const intrinsicFile = "__leek_wasm_intrinsics.ts";

// Bake checks these reference contracts; Baguette omits their bodies and uses
// its pinned native prelude and AssemblyScript standard library instead.
export const multiplyReference = "export function LeekMulU32(left: number, right: number): number { return Math.imul(left, right) >>> 0; }\n";
export const uncheckedReference = "export function unchecked<T>(value: T): T { return value; }\n";
export const integerReference = `export class LeekNativeMath {
  static imul(left: number, right: number): number { return Math.imul(left, right); }
}
`;
export const floatReference = `export class LeekF64 {
  static isNaN(value: number): boolean { return Number.isNaN(value); }
  static isFinite(value: number): boolean { return Number.isFinite(value); }
  static isInteger(value: number): boolean { return Number.isInteger(value); }
  static isSafeInteger(value: number): boolean { return Number.isSafeInteger(value); }
}
`;

export interface WasmLowering {
  text: string;
  usesMultiply: boolean;
  usesPredicates: boolean;
  usesCoercion: boolean;
  usesUnchecked: boolean;
}

function labelledLoop(node: ts.Node): { loop: ts.ForOfStatement; labels: ts.Identifier[] } | null {
  const labels: ts.Identifier[] = [];
  while (ts.isLabeledStatement(node)) { labels.push(node.label); node = node.statement; }
  return ts.isForOfStatement(node) && !(node.awaitModifier ?? null) ? { loop: node, labels } : null;
}

/** Bind native operations and add only the integer facts missing from the inherited compiler. */
export function lowerWasm(source: ts.SourceFile, checker: ts.TypeChecker, intrinsicSpecifier = "./__leek_wasm_intrinsics.js"): WasmLowering {
  const storage = integerStorage(source, checker);
  const used = { widths: false, multiply: false, predicates: false, coercion: false, unchecked: false, changed: false };
  const stored = (node: ts.Node): boolean => {
    const symbol = ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) ?? null : null;
    return symbol !== null && storage.has(symbol);
  };
  const result = ts.transform(source, [context => root => {
    const factory = context.factory;
    const cast = (node: ts.Expression, type: string): ts.Expression => factory.createParenthesizedExpression(factory.createAsExpression(
      factory.createParenthesizedExpression(node), type === "number" ? factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword) : factory.createTypeReferenceNode(type)));
    const number = (node: ts.Expression): ts.Expression => cast(ts.visitNode(node, visit, ts.isExpression) ?? node, "number");
    const native = (expression: ts.Expression, width: string): ts.Expression => {
      used.widths = true;
      const node = unwrap(expression);
      if (integerOperation(node, checker)) return cast(operation(node), width);
      if (stored(node)) return cast(node, width);
      if (integerValue(node, checker, storage)) {
        const type = checker.getTypeAtLocation(node);
        const representation = type.isNumberLiteral() && type.value < 0 ? signed : unsigned;
        return cast(cast(ts.visitNode(node, visit, ts.isExpression) ?? node, representation), width);
      }
      // Math.imul(value, 1) is the inherited, non-trapping ToInt32 operation.
      used.coercion = true;
      return cast(cast(factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("LeekNativeMath"), "imul"), [],
        [number(node), factory.createNumericLiteral(1)]), signed), width);
    };
    const operation = (node: ts.Node): ts.Expression => {
      if (ts.isBinaryExpression(node)) {
        const width = node.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken ? unsigned : signed;
        return factory.createBinaryExpression(native(node.left, width), node.operatorToken, native(node.right, width));
      }
      if (!ts.isCallExpression(node)) throw new Error("Leek WASM: invalid integer expression");
      if (!node.arguments.every(argument => integerValue(argument, checker, storage))) {
        return cast(factory.updateCallExpression(node, node.expression, node.typeArguments ?? [], node.arguments.map(number)), signed);
      }
      used.multiply = true;
      const product = cast(factory.createCallExpression(factory.createIdentifier("LeekMulU32"), [], node.arguments.map(argument => native(argument, unsigned))), signed);
      return factory.createBinaryExpression(product, ts.SyntaxKind.BarToken, factory.createNumericLiteral(0));
    };
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      const predicate = numericCall(node, checker);
      if (predicate && ts.isCallExpression(node)) {
        used.changed = used.predicates = true;
        return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("LeekF64"), predicate), [], node.arguments.map(number));
      }
      const initializer = ts.isVariableDeclaration(node) ? node.initializer ?? null : null;
      if (ts.isVariableDeclaration(node) && stored(node.name) && initializer) {
        used.changed = used.widths = true;
        return nativeVariable(node.name, factory.createTypeReferenceNode(unsigned), native(initializer, unsigned));
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && stored(unwrap(node.left))) {
        used.changed = true;
        return factory.updateBinaryExpression(node, node.left, node.operatorToken, native(node.right, unsigned));
      }
      if (integerOperation(node, checker) && (ts.isBinaryExpression(node) ||
          ts.isCallExpression(node) && node.arguments.every(argument => integerValue(argument, checker, storage)))) {
        used.changed = used.widths = true;
        return cast(operation(node), "number");
      }
      const iteration = labelledLoop(node);
      const array = iteration ? arrayType(checker.getTypeAtLocation(iteration.loop.expression)) : null;
      if (iteration && array) {
        used.changed = used.widths = used.unchecked = true;
        const initializer = iteration.loop.initializer;
        const binding = ts.isVariableDeclarationList(initializer) ? initializer.declarations[0] ?? null : null;
        return lowerArrayLoop({ source, loop: iteration.loop, name: array, checker, visit,
          nativeItem: binding !== null && stored(binding.name), labels: iteration.labels });
      }
      const concrete = initializer && ts.isNewExpression(initializer) ? arrayType(checker.getTypeAtLocation(initializer)) : null;
      if (concrete && ts.isVariableDeclaration(node) && !(node.type ?? null) && initializer) {
        used.changed = true;
        return nativeVariable(node.name, factory.createTypeReferenceNode(concrete), ts.visitNode(initializer, visit, ts.isExpression) ?? initializer, Boolean(node.exclamationToken ?? null));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit, ts.isSourceFile) ?? root;
  }]);
  try {
    const flags = { usesMultiply: used.multiply, usesPredicates: used.predicates, usesCoercion: used.coercion, usesUnchecked: used.unchecked };
    if (!used.changed) return { text: source.text, ...flags };
    const bindings = [...(used.multiply ? ["LeekMulU32"] : []), ...(used.predicates ? ["LeekF64"] : []), ...(used.coercion ? ["LeekNativeMath"] : []), ...(used.unchecked ? ["unchecked"] : [])];
    const reserved = new Set([...bindings, ...(used.widths ? Object.keys(nativeWidths) : [])]);
    const check = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && reserved.has(node.text)) throw new Error("Leek WASM: reserved native binding " + node.text + " in " + source.fileName);
      ts.forEachChild(node, check);
    };
    check(source);
    const aliases = used.widths ? Object.keys(nativeWidths).map(name => "type " + name + " = number;\n").join("") : "";
    const imports = bindings.length ? "import { " + bindings.join(", ") + " } from " + JSON.stringify(intrinsicSpecifier) + ";\n" : "";
    const body = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0] ?? source);
    return { text: imports + aliases + body, ...flags };
  } finally { result.dispose(); }
}

/** Apply the WASM extension to the staged graph before Baguette's mandatory Bake stage. */
export function prepareWasmSource(input: LoweredProject): string[] {
  const config = ts.readJsonConfigFile(input.project, ts.sys.readFile);
  const parsed = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, dirname(input.project), {}, input.project);
  if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  const root = resolve(dirname(input.project), "source");
  let program = ts.createProgram(parsed.fileNames, parsed.options);
  const closureChecker = program.getTypeChecker();
  for (const file of stagedFiles(program, root)) {
    const output = lowerClosures(file, closureChecker);
    if (output !== file.text) writeFileSync(file.fileName, output);
  }
  program = ts.createProgram(parsed.fileNames, parsed.options);
  const originalChecker = program.getTypeChecker();
  const intrinsic = resolve(root, intrinsicFile);
  const references = new Set<string>();
  for (const file of stagedFiles(program, root)) {
    const modulePath = relative(dirname(file.fileName), intrinsic).split(sep).join("/").replace(/\.ts$/, ".js");
    const output = lowerNullable(file, originalChecker, modulePath.startsWith(".") ? modulePath : "./" + modulePath);
    if (output.usesReferenceRead) references.add(referenceRead);
    if (output.text !== file.text) writeFileSync(file.fileName, output.text);
  }
  const referenceModuleWritten = references.size > 0;
  if (referenceModuleWritten) writeFileSync(intrinsic, [...references].join(""), { flag: "wx" });
  program = ts.createProgram(parsed.fileNames, parsed.options);
  const nullableChecker = program.getTypeChecker();
  for (const file of stagedFiles(program, root).filter(file => file.fileName !== intrinsic)) {
    const output = lowerNullable(file, nullableChecker);
    if (output.text !== file.text) writeFileSync(file.fileName, output.text);
  }
  program = ts.createProgram(parsed.fileNames, parsed.options);
  const requiredChecker = program.getTypeChecker();
  for (const [file, text] of lowerRequired(stagedFiles(program, root).filter(file => file.fileName !== intrinsic), requiredChecker)) {
    if (text !== readFileSync(file, "utf8")) writeFileSync(file, text);
  }
  program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  for (const file of stagedFiles(program, root).filter(file => file.fileName !== intrinsic)) {
    const modulePath = relative(dirname(file.fileName), intrinsic).split(sep).join("/").replace(/\.ts$/, ".js");
    const output = lowerWasm(file, checker, modulePath.startsWith(".") ? modulePath : "./" + modulePath);
    if (output.usesMultiply) references.add(multiplyReference);
    if (output.usesPredicates) references.add(floatReference);
    if (output.usesCoercion) references.add(integerReference);
    if (output.usesUnchecked) references.add(uncheckedReference);
    if (output.text !== file.text) writeFileSync(file.fileName, output.text);
  }
  if (!references.size) return [];
  writeFileSync(intrinsic, [...references].join(""), { flag: referenceModuleWritten ? "w" : "wx" });
  return [intrinsic];
}

function stagedFiles(program: ts.Program, root: string): ts.SourceFile[] {
  const files = program.getSourceFiles().filter(file => !file.isDeclarationFile && !program.isSourceFileFromExternalLibrary(file));
  for (const file of files) {
    const path = relative(root, realpathSync(file.fileName));
    if (isAbsolute(path) || path === ".." || path.startsWith(".." + sep)) throw new Error("WASM source outside staging tree: " + file.fileName);
  }
  return files;
}

/** Alias existing native operations without reserving canonical source names. */
export function wasmPrelude(compiler: string, work: string): string {
  const path = resolve(work, "leek-prelude.ts");
  const inherited = readFileSync(resolve(compiler, "prelude/teto-baseline.ts"), "utf8");
  writeFileSync(path, inherited + '\nimport { F64 as LeekF64 } from "~lib/number";\n' +
    'import { NativeMath as LeekNativeMath } from "~lib/math";\n' +
    '@inline function LeekReferenceAt<T>(values: Array<T>, index: i32): T | null { return unchecked(values[index]); }\n' +
    '@inline function LeekMulU32(left: u32, right: u32): u32 { return mulU32(left, right); }\n');
  return path;
}

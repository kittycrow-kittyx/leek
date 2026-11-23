import { createHash } from "node:crypto";
import { dirname, relative, sep } from "node:path";
import ts from "typescript";
import { nativeFunction, nativeParameter, nativeVariable } from "../../baguette/src/ast.ts";
import { required } from "../../baguette/src/required.ts";
import { functionBody } from "./function-body.ts";
import { identifiers } from "./names.ts";
import { primitiveSnapshot, type PrimitiveRead } from "./primitive-read.ts";
import { optionalComparison, optionalStringification } from "./comparison.ts";
import { nullTest, requiredCall, type RequiredCall } from "./required-calls.ts";

export const requiredAliases = { LeekRequiredIndex: "i32" } as const;

interface Specialisation {
  input: RequiredCall;
  namespace: string;
  name: string;
  presence: string;
}

function suspended(node: ts.Node): boolean {
  if (ts.isFunctionLike(node)) return false;
  return ts.isAwaitExpression(node) || ts.isYieldExpression(node) || (ts.forEachChild(node, suspended) ?? false);
}

/** Substitute the original helper's generic type and null tests; retain its body and error path. */
function specialisedFunction(plan: Specialisation, checker: ts.TypeChecker): ts.FunctionDeclaration {
  const { input, name, presence } = plan;
  const f = ts.factory;
  const binding = required(input.helper.parameters[0] ?? null, "nullable parameter");
  const symbol = required(checker.getSymbolAtLocation(binding.name) ?? null, "nullable parameter symbol");
  const output = required(checker.typeToTypeNode(input.signature.getReturnType(), input.helper, ts.NodeBuilderFlags.NoTruncation) ?? null, "specialised result");
  const parameters = input.signature.parameters.map((parameter, index) => {
    const type = checker.getTypeOfSymbolAtLocation(parameter, input.call);
    const concrete = index === 0 ? checker.getNonNullableType(type) : type;
    const annotation = required(checker.typeToTypeNode(concrete, input.helper, ts.NodeBuilderFlags.NoTruncation) ?? null, "specialised parameter");
    const original = required(input.helper.parameters[index] ?? null, "original parameter");
    return nativeParameter(original.name, annotation);
  });
  const firstType = required(parameters[0] ?? null, "specialised value").type ?? null;
  if (!firstType) throw new Error("Missing specialised value type");
  const result = ts.transform(required(input.helper.body ?? null, "helper body"), [context => root => {
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      const left = ts.isBinaryExpression(node) ? nullTest(node.left, symbol, checker) : null;
      const right = ts.isBinaryExpression(node) ? nullTest(node.right, symbol, checker) : null;
      const test = left ?? right;
      if (test) return test.present ? f.createIdentifier(presence) : f.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken, f.createIdentifier(presence));
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && (checker.getSymbolAtLocation(node.typeName) ?? null) === input.typeParameter) return firstType;
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit, ts.isBlock) ?? root;
  }]);
  try {
    return nativeFunction({ name: f.createIdentifier(name), modifiers: [f.createModifier(ts.SyntaxKind.ExportKeyword)], typeParameters: [],
      parameters: [nativeParameter(presence, f.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword)), ...parameters], returns: output,
      body: required(result.transformed[0] ?? null, "specialised body") });
  } finally { result.dispose(); }
}

/** Consume optional primitives with separate presence storage in checked helpers and strict comparisons. */
export function lowerRequired(files: readonly ts.SourceFile[], checker: ts.TypeChecker): Map<string, string> {
  const f = ts.factory;
  const fileNames = new Map(files.map(file => [file, identifiers(file)]));
  const serials = new Map<ts.SourceFile, number>();
  const fresh = (file: ts.SourceFile, suffix: string): string => {
    const names = required(fileNames.get(file) ?? null, "staged module identifiers");
    const hash = createHash("sha256").update(file.text).digest("hex").slice(0, 12);
    let serial = serials.get(file) ?? 0;
    let name: string;
    do { name = "__leek_" + hash + "_" + suffix + serial++; } while (names.has(name));
    names.add(name); serials.set(file, serial);
    return name;
  };
  const plans = new Map<ts.FunctionDeclaration, Map<string, Specialisation>>();
  const namespaces = new Map<ts.SourceFile, string>();
  let changed = false;
  const outputs = new Map<ts.SourceFile, ts.SourceFile>();
  const headers = new Map<ts.SourceFile, string>();
  for (const source of files) {
    const scopes: ts.VariableDeclaration[][] = [];
    const imports = new Map<string, string>();
    let alias = false;
    const result = ts.transform(source, [context => root => {
      const visit: ts.Visitor<ts.Node, ts.Node> = node => {
        const body = functionBody(node);
        if (body) {
          scopes.push([]);
          const visited = ts.visitNode(body, visit, ts.isConciseBody) ?? body;
          const declarations = required(scopes.pop() ?? null, "function temporaries");
          const block = declarations.length ? f.createBlock([f.createVariableStatement([], f.createVariableDeclarationList(declarations, ts.NodeFlags.Let)),
            ...(ts.isBlock(visited) ? visited.statements : [f.createReturnStatement(visited)])], true) : visited;
          return ts.visitEachChild(node, child => child === body ? block : child, context);
        }
        const scope = scopes[scopes.length - 1] ?? null;
        const expression = (value: ts.Expression): ts.Expression => ts.visitNode(value, visit, ts.isExpression) ?? value;
        const temporary = (type: ts.TypeNode): ts.Identifier => {
          const name = f.createIdentifier(fresh(source, "value"));
          if (!scope) throw new Error("Missing primitive read scope");
          scope.push(nativeVariable(name, type, null));
          return name;
        };
        const capture = (input: PrimitiveRead): ReturnType<typeof primitiveSnapshot> & { present: ts.Identifier } => {
          const array = temporary(input.receiverType), index = temporary(input.indexType);
          const present = temporary(f.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword));
          if (input.kind !== "map" && !alias && required(fileNames.get(source) ?? null, "index alias scope").has("LeekRequiredIndex")) throw new Error("Leek WASM: reserved required index binding in " + source.fileName);
          alias ||= input.kind !== "map";
          return { ...primitiveSnapshot(input, array, index, present, "LeekRequiredIndex", expression), present };
        };
        const comparison = scope && ts.isBinaryExpression(node) && !suspended(node) ? optionalComparison(node, checker, capture, temporary, expression) : null;
        if (comparison) { changed = true; return comparison; }
        const stringified = scope && ts.isCallExpression(node) && !suspended(node) ? optionalStringification(node, checker, capture) : null;
        if (stringified) { changed = true; return stringified; }
        const input = scope && ts.isCallExpression(node) && !suspended(node) ? requiredCall(node, checker) : null;
        if (!scope || !input || !fileNames.has(input.helper.getSourceFile())) return ts.visitEachChild(node, visit, context);
        const helperSource = input.helper.getSourceFile();
        const key = input.signature.parameters.map(parameter => checker.typeToString(checker.getTypeOfSymbolAtLocation(parameter, input.call))).join(";");
        const variants = plans.get(input.helper) ?? new Map<string, Specialisation>();
        const namespace = namespaces.get(helperSource) ?? fresh(helperSource, "required");
        namespaces.set(helperSource, namespace);
        const plan = variants.get(key) ?? { input, namespace, name: fresh(helperSource, "value"), presence: fresh(helperSource, "present") };
        variants.set(key, plan); plans.set(input.helper, variants);
        const snapshot = capture(input);
        const check = f.createParenthesizedExpression(f.createCommaListExpression(snapshot.effects));
        const value = snapshot.value;
        changed = true;
        const path = relative(dirname(source.fileName), helperSource.fileName).split(sep).join("/").replace(/\.ts$/, ".js");
        const specifier = path.startsWith(".") ? path : "./" + path;
        if (helperSource !== source) imports.set(plan.namespace, specifier);
        return f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier(plan.namespace), plan.name), [], [check, value,
          ...input.call.arguments.slice(1).map(argument => ts.visitNode(argument, visit, ts.isExpression) ?? argument)]);
      };
      return ts.visitNode(root, visit, ts.isSourceFile) ?? root;
    }]);
    try {
      const rewritten = required(result.transformed[0] ?? null, "required call output");
      const importsText = [...imports].map(([name, path]) => "import { " + name + " } from " + JSON.stringify(path) + ";\n").join("");
      headers.set(source, importsText);
      const prefix = alias ? ts.createSourceFile("index.ts", "type LeekRequiredIndex = number;", ts.ScriptTarget.Latest, true).statements : [];
      outputs.set(source, f.updateSourceFile(rewritten, [...prefix, ...rewritten.statements]));
    } finally { result.dispose(); }
  }
  for (const [source, name] of namespaces) {
    const functions = [...plans.values()].flatMap(variants => [...variants.values()]).filter(plan => plan.input.helper.getSourceFile() === source).map(plan => specialisedFunction(plan, checker));
    const output = required(outputs.get(source) ?? null, "specialised module");
    const namespace = f.createModuleDeclaration([f.createModifier(ts.SyntaxKind.ExportKeyword)], f.createIdentifier(name), f.createModuleBlock(functions), ts.NodeFlags.Namespace);
    outputs.set(source, f.updateSourceFile(output, [namespace, ...output.statements]));
  }
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  return new Map([...outputs].map(([source, output]) => [source.fileName, changed ? printer.printFile(output) + "\n" + (headers.get(source) ?? "") : source.text]));
}

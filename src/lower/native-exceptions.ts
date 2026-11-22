import ts from "typescript";
import { nativeVariable } from "../../baguette/src/ast.ts";
import { errorDomain, standardError } from "./error-domain.ts";
import { functionOwner } from "./function-body.ts";
import { librarySymbol, unwrap } from "./integers.ts";
import { parameterWritten, valueSymbol } from "./captures.ts";
import { identifiers } from "./names.ts";
import { catchAliases, errorString } from "./catch-bindings.ts";

export const exceptionReference = `export declare function LeekTry(): boolean;
export declare function LeekCaught(): Error;
export declare function LeekRaise(error: Error): Error;
export declare function LeekErrorAs<T extends Error>(value: Error): T;
export declare function unreachable(): never;
`;
export const exceptionPrelude = `
@global @external("leek.internal", "try") declare function LeekTry(): bool;
@global @external("leek.internal", "caught") declare function LeekCaught(): Error;
@global @external("leek.internal", "raise") declare function LeekRaise(error: Error): Error;
@inline function LeekErrorAs<T>(value: Error): T { return changetype<T>(value); }
`;

function nativeCatch(node: ts.Node, checker: ts.TypeChecker, domain: (node: ts.Node) => boolean): ts.CatchClause | null {
  if (!ts.isTryStatement(node) || (node.finallyBlock ?? null)) return null;
  const clause = node.catchClause ?? null, scope = functionOwner(node);
  if (!clause || !scope) return null;
  const async = ts.canHaveModifiers(scope) && (ts.getModifiers(scope) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  if (async || !standardError(node, checker) || !standardError(clause.block, checker) || !domain(node.tryBlock)) return null;
  const variable = clause.variableDeclaration ?? null;
  if (variable && !ts.isIdentifier(variable.name)) return null;
  const symbol = variable && ts.isIdentifier(variable.name) ? valueSymbol(variable.name, checker) : null;
  return symbol && parameterWritten(clause.block, symbol, checker) ? null : clause;
}

function normalisedError(node: ts.Node, checker: ts.TypeChecker, caught: ReadonlySet<ts.Symbol>): ts.Expression | null {
  if (!ts.isConditionalExpression(node)) return null;
  const condition = unwrap(node.condition);
  if (!ts.isBinaryExpression(condition) || condition.operatorToken.kind !== ts.SyntaxKind.InstanceOfKeyword) return null;
  const input = unwrap(condition.left);
  const standard = ts.isIdentifier(condition.right) && condition.right.text === "Error" && librarySymbol(checker.getSymbolAtLocation(condition.right) ?? null);
  const symbol = ts.isIdentifier(input) ? valueSymbol(input, checker) : null;
  return standard && symbol && caught.has(symbol) ? node.whenTrue : null;
}

/** Lower synchronous Error regions to compiler markers, retaining the original calls, catch objects and exits. */
export function lowerNativeExceptions(source: ts.SourceFile, checker: ts.TypeChecker, intrinsicSpecifier: string, files = [source]): { text: string; used: boolean } {
  const domain = errorDomain(checker, files);
  const caught = new Set<ts.Symbol>();
  const used = new Set<string>();
  const result = ts.transform(source, [context => root => {
    const f = ts.factory;
    const call = (name: string, args: ts.Expression[] = [], types: ts.TypeNode[] = []): ts.CallExpression => {
      used.add(name);
      return f.createCallExpression(f.createIdentifier(name), types, args);
    };
    const region = (node: ts.TryStatement, clause: ts.CatchClause): ts.Statement => {
      const variable = clause.variableDeclaration ?? null;
      const symbol = variable && ts.isIdentifier(variable.name) ? valueSymbol(variable.name, checker) : null;
      const aliases = catchAliases(clause, checker);
      const symbols = [symbol, ...[...aliases.keys()].map(declaration => ts.isIdentifier(declaration.name) ? valueSymbol(declaration.name, checker) : null)]
        .filter((binding): binding is ts.Symbol => binding !== null);
      for (const binding of symbols) caught.add(binding);
      const handler = ts.visitNode(clause.block, visit, ts.isBlock) ?? clause.block;
      for (const binding of symbols) caught.delete(binding);
      const binding = variable ? [f.createVariableStatement([], f.createVariableDeclarationList([
        nativeVariable(variable.name, f.createTypeReferenceNode("Error"), call("LeekCaught"))
      ], ts.NodeFlags.Let))] : [];
      return f.createIfStatement(call("LeekTry"), ts.visitNode(node.tryBlock, visit, ts.isBlock) ?? node.tryBlock,
        f.updateBlock(handler, [...binding, ...handler.statements]));
    };
    const property = (node: ts.Node): ts.Expression | null => {
      if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression)) return null;
      const binding = valueSymbol(node.expression, checker);
      if (!binding || !caught.has(binding)) return null;
      const narrowed = checker.getTypeAtLocation(node.expression), shape = narrowed.getSymbol() ?? null;
      if (!shape || librarySymbol(shape)) return null;
      const annotation = checker.typeToTypeNode(narrowed, node, ts.NodeBuilderFlags.NoTruncation) ?? null;
      return annotation ? f.updatePropertyAccessExpression(node, call("LeekErrorAs", [node.expression], [annotation]), node.name) : null;
    };
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      const clause = nativeCatch(node, checker, domain);
      if (clause && ts.isTryStatement(node)) return region(node, clause);
      const normalised = normalisedError(node, checker, caught);
      if (normalised) return ts.visitNode(normalised, visit, ts.isExpression) ?? normalised;
      const converted = errorString(node, checker);
      const symbol = converted && ts.isIdentifier(unwrap(converted)) ? valueSymbol(unwrap(converted) as ts.Identifier, checker) : null;
      if (converted && symbol && caught.has(symbol)) return f.createCallExpression(f.createPropertyAccessExpression(converted, "toString"), [], []);
      const narrowed = property(node);
      if (narrowed) return narrowed;
      if (ts.isThrowStatement(node) && domain(node)) {
        const scope = functionOwner(node);
        const stop = call("unreachable");
        return f.createBlock([f.createExpressionStatement(call("LeekRaise", [ts.visitNode(node.expression, visit, ts.isExpression) ?? node.expression])),
          scope && ts.isGetAccessorDeclaration(scope) ? f.createReturnStatement(stop) : f.createExpressionStatement(stop)], true);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit, ts.isSourceFile) ?? root;
  }]);
  try {
    if (!used.size) return { text: source.text, used: false };
    const reserved = identifiers(source);
    for (const name of used) if (reserved.has(name)) throw new Error("Leek WASM: reserved exception binding " + name + " in " + source.fileName);
    return { text: "import { " + [...used].join(", ") + " } from " + JSON.stringify(intrinsicSpecifier) + ";\n" +
      ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0] ?? source), used: true };
  } finally { result.dispose(); }
}

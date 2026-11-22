import ts from "typescript";
import { nativeVariable } from "../../baguette/src/ast.ts";
import { closedBlock, localHandler, standardError } from "./exception-facts.ts";
import { abruptCompletion, functionOwner } from "./function-body.ts";
import { identifiers } from "./names.ts";
import { unwrap } from "./integers.ts";
import { parameterWritten, valueSymbol } from "./captures.ts";

interface ErrorCall {
  helper: ts.FunctionDeclaration;
  calls: ts.CallExpression[];
}

function synchronous(node: ts.Node): boolean {
  return ts.isFunctionLike(node) && !(ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword));
}

function tailCall(node: ts.Identifier, helper: ts.FunctionDeclaration, checker: ts.TypeChecker): ts.CallExpression | null {
  let value: ts.Expression = node;
  while (ts.isParenthesizedExpression(value.parent)) value = value.parent;
  const call = value.parent;
  const result = ts.isCallExpression(call) ? call.parent : null;
  const owner = functionOwner(node);
  if (!ts.isCallExpression(call) || call.expression !== value || (call.questionDotToken ?? null) || !result || !ts.isReturnStatement(result) ||
    (result.expression ?? null) !== call || !owner || owner === helper || !synchronous(owner) || call.arguments.length !== helper.parameters.length ||
    call.arguments.some(ts.isSpreadElement) || !standardError(node, checker) || !localHandler(node, checker)) return null;
  return call;
}

/** Every reference must be a direct tail call; otherwise removing the private function would change its identity or invocation contract. */
function tailCalls(source: ts.SourceFile, helper: ts.FunctionDeclaration, checker: ts.TypeChecker): ts.CallExpression[] | null {
  const name = helper.name ?? null;
  const symbol = name ? checker.getSymbolAtLocation(name) ?? null : null;
  if (!symbol || parameterWritten(source, symbol, checker)) return null;
  const calls: ts.CallExpression[] = [];
  let valid = true;
  const scan = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && ["eval", "Function"].includes(node.text)) valid = false;
    const reference = ts.isIdentifier(node) ? valueSymbol(node, checker) : null;
    const target = reference && reference.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(reference) : reference;
    const referenced = ts.isIdentifier(node) && node !== name && target === symbol;
    const call = referenced && ts.isIdentifier(node) ? tailCall(node, helper, checker) : null;
    if (referenced && !call) valid = false;
    if (call) calls.push(call);
    ts.forEachChild(node, scan);
  };
  scan(source);
  return valid && calls.length > 0 ? calls : null;
}

/** Var storage would survive repeated inlined calls; named types could bind to a different caller declaration. */
function relocatedScope(node: ts.Node): boolean {
  return ts.isVariableDeclarationList(node) && !(node.flags & ts.NodeFlags.BlockScoped) || ts.isTypeReferenceNode(node) || ts.isTypeQueryNode(node) ||
    ts.isTypePredicateNode(node) || (ts.forEachChild(node, relocatedScope) ?? false);
}

function errorHelpers(source: ts.SourceFile, checker: ts.TypeChecker): ErrorCall[] {
  if (!ts.isExternalModule(source)) return [];
  const helpers: ErrorCall[] = [];
  for (const node of source.statements) {
    const body = ts.isFunctionDeclaration(node) ? node.body ?? null : null;
    if (!ts.isFunctionDeclaration(node) || !body || !synchronous(node) || (node.asteriskToken ?? null) || (node.typeParameters ?? []).length ||
      (node.modifiers ?? []).some(modifier => [ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.DefaultKeyword].includes(modifier.kind))) continue;
    const signature = checker.getSignatureFromDeclaration(node) ?? null;
    const primitive = ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.StringLike | ts.TypeFlags.BooleanLike;
    if (!signature || !(signature.getReturnType().flags & (primitive | ts.TypeFlags.Void)) || (signature.getReturnType().getSymbol() ?? null) || node.parameters.some(parameter => !ts.isIdentifier(parameter.name) ||
      (parameter.initializer ?? null) || (parameter.dotDotDotToken ?? null) || (parameter.questionToken ?? null) || !(checker.getTypeAtLocation(parameter.name).flags & primitive))) continue;
    if (relocatedScope(node) || !closedBlock(body, node, checker) || !(signature.getReturnType().flags & ts.TypeFlags.Void) && !abruptCompletion(body)) continue;
    const calls = tailCalls(source, node, checker);
    if (calls) helpers.push({ helper: node, calls });
  }
  return helpers;
}

/** Inline a closed helper body with fresh local bindings, preserving argument evaluation and each original return and throw. */
function inlineBody(input: ErrorCall, call: ts.CallExpression, checker: ts.TypeChecker, fresh: () => ts.Identifier): ts.Block {
  const f = ts.factory;
  const helper = input.helper, body = helper.body ?? null;
  if (!body) throw new Error("Missing closed error helper body");
  const replacements = new Map<ts.Symbol, ts.Identifier>();
  const bind = (node: ts.Identifier): void => {
    const symbol = checker.getSymbolAtLocation(node) ?? null;
    if (symbol && !replacements.has(symbol)) replacements.set(symbol, fresh());
  };
  for (const parameter of helper.parameters) if (ts.isIdentifier(parameter.name)) bind(parameter.name);
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bind(node.name);
    ts.forEachChild(node, collect);
  };
  collect(body);
  const parameters = helper.parameters.map((parameter, index) => {
    const symbol = checker.getSymbolAtLocation(parameter.name) ?? null;
    const name = symbol ? replacements.get(symbol) ?? null : null;
    const value = call.arguments[index] ?? null;
    const type = checker.typeToTypeNode(checker.getTypeAtLocation(parameter.name), call, ts.NodeBuilderFlags.NoTruncation) ?? null;
    if (!name || !value || !type) throw new Error("Missing closed error helper parameter");
    return nativeVariable(name, type, value);
  });
  const transformed = ts.transform(body, [context => root => {
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      const symbol = ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) ?? null : null;
      const replacement = symbol ? replacements.get(symbol) ?? null : null;
      return replacement ?? ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit, ts.isBlock) ?? root;
  }]);
  try {
    const output = transformed.transformed[0] ?? body;
    return f.createBlock([...(parameters.length ? [f.createVariableStatement([], f.createVariableDeclarationList(parameters, ts.NodeFlags.Let))] : []),
      ...output.statements, ...(checker.getTypeAtLocation(call).flags & ts.TypeFlags.Void ? [f.createReturnStatement()] : [])], true);
  } finally { transformed.dispose(); }
}

/** Expose closed private Error throws to the existing catch pass without allocating success wrappers or changing upstream code. */
export function lowerErrorCalls(source: ts.SourceFile, checker: ts.TypeChecker): string {
  const helpers = errorHelpers(source, checker);
  if (!helpers.length) return source.text;
  const removed = new Set(helpers.map(input => input.helper));
  const calls = new Map(helpers.flatMap(input => input.calls.map(call => [call, input] as const)));
  const names = identifiers(source);
  let serial = 0;
  const fresh = (): ts.Identifier => {
    let name: string;
    do { name = "__leekErrorArgument" + serial++; } while (names.has(name));
    names.add(name);
    return ts.factory.createIdentifier(name);
  };
  const retained = ts.factory.updateSourceFile(source, source.statements.filter(statement => !ts.isFunctionDeclaration(statement) || !removed.has(statement)));
  const transformed = ts.transform(retained, [context => root => {
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      const expression = ts.isReturnStatement(node) ? node.expression ?? null : null;
      const call = expression ? unwrap(expression) : null;
      const input = call && ts.isCallExpression(call) ? calls.get(call) ?? null : null;
      if (input && call && ts.isCallExpression(call)) return inlineBody(input, call, checker, fresh);
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit, ts.isSourceFile) ?? root;
  }]);
  try { return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0] ?? source); }
  finally { transformed.dispose(); }
}

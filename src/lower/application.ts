import ts from "typescript";
import { parameterWritten } from "./captures.ts";
import { unwrap } from "./integers.ts";

export interface NullableApplication {
  input: ts.Expression;
  type: ts.TypeNode;
  callback: ts.ArrowFunction;
  parameter: ts.Symbol;
}

function nullReturn(statement: ts.Statement): boolean {
  const node = ts.isBlock(statement) && statement.statements.length === 1 ? statement.statements[0] ?? null : statement;
  const expression = node !== null && ts.isReturnStatement(node) ? node.expression ?? null : null;
  return expression !== null && expression.kind === ts.SyntaxKind.NullKeyword;
}

/** Verify the implementation, rather than its name, before replacing a nullable application with its guard and callback. */
function appliesPresent(helper: ts.FunctionDeclaration, checker: ts.TypeChecker): boolean {
  const parameters = helper.parameters;
  const body = helper.body ?? null;
  if (!body || (helper.asteriskToken ?? null) || parameters.length !== 2 || parameters.some(parameter => !ts.isIdentifier(parameter.name) || (parameter.initializer ?? null) || (parameter.dotDotDotToken ?? null))) return false;
  const value = parameters[0] ?? null, use = parameters[1] ?? null;
  if (!value || !use || !ts.isIdentifier(value.name) || !ts.isIdentifier(use.name) || body.statements.length !== 2 || (helper.modifiers ?? []).some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) return false;
  const guard = body.statements[0] ?? null, result = body.statements[1] ?? null;
  if (!guard || !ts.isIfStatement(guard) || (guard.elseStatement ?? null) || !nullReturn(guard.thenStatement) || !result || !ts.isReturnStatement(result)) return false;
  const test = unwrap(guard.expression), call = result.expression ?? null;
  if (!ts.isBinaryExpression(test) || test.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken || !call || !ts.isCallExpression(call) || call.arguments.length !== 1) return false;
  const left = unwrap(test.left), right = unwrap(test.right);
  const checked = left.kind === ts.SyntaxKind.NullKeyword ? right : right.kind === ts.SyntaxKind.NullKeyword ? left : null;
  const argument = call.arguments[0] ?? null;
  const valueSymbol = checker.getSymbolAtLocation(value.name) ?? null, useSymbol = checker.getSymbolAtLocation(use.name) ?? null;
  return valueSymbol !== null && useSymbol !== null && checked !== null && ts.isIdentifier(checked) && (checker.getSymbolAtLocation(checked) ?? null) === valueSymbol &&
    ts.isIdentifier(call.expression) && (checker.getSymbolAtLocation(call.expression) ?? null) === useSymbol && argument !== null && ts.isIdentifier(argument) && (checker.getSymbolAtLocation(argument) ?? null) === valueSymbol;
}

function truthContext(node: ts.Expression): boolean {
  while (ts.isParenthesizedExpression(node.parent)) node = node.parent;
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(parent.operatorToken.kind)) return truthContext(parent);
  return ts.isExpressionStatement(parent) || ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken ||
    (ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) && parent.expression === node ||
    ts.isConditionalExpression(parent) && parent.condition === node || ts.isForStatement(parent) && (parent.condition ?? null) === node;
}

/** Inline only expression callbacks with no nested environment, writes to their parameter or shadowed type scope. */
export function nullableApplication(node: ts.BinaryExpression, checker: ts.TypeChecker): NullableApplication | null {
  const call = unwrap(node.left);
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || (call.questionDotToken ?? null) || call.arguments.length !== 2) return null;
  const input = call.arguments[0] ?? null, arrow = call.arguments[1] ?? null;
  if (!input || !arrow || !ts.isArrowFunction(arrow) || ts.isBlock(arrow.body) || (arrow.modifiers ?? []).length || (arrow.typeParameters ?? []).length || arrow.parameters.length !== 1) return null;
  const binding = arrow.parameters[0] ?? null;
  if (!binding || !ts.isIdentifier(binding.name) || (binding.initializer ?? null) || (binding.dotDotDotToken ?? null)) return null;
  const parameter = checker.getSymbolAtLocation(binding.name) ?? null;
  const nested = (child: ts.Node): boolean => ts.isFunctionLike(child) || ts.isTypeNode(child) || ts.isIdentifier(child) && child.text === "eval" || (ts.forEachChild(child, nested) ?? false);
  if (!parameter || parameterWritten(arrow.body, parameter, checker) || nested(arrow.body)) return null;
  const signature = checker.getResolvedSignature(call) ?? null;
  const helper = signature ? signature.getDeclaration() ?? null : null;
  const callee = checker.getSymbolAtLocation(call.expression) ?? null;
  const target = callee && callee.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(callee) : callee;
  if (!helper || !ts.isFunctionDeclaration(helper) || !target || (target.valueDeclaration ?? null) !== helper || parameterWritten(helper.getSourceFile(), target, checker) || !appliesPresent(helper, checker)) return null;
  const value = checker.getTypeAtLocation(input), result = checker.getTypeAtLocation(unwrap(arrow.body));
  const parts = value.isUnion() ? value.types : [value], results = result.isUnion() ? result.types : [result];
  const references = ts.TypeFlags.StringLike | ts.TypeFlags.Object | ts.TypeFlags.Null;
  if (!parts.every(part => Boolean(part.flags & references)) || !parts.some(part => Boolean(part.flags & ts.TypeFlags.Null))) return null;
  if (!results.every(part => Boolean(part.flags & ts.TypeFlags.BooleanLike)) || unwrap(node.right).kind !== ts.SyntaxKind.NullKeyword || !truthContext(node)) return null;
  const type = checker.typeToTypeNode(value, node, ts.NodeBuilderFlags.NoTruncation) ?? null;
  return type ? { input, type, callback: arrow, parameter } : null;
}

/** Substitute only references to the callback parameter, retaining shorthand keys and lexical this. */
export function appliedExpression(input: NullableApplication, value: ts.Expression, checker: ts.TypeChecker): ts.Expression {
  const body = input.callback.body;
  if (ts.isBlock(body)) throw new Error("Nullable application requires an expression callback");
  const result = ts.transform(body, [context => root => {
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      if (ts.isShorthandPropertyAssignment(node) && (checker.getShorthandAssignmentValueSymbol(node) ?? null) === input.parameter) return ts.factory.createPropertyAssignment(node.name, value);
      if (ts.isIdentifier(node) && (checker.getSymbolAtLocation(node) ?? null) === input.parameter) return value;
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit, ts.isExpression) ?? root;
  }]);
  try { return result.transformed[0] ?? body; }
  finally { result.dispose(); }
}

import ts from "typescript";
import { arrayType, librarySymbol, unwrap } from "./integers.ts";
import { functionOwner as owner } from "./function-body.ts";
import { parameterWritten } from "./captures.ts";


/** Only standard Error construction has a known thrown shape; custom constructors and arbitrary values need propagation lowering. */
function errorValue(node: ts.Expression, checker: ts.TypeChecker): boolean {
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "Error" || !librarySymbol(checker.getSymbolAtLocation(node.expression) ?? null)) return false;
  const symbol = checker.getSymbolAtLocation(node.expression) ?? null;
  if (!symbol || parameterWritten(node.getSourceFile(), symbol, checker)) return false;
  return (node.arguments ?? []).length <= 1 && (node.arguments ?? []).every(argument => Boolean(checker.getTypeAtLocation(argument).flags & ts.TypeFlags.StringLike));
}

function localIdentifier(node: ts.Identifier, scope: ts.Node, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(node) ?? null;
  const declaration = symbol ? symbol.valueDeclaration ?? null : null;
  return declaration !== null && (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration) || ts.isBindingElement(declaration)) && owner(declaration) === scope;
}

function primitive(type: ts.Type): boolean {
  return type.isUnion() ? type.types.every(primitive) : Boolean(type.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.StringLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined));
}

/** Exclude operators whose conversion or invalid operands can throw a second, untracked exception. */
function safeBinary(node: ts.BinaryExpression, checker: ts.TypeChecker): boolean {
  const operator = node.operatorToken.kind;
  if ([ts.SyntaxKind.InKeyword, ts.SyntaxKind.InstanceOfKeyword].includes(operator)) return false;
  if (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment && !ts.isIdentifier(node.left)) return false;
  const left = checker.getTypeAtLocation(node.left), right = checker.getTypeAtLocation(node.right);
  const bigint = [left, right].flatMap(type => type.isUnion() ? type.types : [type]).some(type => Boolean(type.flags & ts.TypeFlags.BigIntLike));
  if (bigint && ![ts.SyntaxKind.EqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(operator)) return false;
  return primitive(left) && primitive(right);
}

function safeUnary(node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression, checker: ts.TypeChecker): boolean {
  const type = checker.getTypeAtLocation(node.operand);
  if (node.operator !== ts.SyntaxKind.ExclamationToken && !primitive(type)) return false;
  if (node.operator !== ts.SyntaxKind.ExclamationToken && (type.isUnion() ? type.types : [type]).some(part => Boolean(part.flags & ts.TypeFlags.BigIntLike))) return false;
  return ![ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) || ts.isIdentifier(node.operand);
}

/** Every executable operation in the block must either be non-throwing or an explicit standard Error throw. */
function closedBlock(block: ts.Block, scope: ts.Node, checker: ts.TypeChecker): boolean {
  let throws = 0;
  const safe = (node: ts.Node): boolean => {
    if (ts.isTypeNode(node)) return true;
    if (ts.isThrowStatement(node)) { throws++; return errorValue(node.expression, checker) && safe(node.expression); }
    if (ts.isNewExpression(node)) return errorValue(node, checker) && (node.arguments ?? []).every(safe);
    if (ts.isIdentifier(node)) return localIdentifier(node, scope, checker);
    if (ts.isCallExpression(node) || ts.isAwaitExpression(node) || ts.isYieldExpression(node) || ts.isFunctionLike(node) || ts.isClassLike(node) || ts.isDoStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isSwitchStatement(node) || ts.isTryStatement(node) || ts.isElementAccessExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isDeleteExpression(node) || ts.isTaggedTemplateExpression(node) || ts.isSpreadAssignment(node) || ts.isSpreadElement(node) || (ts.isArrayBindingPattern(node) || ts.isObjectBindingPattern(node))) return false;
    const condition = ts.isForStatement(node) ? node.condition ?? null : null;
    if (ts.isForStatement(node) && (!condition || unwrap(condition).kind === ts.SyntaxKind.TrueKeyword)) return false;
    if (ts.isWhileStatement(node) && unwrap(node.expression).kind === ts.SyntaxKind.TrueKeyword) return false;
    if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name)) return false;
    if (ts.isPropertyAccessExpression(node)) {
      const type = checker.getTypeAtLocation(node.expression);
      return node.name.text === "length" && Boolean(type.flags & ts.TypeFlags.StringLike || arrayType(type) || checker.isArrayType(type)) && safe(node.expression);
    }
    if (ts.isBinaryExpression(node) && !safeBinary(node, checker)) return false;
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && !safeUnary(node, checker)) return false;
    if (ts.isTemplateExpression(node) && node.templateSpans.some(span => !primitive(checker.getTypeAtLocation(span.expression)))) return false;
    return !(ts.forEachChild(node, child => !safe(child)) ?? false);
  };
  return safe(block) && throws > 0;
}

/** The caught value cannot escape or expose unsupported Error metadata. Message, name and standard string conversion retain their native contracts. */
function caughtRead(node: ts.Identifier, checker: ts.TypeChecker): boolean {
  let value: ts.Expression = node;
  while (ts.isParenthesizedExpression(value.parent) || ts.isNonNullExpression(value.parent) || ts.isAsExpression(value.parent) || ts.isTypeAssertionExpression(value.parent)) value = value.parent;
  const parent = value.parent;
  if (ts.isTypeOfExpression(parent)) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === value) {
    return ["message", "name"].includes(parent.name.text) || parent.name.text === "toString" && ts.isCallExpression(parent.parent) && parent.parent.expression === parent && parent.parent.arguments.length === 0;
  }
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && parent.left === value) {
    const constructor = unwrap(parent.right);
    return ts.isIdentifier(constructor) && ["Error", "RangeError", "TypeError", "SyntaxError", "URIError"].includes(constructor.text) && librarySymbol(checker.getSymbolAtLocation(constructor) ?? null);
  }
  return ts.isCallExpression(parent) && parent.arguments.length === 1 && (parent.arguments[0] ?? null) === value && ts.isIdentifier(parent.expression) && parent.expression.text === "String" && librarySymbol(checker.getSymbolAtLocation(parent.expression) ?? null);
}

function catchBinding(clause: ts.CatchClause, checker: ts.TypeChecker): boolean {
  const variable = clause.variableDeclaration ?? null;
  if (!variable) return true;
  if (!ts.isIdentifier(variable.name)) return false;
  const symbol = checker.getSymbolAtLocation(variable.name) ?? null;
  if (!symbol || parameterWritten(clause.block, symbol, checker)) return false;
  let valid = true;
  const scan = (node: ts.Node): void => {
    const declaration = ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ? node.name ?? null : null;
    if (declaration && ts.isIdentifier(declaration) && declaration.text === variable.name.getText()) valid = false;
    if (ts.isShorthandPropertyAssignment(node) && (checker.getShorthandAssignmentValueSymbol(node) ?? null) === symbol) valid = false;
    const reference = ts.isIdentifier(node) && (checker.getSymbolAtLocation(node) ?? null) === symbol;
    const type = reference ? checker.getTypeAtLocation(node) : null;
    if (type && (primitive(type) || Boolean(type.flags & ts.TypeFlags.ESSymbolLike) || ts.isIdentifier(node) && !caughtRead(node, checker))) valid = false;
    ts.forEachChild(node, scan);
  };
  scan(clause.block);
  return valid;
}

/** A local catch needs a closed throw domain and an unshadowed standard Error type at both generated declaration scopes. */
export function localCatch(node: ts.TryStatement, checker: ts.TypeChecker): ts.CatchClause | null {
  const clause = node.catchClause ?? null, scope = owner(node);
  const async = scope && ts.canHaveModifiers(scope) && (ts.getModifiers(scope) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  if (!clause || (node.finallyBlock ?? null) || !scope || async || !closedBlock(node.tryBlock, scope, checker) || !catchBinding(clause, checker)) return null;
  const standard = (point: ts.Node): boolean => librarySymbol(checker.getSymbolsInScope(point, ts.SymbolFlags.Type).find(symbol => symbol.getName() === "Error") ?? null);
  return standard(node) && standard(clause.block) ? clause : null;
}

import ts from "typescript";
import { arrayType, librarySymbol, unwrap } from "./integers.ts";
import { functionOwner as owner } from "./function-body.ts";
import { parameterWritten } from "./captures.ts";
import { catchBindings } from "./catch-bindings.ts";


/** Only standard Error construction has a known thrown shape; custom constructors and arbitrary values need propagation lowering. */
function errorValue(node: ts.Expression, checker: ts.TypeChecker): boolean {
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "Error" || !librarySymbol(checker.getSymbolAtLocation(node.expression) ?? null)) return false;
  const symbol = checker.getSymbolAtLocation(node.expression) ?? null;
  if (!symbol || parameterWritten(node.getSourceFile(), symbol, checker)) return false;
  return (node.arguments ?? []).length <= 1 && (node.arguments ?? []).every(argument => {
    const type = checker.getTypeAtLocation(argument);
    return (type.isUnion() ? type.types : [type]).every(part => Boolean(part.flags & ts.TypeFlags.StringLike));
  });
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
export function closedBlock(block: ts.Block, scope: ts.Node, checker: ts.TypeChecker): boolean {
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

/** The generated Error binding must retain the standard constructor and type in its lexical scope. */
export function standardError(point: ts.Node, checker: ts.TypeChecker): boolean {
  return [ts.SymbolFlags.Value, ts.SymbolFlags.Type].every(flags => librarySymbol(checker.getSymbolsInScope(point, flags).find(symbol => symbol.getName() === "Error") ?? null));
}

/** A private helper may lose its stack frame only when a surrounding catch cannot inspect or export the thrown object. */
export function localHandler(node: ts.Node, checker: ts.TypeChecker): boolean {
  const scope = owner(node);
  for (let current = node.parent; current && current !== scope; current = current.parent) {
    if (!ts.isTryStatement(current) || node.pos < current.tryBlock.pos || node.end > current.tryBlock.end) continue;
    const clause = current.catchClause ?? null;
    return clause !== null && !(current.finallyBlock ?? null) && catchBindings(clause, checker) !== null && standardError(clause.block, checker);
  }
  return false;
}

/** A local catch needs a closed throw domain and an unshadowed standard Error type at both generated declaration scopes. */
export function localCatch(node: ts.TryStatement, checker: ts.TypeChecker): ts.CatchClause | null {
  const clause = node.catchClause ?? null, scope = owner(node);
  const async = scope && ts.canHaveModifiers(scope) && (ts.getModifiers(scope) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  if (!clause || (node.finallyBlock ?? null) || !scope || async || !closedBlock(node.tryBlock, scope, checker) || catchBindings(clause, checker) === null) return null;
  return standardError(node, checker) && standardError(clause.block, checker) ? clause : null;
}

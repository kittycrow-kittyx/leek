import ts from "typescript";
import { librarySymbol, unwrap } from "./integers.ts";
import { primitiveRead, type PrimitiveRead } from "./primitive-read.ts";

interface CapturedRead { effects: ts.Expression[]; value: ts.Expression; present: ts.Identifier }

/** Strict equality consumes an optional primitive without boxing; snapshot the read before evaluating either later operand. */
export function optionalComparison(node: ts.Node, checker: ts.TypeChecker, capture: (read: PrimitiveRead) => CapturedRead,
  temporary: (type: ts.TypeNode) => ts.Identifier, visit: (node: ts.Expression) => ts.Expression): ts.Expression | null {
  if (!ts.isBinaryExpression(node) || ![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) return null;
  const left = unwrap(node.left), right = unwrap(node.right);
  const nullable = (value: ts.Expression): value is ts.BinaryExpression => ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && unwrap(value.right).kind === ts.SyntaxKind.NullKeyword;
  const readOnLeft = nullable(left);
  const selected = readOnLeft ? left : nullable(right) ? right : null;
  const read = selected ? primitiveRead(selected.left, checker) : null;
  if (!read) return null;
  const other = readOnLeft ? node.right : node.left;
  const empty = unwrap(other).kind === ts.SyntaxKind.NullKeyword;
  const family = read.bigint ? ts.TypeFlags.BigIntLike : ts.TypeFlags.NumberLike;
  if (!empty && !(checker.getTypeAtLocation(other).flags & family)) return null;
  const f = ts.factory;
  const unequal = node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  const alternative = empty ? null : temporary(f.createKeywordTypeNode(read.bigint ? ts.SyntaxKind.BigIntKeyword : ts.SyntaxKind.NumberKeyword));
  const value = empty ? null : temporary(f.createKeywordTypeNode(read.bigint ? ts.SyntaxKind.BigIntKeyword : ts.SyntaxKind.NumberKeyword));
  const saved = capture(read);
  const compare = alternative && value ? f.createBinaryExpression(value, node.operatorToken.kind, alternative) : unequal ? f.createTrue() : f.createFalse();
  const result = f.createConditionalExpression(saved.present, f.createToken(ts.SyntaxKind.QuestionToken), compare,
    f.createToken(ts.SyntaxKind.ColonToken), empty !== unequal ? f.createTrue() : f.createFalse());
  const operand = alternative ? [f.createAssignment(alternative, visit(other))] : [];
  const effects = [...saved.effects, ...(value ? [f.createAssignment(value, saved.value)] : [])];
  return f.createSatisfiesExpression(f.createParenthesizedExpression(f.createCommaListExpression([
    ...(readOnLeft ? [...effects, ...operand] : [...operand, ...effects]), result
  ])), f.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword));
}

/** String(...) consumes a missing typed-array primitive as "null", without boxing the optional value. */
export function optionalStringification(
  node: ts.Node,
  checker: ts.TypeChecker,
  capture: (read: PrimitiveRead) => CapturedRead,
): ts.Expression | null {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1 || !ts.isIdentifier(node.expression) ||
      node.expression.text !== "String" || (node.questionDotToken ?? null)) return null;
  if (!librarySymbol(checker.getSymbolAtLocation(node.expression) ?? null)) return null;
  const argument = unwrap(node.arguments[0] ?? node.expression);
  if (!ts.isBinaryExpression(argument) || argument.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken ||
      unwrap(argument.right).kind !== ts.SyntaxKind.NullKeyword) return null;
  const read = primitiveRead(argument.left, checker);
  if (!read || read.kind === "map") return null;
  const f = ts.factory;
  const snapshot = capture(read);
  const present = f.createCallExpression(node.expression, [], [snapshot.value]);
  const output = f.createConditionalExpression(
    snapshot.present,
    f.createToken(ts.SyntaxKind.QuestionToken), present,
    f.createToken(ts.SyntaxKind.ColonToken), f.createStringLiteral("null"),
  );
  return f.createSatisfiesExpression(
    f.createParenthesizedExpression(f.createCommaListExpression([...snapshot.effects, output])),
    f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
  );
}

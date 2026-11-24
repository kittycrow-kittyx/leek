import ts from "typescript";
import { arrayType, librarySymbol, unwrap } from "./integers.ts";
import { mapLookup } from "./map-lookup.ts";
import { indexCast, indexGuard, integerIndex } from "./index-access.ts";

export interface PrimitiveRead {
  receiver: ts.Expression;
  index: ts.Expression;
  receiverType: ts.TypeNode;
  indexType: ts.TypeNode;
  kind: "array" | "map" | "point";
  bigint: boolean;
}

/** Numeric reads carry presence separately; ordinary arrays can contain holes and numeric Map keys need SameValueZero support. */
export function primitiveRead(expression: ts.Expression, checker: ts.TypeChecker): PrimitiveRead | null {
  const read = unwrap(expression);
  const map = mapLookup(read, checker);
  if (map) {
    const numeric = map.valueType.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike);
    return numeric && map.keyType.kind === ts.SyntaxKind.StringKeyword ? {
      receiver: map.receiver, index: map.key, receiverType: map.receiverType, indexType: map.keyType,
      kind: "map", bigint: Boolean(map.valueType.flags & ts.TypeFlags.BigIntLike)
    } : null;
  }
  const element = ts.isElementAccessExpression(read) && !(read.questionDotToken ?? null) ? read : null;
  const array = element ? arrayType(checker.getTypeAtLocation(element.expression)) : null;
  const member = ts.isCallExpression(read) && read.arguments.length === 1 && !(read.questionDotToken ?? null) && ts.isPropertyAccessExpression(read.expression) ? read.expression : null;
  const point = member && !(member.questionDotToken ?? null) && member.name.text === "codePointAt" && checker.getTypeAtLocation(member.expression).flags & ts.TypeFlags.StringLike && librarySymbol(checker.getSymbolAtLocation(member.name) ?? null) && ts.isCallExpression(read) ? read : null;
  const receiver = array && element ? element.expression : point && member ? member.expression : null;
  const index = array && element ? element.argumentExpression ?? null : point ? point.arguments[0] ?? null : null;
  if (!receiver || !index || !(checker.getTypeAtLocation(index).flags & ts.TypeFlags.NumberLike)) return null;
  return { receiver, index, receiverType: array ? ts.factory.createTypeReferenceNode(array) : ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
    indexType: ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword), kind: array ? "array" : "point", bigint: Boolean(array && array.startsWith("Big")) };
}

/** Snapshot receiver, key, presence and value before evaluating a later operand that may mutate the storage. */
export function primitiveSnapshot(input: PrimitiveRead, receiver: ts.Identifier, index: ts.Identifier, present: ts.Identifier,
  alias: string, visit: (node: ts.Expression) => ts.Expression): { effects: ts.Expression[]; value: ts.Expression } {
  const f = ts.factory;
  const has = input.kind === "map" ? f.createCallExpression(f.createPropertyAccessExpression(receiver, "has"), [], [index]) : indexGuard(receiver, index);
  const value = input.kind === "array" ? f.createElementAccessExpression(receiver, indexCast(index, alias)) :
    f.createCallExpression(f.createPropertyAccessExpression(receiver, input.kind === "map" ? "get" : "codePointAt"), [], [input.kind === "map" ? index : indexCast(index, alias)]);
  return { effects: [f.createAssignment(receiver, visit(input.receiver)), f.createAssignment(index, visit(input.index)),
    ...(input.kind === "point" ? [f.createAssignment(index, integerIndex(index))] : []), f.createAssignment(present, has)],
  value: f.createConditionalExpression(present, f.createToken(ts.SyntaxKind.QuestionToken), f.createNonNullExpression(value),
    f.createToken(ts.SyntaxKind.ColonToken), input.bigint ? f.createBigIntLiteral("0n") : f.createNumericLiteral(0)) };
}

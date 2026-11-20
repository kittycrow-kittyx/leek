import ts from "typescript";

/** A numeric property key must be an in-bounds integer before a native indexed read. */
export function indexGuard(receiver: ts.Expression, index: ts.Expression): ts.Expression {
  const f = ts.factory;
  const integral = f.createBinaryExpression(f.createBinaryExpression(index, ts.SyntaxKind.PercentToken, f.createNumericLiteral(1)), ts.SyntaxKind.EqualsEqualsEqualsToken, f.createNumericLiteral(0));
  const bounds = f.createBinaryExpression(f.createBinaryExpression(index, ts.SyntaxKind.GreaterThanEqualsToken, f.createNumericLiteral(0)), ts.SyntaxKind.AmpersandAmpersandToken,
    f.createBinaryExpression(index, ts.SyntaxKind.LessThanToken, f.createPropertyAccessExpression(receiver, "length")));
  return f.createBinaryExpression(bounds, ts.SyntaxKind.AmpersandAmpersandToken, integral);
}

/** Narrow only a key already validated by indexGuard to the caller's native index alias. */
export function indexCast(index: ts.Expression, alias: string): ts.Expression {
  return ts.factory.createParenthesizedExpression(ts.factory.createAsExpression(index, ts.factory.createTypeReferenceNode(alias)));
}

/** Apply ToIntegerOrInfinity to a Number index before bounds testing; NaN selects zero. */
export function integerIndex(index: ts.Expression): ts.Expression {
  const f = ts.factory;
  return f.createConditionalExpression(f.createBinaryExpression(index, ts.SyntaxKind.ExclamationEqualsEqualsToken, index), f.createToken(ts.SyntaxKind.QuestionToken), f.createNumericLiteral(0), f.createToken(ts.SyntaxKind.ColonToken),
    f.createBinaryExpression(index, ts.SyntaxKind.MinusToken, f.createBinaryExpression(index, ts.SyntaxKind.PercentToken, f.createNumericLiteral(1))));
}

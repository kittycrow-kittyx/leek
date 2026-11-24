import ts from "typescript";
import { lowerSourceFile } from "../../baguette/bake/src/lower.ts";
import { createBakeCoreEngine } from "../../baguette/bake/src/core-engine.ts";

/** Give Bake a repeatable nullable reference while retaining evaluation at the original expression. */
export function bakeNullable(source: ts.SourceFile, checker: ts.TypeChecker, cache: ts.Identifier, type: ts.Type, fallback: ts.Expression): ts.Expression {
  const factory = ts.factory;
  const slot = factory.createIdentifier("__leekFallback");
  const input = factory.updateSourceFile(source, [factory.createExpressionStatement(
    factory.createBinaryExpression(cache, ts.SyntaxKind.QuestionQuestionToken, slot))]);
  const extended: ts.TypeChecker = { ...checker, getTypeAtLocation: node => node === cache ? type : checker.getTypeAtLocation(node) };
  const output = lowerSourceFile(".", input, extended, createBakeCoreEngine("host"));
  const statement = output.sourceFile.statements[0] ?? null;
  if (!statement || !ts.isExpressionStatement(statement) || output.diagnostics.length || !ts.isConditionalExpression(statement.expression)) {
    throw new Error("Leek WASM: Bake could not lower the captured nullable expression");
  }
  return factory.updateConditionalExpression(statement.expression, statement.expression.condition, statement.expression.questionToken,
    statement.expression.whenTrue, statement.expression.colonToken, fallback);
}

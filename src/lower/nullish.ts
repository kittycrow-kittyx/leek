import ts from "typescript";
import { nativeVariable } from "../../baguette/src/ast.ts";
import { lowerSourceFile } from "../../baguette/bake/src/lower.ts";
import { createBakeCoreEngine } from "../../baguette/bake/src/core-engine.ts";
import { unwrap } from "./integers.ts";

function suspended(node: ts.Node): boolean {
  if (ts.isFunctionLike(node)) return false;
  if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) return true;
  return ts.forEachChild(node, suspended) ?? false;
}

function bodyOf(node: ts.Node): ts.ConciseBody | null {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ? node.body ?? null : null;
}

/** Give Bake a repeatable nullable reference while retaining evaluation at the original expression. */
function bakeNullable(source: ts.SourceFile, checker: ts.TypeChecker, cache: ts.Identifier, type: ts.Type, fallback: ts.Expression): ts.Expression {
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

/** Extend Bake only for effectful, explicitly nullable operands. Undefined retains its distinct semantics. */
export function lowerNullable(source: ts.SourceFile, checker: ts.TypeChecker): string {
  const names = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(source);
  let serial = 0;
  let changed = false;
  const scopes: ts.VariableDeclaration[][] = [];
  const result = ts.transform(source, [context => root => {
    const factory = context.factory;
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      const body = bodyOf(node);
      if (body) {
        const declarations: ts.VariableDeclaration[] = [];
        scopes.push(declarations);
        const visited = ts.visitNode(body, visit, ts.isConciseBody) ?? body;
        scopes.pop();
        const block = !declarations.length ? visited : factory.createBlock([
          factory.createVariableStatement([], factory.createVariableDeclarationList(declarations, ts.NodeFlags.Let)),
          ...(ts.isBlock(visited) ? visited.statements : [factory.createReturnStatement(visited)])
        ], true);
        return ts.visitEachChild(node, child => child === body ? block : child, context);
      }
      if (ts.isBlock(node) && scopes.length) {
        const declarations: ts.VariableDeclaration[] = [];
        scopes.push(declarations);
        const block = ts.visitEachChild(node, visit, context);
        scopes.pop();
        return declarations.length ? factory.updateBlock(block, [
          factory.createVariableStatement([], factory.createVariableDeclarationList(declarations, ts.NodeFlags.Let)), ...block.statements
        ]) : block;
      }
      const scope = scopes[scopes.length - 1] ?? null;
      if (!scope || !ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken || suspended(node)) {
        return ts.visitEachChild(node, visit, context);
      }
      const operand = unwrap(node.left);
      const type = checker.getTypeAtLocation(node.left);
      const parts = type.isUnion() ? type.types : [type];
      const nullable = parts.some(part => Boolean(part.flags & ts.TypeFlags.Null));
      const reference = parts.every(part => Boolean(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.StringLike | ts.TypeFlags.Object)));
      const annotation = checker.typeToTypeNode(type, node, ts.NodeBuilderFlags.NoTruncation) ?? null;
      const resultType = checker.typeToTypeNode(checker.getTypeAtLocation(node), node, ts.NodeBuilderFlags.NoTruncation) ?? null;
      if (ts.isIdentifier(operand) || ts.isLiteralExpression(operand) || !nullable || !reference || !annotation || !resultType) {
        return ts.visitEachChild(node, visit, context);
      }
      let name: string;
      do { name = "__leekNullable" + serial++; } while (names.has(name));
      names.add(name);
      const cache = factory.createIdentifier(name);
      scope.push(nativeVariable(cache, annotation, null));
      changed = true;
      const left = ts.visitNode(node.left, visit, ts.isExpression) ?? node.left;
      const right = ts.visitNode(node.right, visit, ts.isExpression) ?? node.right;
      const expression = factory.createParenthesizedExpression(factory.createCommaListExpression([
        factory.createAssignment(cache, left), bakeNullable(source, checker, cache, type, right)
      ]));
      return factory.createAsExpression(expression, resultType);
    };
    return ts.visitNode(root, visit, ts.isSourceFile) ?? root;
  }]);
  try { return changed ? ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0] ?? source) : source.text; }
  finally { result.dispose(); }
}

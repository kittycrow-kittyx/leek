import ts from "typescript";
import { nativeVariable } from "../../baguette/src/ast.ts";
import { lowerSourceFile } from "../../baguette/bake/src/lower.ts";
import { createBakeCoreEngine } from "../../baguette/bake/src/core-engine.ts";
import { arrayType, signed, unsigned } from "./integers.ts";

type Visit = ts.Visitor<ts.Node, ts.Node>;
interface ArrayLoop {
  source: ts.SourceFile;
  loop: ts.ForOfStatement;
  name: string;
  checker: ts.TypeChecker;
  visit: Visit;
  nativeItem: boolean;
  labels: readonly ts.Identifier[];
}

/** Supply Bake's missing typed-array fact; its pinned implementation owns the loop transformation. */
function bakeLoop(source: ts.SourceFile, loop: ts.ForOfStatement, checker: ts.TypeChecker): ts.Block {
  const empty: ts.ForOfStatement = { ...loop, statement: ts.factory.createBlock([]) };
  const input = ts.factory.updateSourceFile(source, [empty]);
  const extended: ts.TypeChecker = { ...checker, isArrayType: type => checker.isArrayType(type) || arrayType(type) !== null };
  const output = lowerSourceFile(".", input, extended, createBakeCoreEngine("host"));
  const block = output.sourceFile.statements[0] ?? null;
  if (!block || !ts.isBlock(block) || output.diagnostics.length) throw new Error("Leek WASM: Bake could not lower this typed-array loop");
  return block;
}

/** Add the native storage annotations absent from Bake's TypeScript loop output. */
export function lowerArrayLoop(input: ArrayLoop): ts.Block {
  const { source, loop, name, checker, visit, nativeItem, labels } = input;
  const block = bakeLoop(source, loop, checker);
  const capture = block.statements[0] ?? null;
  const iteration = block.statements[1] ?? null;
  const initializer = iteration && ts.isForStatement(iteration) ? iteration.initializer ?? null : null;
  if (!capture || !ts.isVariableStatement(capture) || !iteration || !ts.isForStatement(iteration) ||
      !initializer || !ts.isVariableDeclarationList(initializer) || !ts.isBlock(iteration.statement)) {
    throw new Error("Leek WASM: unsupported Bake indexed-loop contract");
  }
  const array = capture.declarationList.declarations[0] ?? null;
  const index = initializer.declarations[0] ?? null;
  const first = iteration.statement.statements[0] ?? null;
  const item = first && ts.isVariableStatement(first) ? first.declarationList.declarations[0] ?? null : null;
  const value = item ? item.initializer ?? null : null;
  const condition = iteration.condition ?? null;
  const increment = iteration.incrementor ?? null;
  if (!array || !index || !first || !ts.isVariableStatement(first) || !item || !value || !condition || !increment) throw new Error("Leek WASM: missing Bake loop bindings");
  const factory = ts.factory;
  const itemType = nativeItem ? factory.createTypeReferenceNode(unsigned) : factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
  const declaration = factory.updateVariableStatement(capture, capture.modifiers ?? [], factory.updateVariableDeclarationList(capture.declarationList, [
    nativeVariable(array.name, factory.createTypeReferenceNode(name), ts.visitNode(loop.expression, visit, ts.isExpression) ?? loop.expression)
  ]));
  const binding = factory.updateVariableStatement(first, first.modifiers ?? [], factory.updateVariableDeclarationList(first.declarationList, [
    nativeVariable(item.name, itemType, factory.createAsExpression(factory.createCallExpression(factory.createIdentifier("unchecked"), [], [value]), itemType))
  ]));
  let statement: ts.Statement = factory.updateForStatement(iteration, factory.updateVariableDeclarationList(initializer, [
    nativeVariable(index.name, factory.createTypeReferenceNode(signed), factory.createNumericLiteral(0))
  ]), condition, increment, factory.createBlock([binding, ts.visitNode(loop.statement, visit, ts.isStatement) ?? loop.statement], true));
  for (const label of [...labels].reverse()) statement = factory.createLabeledStatement(label, statement);
  return factory.updateBlock(block, [declaration, statement]);
}

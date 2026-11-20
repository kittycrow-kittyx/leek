import ts from "typescript";
import { nativeVariable } from "../../baguette/src/ast.ts";
import { identifiers } from "./names.ts";
import { localCatch } from "./exception-facts.ts";

/** Only a rewritten throw can reach the following catch when every ordinary path already exits. */
function abruptCompletion(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement) || ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) return true;
  const alternate = ts.isIfStatement(statement) ? statement.elseStatement ?? null : null;
  if (ts.isIfStatement(statement)) return abruptCompletion(statement.thenStatement) && alternate !== null && abruptCompletion(alternate);
  return ts.isBlock(statement) && statement.statements.some(abruptCompletion);
}

/** Convert closed local Error throws into ordinary loop exits and a separately guarded catch binding. */
export function lowerLocalExceptions(source: ts.SourceFile, checker: ts.TypeChecker): string {
  const names = identifiers(source);
  let serial = 0, changed = false;
  const fresh = (suffix: string): ts.Identifier => {
    let name: string;
    do { name = "__leekCatch" + suffix + serial++; } while (names.has(name));
    names.add(name);
    return ts.factory.createIdentifier(name);
  };
  const result = ts.transform(source, [context => root => {
    const f = ts.factory;
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      const clause = ts.isTryStatement(node) ? localCatch(node, checker) : null;
      if (!clause || !ts.isTryStatement(node)) return ts.visitEachChild(node, visit, context);
      const value = fresh("Value"), present = fresh("Present");
      const abrupt = abruptCompletion(node.tryBlock);
      const flows = new Map<"break" | "continue", ts.Identifier>();
      let depth = 0;
      const throwing: ts.Visitor<ts.Node, ts.Node> = child => {
        if (ts.isForStatement(child) || ts.isWhileStatement(child) || ts.isDoStatement(child)) {
          depth++;
          const body = ts.visitEachChild(child, throwing, context);
          depth--;
          return f.createBlock([body, f.createIfStatement(present, f.createBreakStatement())], true);
        }
        if (!depth && (ts.isBreakStatement(child) || ts.isContinueStatement(child))) {
          const kind = ts.isBreakStatement(child) ? "break" : "continue";
          const flag = flows.get(kind) ?? fresh(kind);
          flows.set(kind, flag);
          return f.createBlock([f.createExpressionStatement(f.createAssignment(flag, f.createTrue())), f.createBreakStatement()], true);
        }
        if (ts.isThrowStatement(child)) return f.createBlock([
          f.createExpressionStatement(f.createAssignment(value, child.expression)),
          f.createExpressionStatement(f.createAssignment(present, f.createTrue())),
          f.createBreakStatement()
        ], true);
        return ts.visitEachChild(child, throwing, context);
      };
      const body = ts.visitNode(node.tryBlock, throwing, ts.isBlock) ?? node.tryBlock;
      const binding = clause.variableDeclaration ?? null;
      const caught = binding ? [f.createVariableStatement([], f.createVariableDeclarationList([
        nativeVariable(binding.name, f.createTypeReferenceNode("Error"), f.createNonNullExpression(value))
      ], ts.NodeFlags.Let))] : [];
      const handler = f.createBlock([...caught, ...(ts.visitNode(clause.block, visit, ts.isBlock) ?? clause.block).statements], true);
      changed = true;
      // The slot is read only after a throw assigned it and set the presence flag.
      return f.createBlock([
        f.createVariableStatement([], f.createVariableDeclarationList([
          nativeVariable(value, f.createUnionTypeNode([f.createTypeReferenceNode("Error"), f.createLiteralTypeNode(f.createNull())]), f.createNull()),
          nativeVariable(present, f.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword), f.createFalse()),
          ...[...flows.values()].map(flag => nativeVariable(flag, f.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword), f.createFalse()))
        ], ts.NodeFlags.Let)),
        f.createDoStatement(body, f.createFalse()),
        ...[...flows].map(([kind, flag]) => f.createIfStatement(flag, kind === "break" ? f.createBreakStatement() : f.createContinueStatement())),
        abrupt ? handler : f.createIfStatement(present, handler)
      ], true);
    };
    return ts.visitNode(root, visit, ts.isSourceFile) ?? root;
  }]);
  try { return changed ? ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0] ?? source) : source.text; }
  finally { result.dispose(); }
}

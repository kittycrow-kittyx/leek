import ts from "typescript";

/** Return executable function bodies without treating function type signatures as scopes. */
export function functionBody(node: ts.Node): ts.ConciseBody | null {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ? node.body ?? null : null;
}

/** Return the nearest enclosing function-like node, or null for file-level bindings. */
export function functionOwner(node: ts.Node): ts.Node | null {
  for (let current = node.parent; current; current = current.parent) if (ts.isFunctionLike(current)) return current;
  return null;
}

/** Prove an ordinary path exits before any later statement; loops without a following exit remain conservative. */
export function abruptCompletion(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement) || ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) return true;
  const alternate = ts.isIfStatement(statement) ? statement.elseStatement ?? null : null;
  if (ts.isIfStatement(statement)) return abruptCompletion(statement.thenStatement) && alternate !== null && abruptCompletion(alternate);
  return ts.isBlock(statement) && statement.statements.some(abruptCompletion);
}

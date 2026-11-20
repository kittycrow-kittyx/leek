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

import ts from "typescript";
import { librarySymbol, unwrap } from "./integers.ts";
import { parameterWritten, valueSymbol } from "./captures.ts";

/** Identify the standard one-argument String conversion before replacing it with the proved Error's native method. */
export function errorString(node: ts.Node, checker: ts.TypeChecker): ts.Expression | null {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1 || !ts.isIdentifier(node.expression) || node.expression.text !== "String" ||
    !librarySymbol(checker.getSymbolAtLocation(node.expression) ?? null)) return null;
  return node.arguments[0] ?? null;
}

/** A proven Error needs no fallback normalisation; retain only a direct alias or the true arm of its standard instance test. */
function aliasValue(initializer: ts.Expression, known: ReadonlySet<ts.Symbol>, checker: ts.TypeChecker): ts.Expression | null {
  const value = unwrap(initializer);
  const direct = ts.isIdentifier(value) ? valueSymbol(value, checker) : null;
  if (direct && known.has(direct)) return value;
  if (!ts.isConditionalExpression(value)) return null;
  const condition = unwrap(value.condition), present = unwrap(value.whenTrue);
  if (!ts.isBinaryExpression(condition) || condition.operatorToken.kind !== ts.SyntaxKind.InstanceOfKeyword || !ts.isIdentifier(present)) return null;
  const input = unwrap(condition.left), constructor = unwrap(condition.right);
  const symbol = ts.isIdentifier(input) ? valueSymbol(input, checker) : null;
  return symbol && known.has(symbol) && valueSymbol(present, checker) === symbol && ts.isIdentifier(constructor) && constructor.text === "Error" &&
    librarySymbol(checker.getSymbolAtLocation(constructor) ?? null) ? present : null;
}

/** Exclude Error metadata, primitive narrowing and object escapes; native message, name and string conversion retain their contracts. */
function caughtRead(node: ts.Identifier, checker: ts.TypeChecker): boolean {
  let value: ts.Expression = node;
  while (ts.isParenthesizedExpression(value.parent) || ts.isNonNullExpression(value.parent) || ts.isAsExpression(value.parent) || ts.isTypeAssertionExpression(value.parent)) value = value.parent;
  const parent = value.parent;
  if (ts.isTypeOfExpression(parent)) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === value) {
    return ["message", "name"].includes(parent.name.text) || parent.name.text === "toString" && ts.isCallExpression(parent.parent) && parent.parent.expression === parent && parent.parent.arguments.length === 0;
  }
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && parent.left === value) {
    const constructor = unwrap(parent.right);
    return ts.isIdentifier(constructor) && ["Error", "RangeError", "TypeError", "SyntaxError", "URIError"].includes(constructor.text) && librarySymbol(checker.getSymbolAtLocation(constructor) ?? null);
  }
  return errorString(parent, checker) === value;
}

/** Track only read-only aliases in the catch's own block; var bindings and outer assignments could export the object. */
function aliasesOf(clause: ts.CatchClause, known: Set<ts.Symbol>, checker: ts.TypeChecker): Map<ts.VariableDeclaration, ts.Expression> {
  const aliases = new Map<ts.VariableDeclaration, ts.Expression>();
  for (const statement of clause.block.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.BlockScoped)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initial = declaration.initializer ?? null;
      const symbol = ts.isIdentifier(declaration.name) ? checker.getSymbolAtLocation(declaration.name) ?? null : null;
      const value = initial ? aliasValue(initial, known, checker) : null;
      if (!symbol || !value || parameterWritten(clause.block, symbol, checker)) continue;
      known.add(symbol);
      aliases.set(declaration, value);
    }
  }
  return aliases;
}

/** Return the aliases that can be folded only after the caller proves that this catch receives standard Errors exclusively. */
export function catchBindings(clause: ts.CatchClause, checker: ts.TypeChecker): Map<ts.VariableDeclaration, ts.Expression> | null {
  const variable = clause.variableDeclaration ?? null;
  if (!variable) return new Map<ts.VariableDeclaration, ts.Expression>();
  if (!ts.isIdentifier(variable.name)) return null;
  const symbol = checker.getSymbolAtLocation(variable.name) ?? null;
  if (!symbol || parameterWritten(clause.block, symbol, checker)) return null;
  const known = new Set([symbol]);
  const aliases = aliasesOf(clause, known, checker);
  let valid = true;
  const scan = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && aliases.has(node)) return;
    if (ts.isIdentifier(node) && ["eval", "Function"].includes(node.text)) valid = false;
    const declaration = ts.isVariableDeclaration(node) || ts.isBindingElement(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ? node.name ?? null : null;
    if (declaration && ts.isIdentifier(declaration) && declaration.text === variable.name.getText()) valid = false;
    const reference = ts.isIdentifier(node) ? valueSymbol(node, checker) : null;
    const type = reference && known.has(reference) ? checker.getTypeAtLocation(node) : null;
    const primitive = ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.StringLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.ESSymbolLike;
    if (type && (Boolean(type.flags & primitive) || ts.isIdentifier(node) && !caughtRead(node, checker))) valid = false;
    ts.forEachChild(node, scan);
  };
  scan(clause.block);
  return valid ? aliases : null;
}

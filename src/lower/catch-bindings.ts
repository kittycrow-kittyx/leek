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

/** Track read-only Error aliases after the caller proves the incoming throw domain. */
export function catchAliases(clause: ts.CatchClause, checker: ts.TypeChecker): Map<ts.VariableDeclaration, ts.Expression> {
  const variable = clause.variableDeclaration ?? null;
  const symbol = variable && ts.isIdentifier(variable.name) ? valueSymbol(variable.name, checker) : null;
  return symbol ? aliasesOf(clause, new Set([symbol]), checker) : new Map<ts.VariableDeclaration, ts.Expression>();
}

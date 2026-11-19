import ts from "typescript";

const checks = new Map([
  ["isNaN", "value !== value"],
  ["isFinite", "value >= -1.7976931348623157e308 && value <= 1.7976931348623157e308"],
  ["isInteger", "value % 1 === 0"],
  ["isSafeInteger", "value >= -9007199254740991 && value <= 9007199254740991 && value % 1 === 0"]
]);

function standardNumber(node: ts.Identifier, checker: ts.TypeChecker): boolean {
  if (node.text !== "Number") return false;
  const symbol = checker.getSymbolAtLocation(node) ?? null;
  if (!symbol) return false;
  const declarations = symbol.declarations ?? [];
  return declarations.length > 0 && declarations.every(decl =>
    decl.getSourceFile().isDeclarationFile &&
    /(?:^|[\\/])lib\.[^\\/]+\.d\.ts$/.test(decl.getSourceFile().fileName)
  );
}

/** Identify a standard Number predicate on an already typed numeric operand. */
export function numericCall(node: ts.Node, checker: ts.TypeChecker): string | null {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1 || Boolean(node.questionDotToken ?? null) ||
      !ts.isPropertyAccessExpression(node.expression) || Boolean(node.expression.questionDotToken ?? null) ||
      !ts.isIdentifier(node.expression.expression) ||
      !standardNumber(node.expression.expression, checker)) return null;
  const arg = node.arguments[0] ?? null;
  if (!arg || ts.isSpreadElement(arg)) return null;
  if (!(checker.getTypeAtLocation(arg).flags & ts.TypeFlags.NumberLike)) return null;
  const name = node.expression.name.text;
  return checks.has(name) ? name : null;
}

export function lowerNumeric(source: ts.SourceFile, checker: ts.TypeChecker): string {
  const used = new Map<string, string>();
  const identifiers = new Set<string>();
  const names = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, names);
  };
  names(source);
  const nameFor = (key: string): string => {
    const existing = used.get(key) ?? null;
    if (existing) return existing;
    let next = "__leek_" + key;
    while (identifiers.has(next)) next += "_";
    identifiers.add(next);
    used.set(key, next);
    return next;
  };
  const result = ts.transform(source, [context => root => {
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      const name = numericCall(node, checker);
      if (name && ts.isCallExpression(node)) {
        return context.factory.createCallExpression(
          context.factory.createIdentifier(nameFor(name)), [],
          node.arguments.map(arg => ts.visitNode(arg, visit, ts.isExpression) ?? arg)
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit, ts.isSourceFile) ?? root;
  }]);
  try {
    if (!used.size) return source.text;
    const body = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0] ?? source);
    const helpers = [...used].map(([key, name]) => {
      const expression = checks.get(key) ?? null;
      if (expression === null) throw new Error("Missing numeric predicate: " + key);
      return "function " + name + "(value: number): boolean { return " + expression + "; }";
    });
    return body + "\n" + helpers.join("\n") + "\n";
  } finally {
    result.dispose();
  }
}

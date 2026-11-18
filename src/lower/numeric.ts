import ts from "typescript";

const checks = new Map([
  ["isNaN", "value !== value"],
  ["isFinite", "value >= -1.7976931348623157e308 && value <= 1.7976931348623157e308"],
  ["isInteger", "value % 1 === 0"],
  ["isSafeInteger", "value >= -9007199254740991 && value <= 9007199254740991 && value % 1 === 0"]
]);

function standardNumber(node: ts.Identifier, checker: ts.TypeChecker): boolean {
  if (node.text !== "Number") return false;
  const declarations = checker.getSymbolAtLocation(node)?.declarations;
  return Boolean(declarations?.length && declarations.every(decl =>
    decl.getSourceFile().isDeclarationFile &&
    /(?:^|[\\/])lib\.[^\\/]+\.d\.ts$/.test(decl.getSourceFile().fileName)
  ));
}

function numericCall(node: ts.Node, checker: ts.TypeChecker): string | undefined {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1 || node.questionDotToken ||
      !ts.isPropertyAccessExpression(node.expression) || node.expression.questionDotToken ||
      !ts.isIdentifier(node.expression.expression) ||
      !standardNumber(node.expression.expression, checker)) return undefined;
  const arg = node.arguments[0];
  if (!arg || ts.isSpreadElement(arg)) return undefined;
  if (!(checker.getTypeAtLocation(arg).flags & ts.TypeFlags.NumberLike)) return undefined;
  const name = node.expression.name.text;
  return checks.has(name) ? name : undefined;
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
    const existing = used.get(key);
    if (existing) return existing;
    let next = "__leek_" + key;
    while (identifiers.has(next)) next += "_";
    identifiers.add(next);
    used.set(key, next);
    return next;
  };
  const result = ts.transform(source, [context => root => {
    const visit: ts.Visitor = node => {
      const name = numericCall(node, checker);
      if (name && ts.isCallExpression(node)) {
        return context.factory.createCallExpression(
          context.factory.createIdentifier(nameFor(name)), undefined,
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
    const helpers = [...used].map(([key, name]) =>
      "function " + name + "(value: number): boolean { return " + checks.get(key) + "; }"
    );
    return body + "\n" + helpers.join("\n") + "\n";
  } finally {
    result.dispose();
  }
}

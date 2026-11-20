import ts from "typescript";

const absent = new Set(["process", "navigator"]);
type Constant = string | number | boolean | null;

function owner(node: ts.Node): ts.Node {
  for (let current = node.parent; current; current = current.parent) if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return current;
  return node.getSourceFile();
}

function literal(node: ts.Expression): { value: Constant } | null {
  if (node.kind === ts.SyntaxKind.NullKeyword) return { value: null };
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false };
  if (ts.isStringLiteral(node)) return { value: node.text };
  if (ts.isNumericLiteral(node)) return { value: Number(node.text) };
  return ts.isParenthesizedExpression(node) ? literal(node.expression) : null;
}

function constant(value: Constant): ts.Expression {
  if (value === null) return ts.factory.createNull();
  if (typeof value === "boolean") return value ? ts.factory.createTrue() : ts.factory.createFalse();
  return typeof value === "number" ? ts.factory.createNumericLiteral(value) : ts.factory.createStringLiteral(value);
}

/** Keep declarations observed before an early exit, including through closures and hoisted functions. */
function tailReferenced(block: ts.Block, index: number, checker: ts.TypeChecker): boolean {
  const symbols = new Set<ts.Symbol>();
  const collect = (node: ts.Node): void => {
    const name = ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node) ? node.name ?? null : null;
    const binding = (item: ts.Node): void => { const symbol = ts.isIdentifier(item) ? checker.getSymbolAtLocation(item) ?? null : null; if (symbol) symbols.add(symbol); ts.forEachChild(item, binding); };
    if (name) binding(name);
    ts.forEachChild(node, collect);
  };
  for (const statement of block.statements.slice(index)) collect(statement);
  let used = false;
  const read = (node: ts.Node): void => {
    const symbol = ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) ?? null : null;
    if (symbol && symbols.has(symbol)) used = true;
    ts.forEachChild(node, read);
  };
  for (const statement of block.statements.slice(0, index)) read(statement);
  return used;
}

function nativeProbe(node: ts.Node, checker: ts.TypeChecker): boolean {
  if (!ts.isTypeOfExpression(node) || !ts.isIdentifier(node.expression) || !absent.has(node.expression.text)) return false;
  const symbol = checker.getSymbolAtLocation(node.expression) ?? null;
  const declarations = symbol ? symbol.declarations ?? [] : [];
  return declarations.length > 0 && declarations.every(declaration => declaration.getSourceFile().isDeclarationFile);
}

interface Binding { value: Constant; scope: ts.Node }
type Bindings = Map<ts.Symbol, Binding>;
function remember(node: ts.VariableDeclaration, initializer: ts.Expression | null, checker: ts.TypeChecker, values: Bindings): void {
  const value = initializer ? literal(initializer) : null;
  const symbol = checker.getSymbolAtLocation(node.name) ?? null;
  const immutable = ts.isVariableDeclarationList(node.parent) && Boolean(node.parent.flags & ts.NodeFlags.Const);
  if (value && symbol && immutable) values.set(symbol, { ...value, scope: owner(node) });
}

function binary(node: ts.BinaryExpression, expression: (node: ts.Expression) => ts.Expression, mark: (node: ts.Expression) => ts.Expression): ts.Expression {
  const f = ts.factory;
  const left = expression(node.left), a = literal(left), operator = node.operatorToken.kind;
  if (a && operator === ts.SyntaxKind.AmpersandAmpersandToken) return mark(a.value ? expression(node.right) : left);
  if (a && operator === ts.SyntaxKind.BarBarToken) return mark(a.value ? left : expression(node.right));
  const right = expression(node.right), b = literal(right);
  if (a && b && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(operator)) return mark(constant(operator === ts.SyntaxKind.EqualsEqualsEqualsToken ? a.value === b.value : a.value !== b.value));
  return f.updateBinaryExpression(node, left, node.operatorToken, right);
}

function blockBody(node: ts.Block, visit: ts.Visitor<ts.Node, ts.Node>, checker: ts.TypeChecker, changed: () => void): ts.Block {
  const statements: ts.Statement[] = [];
  for (const statement of node.statements) {
    const output = ts.visitNode(statement, visit, ts.isStatement) ?? statement;
    statements.push(output);
    const tail = node.statements.slice(statements.length);
    if ((ts.isReturnStatement(output) || ts.isThrowStatement(output)) && tail.length && !tailReferenced(node, statements.length, checker)) { changed(); break; }
  }
  return ts.factory.updateBlock(node, statements);
}

/** Removing a branch must not remove function-scoped var declarations from that branch. */
function hoistsVar(node: ts.Node): boolean {
  if (ts.isFunctionLike(node)) return false;
  return ts.isVariableDeclarationList(node) && !(node.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) || (ts.forEachChild(node, hoistsVar) ?? false);
}

/** Resolve only probes for absent native globals; user implementations retain their bindings. */
export function lowerPlatform(source: ts.SourceFile, checker: ts.TypeChecker): string {
  const values: Bindings = new Map<ts.Symbol, Binding>();
  let changed = false;
  const result = ts.transform(source, [context => root => {
    const f = ts.factory;
    const expression = (node: ts.Expression): ts.Expression => ts.visitNode(node, visit, ts.isExpression) ?? node;
    const mark = (node: ts.Expression): ts.Expression => { changed = true; return node; };
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      if (nativeProbe(node, checker)) return mark(f.createStringLiteral("undefined"));
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const input = node.initializer ?? null;
        const initializer = input ? expression(input) : null;
        remember(node, initializer, checker, values);
        return initializer ? { ...node, initializer } : node;
      }
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node) ?? null;
        const value = symbol ? values.get(symbol) ?? null : null;
        const parent = node.parent;
        const name = ts.isPropertyAccessExpression(parent) && parent.name === node || ts.isPropertyAssignment(parent) && parent.name === node || ts.isShorthandPropertyAssignment(parent) || ts.isTypeNode(parent);
        return value && !name && value.scope === owner(node) ? mark(constant(value.value)) : node;
      }
      if (ts.isConditionalExpression(node)) {
        const test = expression(node.condition);
        const value = literal(test);
        return value ? mark(expression(value.value ? node.whenTrue : node.whenFalse)) : f.updateConditionalExpression(node, test, node.questionToken, expression(node.whenTrue), node.colonToken, expression(node.whenFalse));
      }
      if (ts.isBinaryExpression(node)) return binary(node, expression, mark);
      if (ts.isIfStatement(node)) {
        const test = expression(node.expression);
        const value = literal(test);
        changed ||= value !== null;
        const branch = value && value.value ? node.thenStatement : node.elseStatement ?? null;
        const discarded = value && value.value ? node.elseStatement ?? null : node.thenStatement;
        const removable = value && !(discarded && hoistsVar(discarded));
        return removable ? branch ? ts.visitNode(branch, visit, ts.isStatement) ?? branch : f.createEmptyStatement() : ts.visitEachChild({ ...node, expression: test }, visit, context);
      }
      if (ts.isBlock(node)) return blockBody(node, visit, checker, () => { changed = true; });
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit, ts.isSourceFile) ?? root;
  }]);
  try { return changed ? ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0] ?? source) : source.text; }
  finally { result.dispose(); }
}

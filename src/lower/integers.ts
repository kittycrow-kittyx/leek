import ts from "typescript";

export const nativeWidths = { LeekNativeI32: "i32", LeekNativeU32: "u32" } as const;
export const signed = "LeekNativeI32";
export const unsigned = "LeekNativeU32";
const arrays = new Set(["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array"]);
const bitwise = new Set([
  ts.SyntaxKind.CaretToken, ts.SyntaxKind.AmpersandToken, ts.SyntaxKind.BarToken,
  ts.SyntaxKind.LessThanLessThanToken, ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken
]);

export function librarySymbol(symbol: ts.Symbol | null): boolean {
  return symbol !== null && (symbol.declarations ?? []).some(declaration =>
    /(?:^|[\\/])lib\.[^\\/]+\.d\.ts$/.test(declaration.getSourceFile().fileName));
}

/** Recognise actual built-in arrays, including symbols with ambient augmentations. */
export function arrayType(type: ts.Type): string | null {
  const symbol = type.getSymbol() ?? null;
  const name = symbol ? symbol.getName() : "";
  return arrays.has(name) && librarySymbol(symbol) ? name : null;
}

export function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) expression = expression.expression;
  return expression;
}

function numberType(type: ts.Type): boolean {
  return type.isUnion() ? type.types.every(numberType) : Boolean(type.flags & ts.TypeFlags.NumberLike);
}

/** JavaScript bitwise operations and the unshadowed standard Math.imul return 32-bit integers. */
export function integerOperation(node: ts.Node, checker: ts.TypeChecker): boolean {
  if (ts.isBinaryExpression(node)) return bitwise.has(node.operatorToken.kind) &&
    numberType(checker.getTypeAtLocation(node.left)) && numberType(checker.getTypeAtLocation(node.right));
  if (!ts.isCallExpression(node) || node.arguments.length !== 2 || (node.questionDotToken ?? null) ||
      !ts.isPropertyAccessExpression(node.expression) || (node.expression.questionDotToken ?? null)) return false;
  const member = node.expression;
  return ts.isIdentifier(member.expression) && member.expression.text === "Math" && member.name.text === "imul" &&
    librarySymbol(checker.getSymbolAtLocation(member.expression) ?? null) &&
    node.arguments.every(argument => !ts.isSpreadElement(argument) && numberType(checker.getTypeAtLocation(argument)));
}

/** A proven integer needs a native cast, rather than a general Number coercion. */
export function integerValue(expression: ts.Expression, checker: ts.TypeChecker, storage: ReadonlySet<ts.Symbol>): boolean {
  const node = unwrap(expression);
  if (integerOperation(node, checker)) return true;
  const symbol = ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) ?? null : null;
  if (symbol && storage.has(symbol)) return true;
  const type = checker.getTypeAtLocation(node);
  return type.isNumberLiteral() && Number.isInteger(type.value) && type.value >= -2147483648 && type.value <= 4294967295;
}

function enclosingFunction(node: ts.Node): ts.Node | null {
  for (let current = node.parent; current; current = current.parent) if (ts.isFunctionLike(current)) return current;
  return null;
}

function parentExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isExpression(current.parent) && unwrap(current.parent) === current) current = current.parent;
  return current;
}

function integerInitialiser(declaration: ts.VariableDeclaration, checker: ts.TypeChecker): boolean {
  const initializer = declaration.initializer ?? null;
  if (initializer) return integerValue(initializer, checker, new Set());
  const list = declaration.parent;
  const loop = list.parent;
  if (!ts.isForOfStatement(loop) || loop.initializer !== list || (loop.awaitModifier ?? null)) return false;
  const name = arrayType(checker.getTypeAtLocation(loop.expression));
  return name !== null && !name.startsWith("Float") && !name.startsWith("Big");
}

function integerUse(reference: ts.Identifier, declaration: ts.VariableDeclaration, checker: ts.TypeChecker): boolean {
  if (reference === declaration.name) return true;
  if (reference.pos < declaration.pos || enclosingFunction(reference) !== enclosingFunction(declaration)) return false;
  const expression = parentExpression(reference);
  const parent = expression.parent;
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.left === expression) {
    return ts.isExpressionStatement(parent.parent) && integerValue(parent.right, checker, new Set());
  }
  return integerOperation(parent, checker);
}

/** Keep modulo-32 storage only when every write and read permits that representation.
 * Captures, ordinary numeric reads, arithmetic updates and wider assignments retain Number storage.
 */
export function integerStorage(source: ts.SourceFile, checker: ts.TypeChecker): ReadonlySet<ts.Symbol> {
  const declarations: ts.VariableDeclaration[] = [];
  const references = new Map<ts.Symbol, ts.Identifier[]>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && enclosingFunction(node) &&
        ts.isVariableDeclarationList(node.parent) && (node.parent.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) &&
        integerInitialiser(node, checker)) declarations.push(node);
    const symbol = ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) ?? null : null;
    if (symbol && ts.isIdentifier(node)) {
      const uses = references.get(symbol) ?? [];
      uses.push(node);
      references.set(symbol, uses);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  const result = new Set<ts.Symbol>();
  for (const declaration of declarations) {
    const symbol = checker.getSymbolAtLocation(declaration.name) ?? null;
    const uses = symbol ? references.get(symbol) ?? [] : [];
    if (symbol && uses.length > 1 && uses.every(reference => integerUse(reference, declaration, checker))) result.add(symbol);
  }
  return result;
}

import ts from "typescript";
import { nativeVariable } from "../../baguette/src/ast.ts";
import { lowerSourceFile } from "../../baguette/bake/src/lower.ts";
import { createBakeCoreEngine } from "../../baguette/bake/src/core-engine.ts";
import { arrayType, librarySymbol, unwrap } from "./integers.ts";
import { identifiers } from "./names.ts";

interface MapLookup {
  receiver: ts.Expression;
  key: ts.Expression;
  receiverType: ts.TypeNode;
  keyType: ts.TypeNode;
}

export interface NullableLowering {
  text: string;
  usesReferenceRead: boolean;
}

export const referenceRead = "export function LeekReferenceAt<T>(values: readonly T[], index: number): T | null { const value: T | undefined = values[index]; return value === undefined ? null : value; }\n";
export const nullableAliases = { LeekArrayIndex: "i32" } as const;

function indexedKind(receiver: ts.Expression, checker: ts.TypeChecker): "string" | "typed" | "reference" | null {
  const type = checker.getTypeAtLocation(receiver);
  if (type.flags & ts.TypeFlags.StringLike) return "string";
  if (arrayType(type)) return "typed";
  if (!checker.isArrayType(type) && !checker.isTupleType(type)) return null;
  const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number) ?? null;
  const reference = (value: ts.Type): boolean => value.isUnion() ? value.types.every(reference) :
    Boolean(value.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.Object | ts.TypeFlags.Null));
  return element && reference(element) ? "reference" : null;
}

function mapLookup(expression: ts.Expression, checker: ts.TypeChecker): MapLookup | null {
  const node = unwrap(expression);
  if (!ts.isCallExpression(node) || node.arguments.length !== 1 || (node.questionDotToken ?? null) || !ts.isPropertyAccessExpression(node.expression) ||
      (node.expression.questionDotToken ?? null) || node.expression.name.text !== "get") return null;
  const receiver = node.expression.expression;
  const type = checker.getTypeAtLocation(receiver);
  const symbol = type.getSymbol() ?? null;
  const setter = type.getProperty("set") ?? null;
  if (!symbol || symbol.getName() !== "Map" || !librarySymbol(symbol) || !setter) return null;
  const signature = checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(setter, receiver), ts.SignatureKind.Call)[0] ?? null;
  const keyParameter = signature ? signature.parameters[0] ?? null : null;
  const valueParameter = signature ? signature.parameters[1] ?? null : null;
  const key = node.arguments[0] ?? null;
  if (!key || ts.isSpreadElement(key) || !keyParameter || !valueParameter) return null;
  const keyType = checker.getTypeOfSymbolAtLocation(keyParameter, receiver);
  const valueType = checker.getTypeOfSymbolAtLocation(valueParameter, receiver);
  const concrete = (item: ts.Type): boolean => item.isUnion() ? item.types.every(concrete) :
    Boolean(item.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.StringLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.Object));
  if (!concrete(keyType) || !concrete(valueType)) return null;
  const receiverNode = checker.typeToTypeNode(type, node, ts.NodeBuilderFlags.NoTruncation) ?? null;
  const keyNode = checker.typeToTypeNode(keyType, node, ts.NodeBuilderFlags.NoTruncation) ?? null;
  return receiverNode && keyNode ? { receiver, key, receiverType: receiverNode, keyType: keyNode } : null;
}

function referenceRemoval(expression: ts.Expression, checker: ts.TypeChecker): ts.PropertyAccessExpression | null {
  const call = unwrap(expression);
  if (!ts.isCallExpression(call) || call.arguments.length || (call.questionDotToken ?? null) || !ts.isPropertyAccessExpression(call.expression)) return null;
  const member = call.expression;
  if ((member.questionDotToken ?? null) || !["pop", "shift"].includes(member.name.text) || indexedKind(member.expression, checker) !== "reference") return null;
  return librarySymbol(checker.getSymbolAtLocation(member.name) ?? null) ? member : null;
}

function relativeAccess(expression: ts.Expression, checker: ts.TypeChecker): ts.CallExpression | null {
  if (!ts.isCallExpression(expression) || expression.arguments.length !== 1 || (expression.questionDotToken ?? null) || !ts.isPropertyAccessExpression(expression.expression)) return null;
  const member = expression.expression;
  return !(member.questionDotToken ?? null) && member.name.text === "at" && librarySymbol(checker.getSymbolAtLocation(member.name) ?? null) ? expression : null;
}

function guaranteedPresent(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  const node = unwrap(expression);
  if (ts.isLiteralExpression(node) || ts.isTemplateExpression(node) || ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node) || ts.isNewExpression(node)) return true;
  if (!ts.isCallExpression(node)) return false;
  const target = node.expression;
  if (ts.isIdentifier(target)) return target.text === "Number" && librarySymbol(checker.getSymbolAtLocation(target) ?? null);
  return ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression) &&
    ["Number", "Math"].includes(target.expression.text) && librarySymbol(checker.getSymbolAtLocation(target.expression) ?? null);
}

function suspended(node: ts.Node): boolean {
  if (ts.isFunctionLike(node)) return false;
  if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) return true;
  return ts.forEachChild(node, suspended) ?? false;
}

function bodyOf(node: ts.Node): ts.ConciseBody | null {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ? node.body ?? null : null;
}

/** Give Bake a repeatable nullable reference while retaining evaluation at the original expression. */
function bakeNullable(source: ts.SourceFile, checker: ts.TypeChecker, cache: ts.Identifier, type: ts.Type, fallback: ts.Expression): ts.Expression {
  const factory = ts.factory;
  const slot = factory.createIdentifier("__leekFallback");
  const input = factory.updateSourceFile(source, [factory.createExpressionStatement(
    factory.createBinaryExpression(cache, ts.SyntaxKind.QuestionQuestionToken, slot))]);
  const extended: ts.TypeChecker = { ...checker, getTypeAtLocation: node => node === cache ? type : checker.getTypeAtLocation(node) };
  const output = lowerSourceFile(".", input, extended, createBakeCoreEngine("host"));
  const statement = output.sourceFile.statements[0] ?? null;
  if (!statement || !ts.isExpressionStatement(statement) || output.diagnostics.length || !ts.isConditionalExpression(statement.expression)) {
    throw new Error("Leek WASM: Bake could not lower the captured nullable expression");
  }
  return factory.updateConditionalExpression(statement.expression, statement.expression.condition, statement.expression.questionToken,
    statement.expression.whenTrue, statement.expression.colonToken, fallback);
}

/** Extend Bake only for effectful, explicitly nullable operands. Undefined retains its distinct semantics. */
export function lowerNullable(source: ts.SourceFile, checker: ts.TypeChecker, intrinsicSpecifier = "./__leek_wasm_intrinsics.js"): NullableLowering {
  const names = identifiers(source);
  let serial = 0;
  let changed = false;
  const used: { readName: ts.Identifier | null; indexName: ts.Identifier | null } = { readName: null, indexName: null };
  const scopes: ts.VariableDeclaration[][] = [];
  const result = ts.transform(source, [context => root => {
    const factory = context.factory;
    const fresh = (): ts.Identifier => {
      let name: string;
      do { name = "__leekNullable" + serial++; } while (names.has(name));
      names.add(name);
      return factory.createIdentifier(name);
    };
    const reserve = (name: string): ts.Identifier => {
      if (names.has(name)) throw new Error("Leek WASM: reserved indexed binding " + name + " in " + source.fileName);
      names.add(name);
      return factory.createIdentifier(name);
    };
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      const body = bodyOf(node);
      if (body) {
        const declarations: ts.VariableDeclaration[] = [];
        scopes.push(declarations);
        const visited = ts.visitNode(body, visit, ts.isConciseBody) ?? body;
        scopes.pop();
        const block = !declarations.length ? visited : factory.createBlock([
          factory.createVariableStatement([], factory.createVariableDeclarationList(declarations, ts.NodeFlags.Let)),
          ...(ts.isBlock(visited) ? visited.statements : [factory.createReturnStatement(visited)])
        ], true);
        return ts.visitEachChild(node, child => child === body ? block : child, context);
      }
      if (ts.isBlock(node) && scopes.length) {
        const declarations: ts.VariableDeclaration[] = [];
        scopes.push(declarations);
        const block = ts.visitEachChild(node, visit, context);
        scopes.pop();
        return declarations.length ? factory.updateBlock(block, [
          factory.createVariableStatement([], factory.createVariableDeclarationList(declarations, ts.NodeFlags.Let)), ...block.statements
        ]) : block;
      }
      const scope = scopes[scopes.length - 1] ?? null;
      if (!scope || !ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken || suspended(node)) {
        return ts.visitEachChild(node, visit, context);
      }
      const lookup = mapLookup(node.left, checker);
      const resultType = checker.typeToTypeNode(checker.getTypeAtLocation(node), node, ts.NodeBuilderFlags.NoTruncation) ?? null;
      const removal = referenceRemoval(node.left, checker);
      const removalType = removal ? checker.typeToTypeNode(checker.getTypeAtLocation(removal.expression), removal, ts.NodeBuilderFlags.NoTruncation) ?? null : null;
      if (removal && removalType && resultType) {
        const receiver = fresh();
        scope.push(nativeVariable(receiver, removalType, null));
        const value = factory.createNonNullExpression(factory.createCallExpression(factory.createPropertyAccessExpression(receiver, removal.name.text), [], []));
        const present = factory.createBinaryExpression(factory.createPropertyAccessExpression(receiver, "length"), ts.SyntaxKind.GreaterThanToken, factory.createNumericLiteral(0));
        const selected = factory.createConditionalExpression(present, factory.createToken(ts.SyntaxKind.QuestionToken), value, factory.createToken(ts.SyntaxKind.ColonToken), factory.createNull());
        changed = true;
        return factory.createSatisfiesExpression(factory.createParenthesizedExpression(factory.createCommaListExpression([
          factory.createAssignment(receiver, ts.visitNode(removal.expression, visit, ts.isExpression) ?? removal.expression),
          factory.createBinaryExpression(factory.createParenthesizedExpression(selected), ts.SyntaxKind.QuestionQuestionToken, ts.visitNode(node.right, visit, ts.isExpression) ?? node.right)
        ])), resultType);
      }
      const indexed = unwrap(node.left);
      const relative = relativeAccess(indexed, checker);
      const member = relative && ts.isPropertyAccessExpression(relative.expression) ? relative.expression : null;
      const receiverExpression = ts.isElementAccessExpression(indexed) && !(indexed.questionDotToken ?? null) ? indexed.expression : member ? member.expression : null;
      const kind = receiverExpression ? indexedKind(receiverExpression, checker) : null;
      const index = ts.isElementAccessExpression(indexed) ? indexed.argumentExpression ?? null : relative ? relative.arguments[0] ?? null : null;
      const numericIndex = index ? checker.getTypeAtLocation(index) : null;
      const typed = receiverExpression ? arrayType(checker.getTypeAtLocation(receiverExpression)) : null;
      const receiverType = typed ? factory.createTypeReferenceNode(typed) : receiverExpression ? checker.typeToTypeNode(checker.getTypeAtLocation(receiverExpression), indexed, ts.NodeBuilderFlags.NoTruncation) ?? null : null;
      const elementType = checker.typeToTypeNode(checker.getNonNullableType(checker.getTypeAtLocation(node.left)), node, ts.NodeBuilderFlags.NoTruncation) ?? null;
      const fallbackValue = checker.getTypeAtLocation(node.right);
      const fallbackType = checker.typeToTypeNode(fallbackValue, node, ts.NodeBuilderFlags.NoTruncation) ?? null;
      const fallbackParts = fallbackValue.isUnion() ? fallbackValue.types : [fallbackValue];
      const nativeNumber = fallbackParts.every(part => Boolean(part.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.Never)));
      if (kind && (kind !== "typed" || nativeNumber) && numericIndex && numericIndex.flags & ts.TypeFlags.NumberLike && receiverType && elementType && fallbackType && receiverExpression && index) {
        const receiver = fresh();
        const at = fresh();
        scope.push(nativeVariable(receiver, receiverType, null), nativeVariable(at, factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword), null));
        const integral = factory.createBinaryExpression(factory.createBinaryExpression(at, ts.SyntaxKind.PercentToken, factory.createNumericLiteral(1)), ts.SyntaxKind.EqualsEqualsEqualsToken, factory.createNumericLiteral(0));
        const bounds = factory.createBinaryExpression(factory.createBinaryExpression(at, ts.SyntaxKind.GreaterThanEqualsToken, factory.createNumericLiteral(0)), ts.SyntaxKind.AmpersandAmpersandToken,
          factory.createBinaryExpression(at, ts.SyntaxKind.LessThanToken, factory.createPropertyAccessExpression(receiver, "length")));
        const valid = factory.createBinaryExpression(bounds, ts.SyntaxKind.AmpersandAmpersandToken, integral);
        used.indexName ??= reserve("LeekArrayIndex");
        const nativeIndex = factory.createParenthesizedExpression(factory.createAsExpression(at, factory.createTypeReferenceNode(used.indexName)));
        used.readName = kind === "reference" ? used.readName ?? reserve("LeekReferenceAt") : used.readName;
        const value = kind === "string" ? factory.createCallExpression(factory.createPropertyAccessExpression(receiver, "charAt"), [], [nativeIndex]) :
          kind === "reference" && used.readName ? factory.createCallExpression(used.readName, [], [receiver, nativeIndex]) : factory.createNonNullExpression(factory.createElementAccessExpression(receiver, nativeIndex));
        const fallback = ts.visitNode(node.right, visit, ts.isExpression) ?? node.right;
        const selection = kind === "reference" ? factory.createBinaryExpression(factory.createConditionalExpression(valid, factory.createToken(ts.SyntaxKind.QuestionToken), value,
          factory.createToken(ts.SyntaxKind.ColonToken), factory.createNull()), ts.SyntaxKind.QuestionQuestionToken, fallback) :
          factory.createConditionalExpression(valid, factory.createToken(ts.SyntaxKind.QuestionToken), value, factory.createToken(ts.SyntaxKind.ColonToken), fallback);
        changed = true;
        const relativeIndex = relative ? [
          factory.createAssignment(at, factory.createConditionalExpression(factory.createBinaryExpression(at, ts.SyntaxKind.ExclamationEqualsEqualsToken, at), factory.createToken(ts.SyntaxKind.QuestionToken), factory.createNumericLiteral(0), factory.createToken(ts.SyntaxKind.ColonToken),
            factory.createBinaryExpression(at, ts.SyntaxKind.MinusToken, factory.createBinaryExpression(at, ts.SyntaxKind.PercentToken, factory.createNumericLiteral(1))))),
          factory.createAssignment(at, factory.createConditionalExpression(factory.createBinaryExpression(at, ts.SyntaxKind.LessThanToken, factory.createNumericLiteral(0)), factory.createToken(ts.SyntaxKind.QuestionToken),
            factory.createBinaryExpression(at, ts.SyntaxKind.PlusToken, factory.createPropertyAccessExpression(receiver, "length")), factory.createToken(ts.SyntaxKind.ColonToken), at))
        ] : [];
        return factory.createSatisfiesExpression(factory.createParenthesizedExpression(factory.createCommaListExpression([
          factory.createAssignment(receiver, ts.visitNode(receiverExpression, visit, ts.isExpression) ?? receiverExpression),
          factory.createAssignment(at, ts.visitNode(index, visit, ts.isExpression) ?? index), ...relativeIndex, selection
        ])), factory.createUnionTypeNode([elementType, fallbackType]));
      }
      if (lookup && resultType) {
        const map = fresh();
        const key = fresh();
        scope.push(nativeVariable(map, lookup.receiverType, null), nativeVariable(key, lookup.keyType, null));
        const receiver = ts.visitNode(lookup.receiver, visit, ts.isExpression) ?? lookup.receiver;
        const argument = ts.visitNode(lookup.key, visit, ts.isExpression) ?? lookup.key;
        const fallback = ts.visitNode(node.right, visit, ts.isExpression) ?? node.right;
        const has = factory.createCallExpression(factory.createPropertyAccessExpression(map, "has"), [], [key]);
        const get = factory.createNonNullExpression(factory.createCallExpression(factory.createPropertyAccessExpression(map, "get"), [], [key]));
        changed = true;
        return factory.createSatisfiesExpression(factory.createParenthesizedExpression(factory.createCommaListExpression([
          factory.createAssignment(map, receiver), factory.createAssignment(key, argument),
          factory.createConditionalExpression(has, factory.createToken(ts.SyntaxKind.QuestionToken), get, factory.createToken(ts.SyntaxKind.ColonToken), fallback)
        ])), resultType);
      }
      const operand = unwrap(node.left);
      const type = checker.getTypeAtLocation(node.left);
      const parts = type.isUnion() ? type.types : [type];
      const present = parts.every(part => Boolean(part.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.StringLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.Object)));
      if (present && guaranteedPresent(node.left, checker)) {
        changed = true;
        return ts.visitNode(node.left, visit, ts.isExpression) ?? node.left;
      }
      if (operand.kind === ts.SyntaxKind.NullKeyword) {
        changed = true;
        return ts.visitNode(node.right, visit, ts.isExpression) ?? node.right;
      }
      const nullable = parts.some(part => Boolean(part.flags & ts.TypeFlags.Null));
      const reference = parts.every(part => Boolean(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.StringLike | ts.TypeFlags.Object)));
      const annotation = checker.typeToTypeNode(type, node, ts.NodeBuilderFlags.NoTruncation) ?? null;
      if (ts.isIdentifier(operand) || ts.isLiteralExpression(operand) || !nullable || !reference || !annotation || !resultType) {
        return ts.visitEachChild(node, visit, context);
      }
      const cache = fresh();
      scope.push(nativeVariable(cache, annotation, null));
      changed = true;
      const left = ts.visitNode(node.left, visit, ts.isExpression) ?? node.left;
      const right = ts.visitNode(node.right, visit, ts.isExpression) ?? node.right;
      const expression = factory.createParenthesizedExpression(factory.createCommaListExpression([
        factory.createAssignment(cache, left), bakeNullable(source, checker, cache, type, right)
      ]));
      return factory.createSatisfiesExpression(expression, resultType);
    };
    return ts.visitNode(root, visit, ts.isSourceFile) ?? root;
  }]);
  try {
    const imports = used.readName ? "import { LeekReferenceAt } from " + JSON.stringify(intrinsicSpecifier) + ";\n" : "";
    const aliases = used.indexName ? "type LeekArrayIndex = number;\n" : "";
    return { text: changed ? imports + aliases + ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0] ?? source) : source.text, usesReferenceRead: used.readName !== null };
  }
  finally { result.dispose(); }
}

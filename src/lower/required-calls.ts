import ts from "typescript";
import { mapLookup } from "./map-lookup.ts";
import { arrayType, unwrap } from "./integers.ts";
import { parameterWritten } from "./captures.ts";

export interface RequiredCall {
  call: ts.CallExpression;
  receiver: ts.Expression;
  index: ts.Expression;
  receiverType: ts.TypeNode;
  indexType: ts.TypeNode;
  array: boolean;
  helper: ts.FunctionDeclaration;
  signature: ts.Signature;
  typeParameter: ts.Symbol;
}

/** Namespace specialisations initialise during module execution; cyclic modules can call hoisted functions earlier. */
function acyclic(source: ts.SourceFile, checker: ts.TypeChecker): boolean {
  const visited = new Set<ts.SourceFile>();
  const reaches = (file: ts.SourceFile): boolean => {
    if (visited.has(file)) return false;
    visited.add(file);
    for (const statement of file.statements) {
      const module = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) ? statement.moduleSpecifier ?? null : null;
      if (!module) continue;
      const symbol = checker.getSymbolAtLocation(module) ?? null;
      const declarations = symbol ? symbol.declarations ?? [] : [];
      const target = declarations.find(ts.isSourceFile) ?? null;
      if (!target || target === source || reaches(target)) return true;
    }
    return false;
  };
  return !reaches(source);
}

export function nullTest(node: ts.Node, symbol: ts.Symbol, checker: ts.TypeChecker): { expression: ts.BinaryExpression; present: boolean } | null {
  if (!ts.isIdentifier(node) || (checker.getSymbolAtLocation(node) ?? null) !== symbol) return null;
  let operand: ts.Expression = node;
  while (ts.isParenthesizedExpression(operand.parent)) operand = operand.parent;
  const test = operand.parent;
  if (!ts.isBinaryExpression(test)) return null;
  const other = unwrap(test.left === operand ? test.right : test.left);
  if (other.kind !== ts.SyntaxKind.NullKeyword) return null;
  if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(test.operatorToken.kind)) return { expression: test, present: false };
  return [ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(test.operatorToken.kind) ? { expression: test, present: true } : null;
}

/** Only a read-only nullable parameter whose ordinary reads are narrowed can use an unboxed presence flag. */
function parameterSafe(helper: ts.FunctionDeclaration, checker: ts.TypeChecker): boolean {
  const first = helper.parameters[0] ?? null;
  const body = helper.body ?? null;
  if (!first || !body || !ts.isIdentifier(first.name)) return false;
  const symbol = checker.getSymbolAtLocation(first.name) ?? null;
  if (!symbol || parameterWritten(body, symbol, checker)) return false;
  let safe = true;
  const visit = (node: ts.Node): void => {
    const signature = ts.isCallExpression(node) ? checker.getResolvedSignature(node) ?? null : null;
    if (signature && (signature.getDeclaration() ?? null) === helper) safe = false;
    if (ts.isIdentifier(node) && node.text === "arguments" || node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword || ts.isAwaitExpression(node) || ts.isYieldExpression(node)) safe = false;
    if (ts.isShorthandPropertyAssignment(node) && (checker.getShorthandAssignmentValueSymbol(node) ?? null) === symbol) safe = false;
    if (!ts.isIdentifier(node) || (checker.getSymbolAtLocation(node) ?? null) !== symbol || nullTest(node, symbol, checker)) { ts.forEachChild(node, visit); return; }
    const type = checker.getTypeAtLocation(node);
    const parts = type.isUnion() ? type.types : [type];
    let value: ts.Expression = node;
    while (ts.isParenthesizedExpression(value.parent)) value = value.parent;
    if (!ts.isReturnStatement(value.parent) || parts.some(part => Boolean(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Any | ts.TypeFlags.Unknown)))) safe = false;
    ts.forEachChild(node, visit);
  };
  visit(body);
  return safe;
}

/** Find concrete primitive calls whose first argument is a nullable typed-array read. */
export function requiredCall(node: ts.Node, checker: ts.TypeChecker): RequiredCall | null {
  if (!ts.isCallExpression(node) || (node.questionDotToken ?? null) || node.arguments.some(ts.isSpreadElement)) return null;
  const argument = node.arguments[0] ?? null;
  const nullable = argument ? unwrap(argument) : null;
  if (!nullable || !ts.isBinaryExpression(nullable) || nullable.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken || unwrap(nullable.right).kind !== ts.SyntaxKind.NullKeyword) return null;
  const read = unwrap(nullable.left);
  const map = mapLookup(read, checker);
  const element = ts.isElementAccessExpression(read) && !(read.questionDotToken ?? null) ? read : null;
  const arrayName = element ? arrayType(checker.getTypeAtLocation(element.expression)) : null;
  const receiver = arrayName && element ? element.expression : map ? map.receiver : null;
  const index = arrayName && element ? element.argumentExpression ?? null : map ? map.key : null;
  const receiverType = arrayName ? ts.factory.createTypeReferenceNode(arrayName) : map ? map.receiverType : null;
  const indexType = arrayName ? ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword) : map ? map.keyType : null;
  const valid = index ? checker.getTypeAtLocation(index).flags & (arrayName ? ts.TypeFlags.NumberLike : ts.TypeFlags.StringLike) : 0;
  if (!receiver || !index || !receiverType || !indexType || !valid || map && (!(map.valueType.flags & ts.TypeFlags.NumberLike) || map.keyType.kind !== ts.SyntaxKind.StringKeyword)) return null;
  const signature = checker.getResolvedSignature(node) ?? null;
  const helper = signature ? signature.getDeclaration() ?? null : null;
  if (!signature || !helper || !ts.isFunctionDeclaration(helper) || !ts.isSourceFile(helper.parent) || !(helper.name ?? null) || !(helper.body ?? null) || (helper.typeParameters ?? []).length !== 1 || helper.parameters.length !== node.arguments.length) return null;
  if ((helper.modifiers ?? []).some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) || (helper.asteriskToken ?? null)) return null;
  if (!ts.isIdentifier(node.expression)) return null;
  const callee = checker.getSymbolAtLocation(node.expression) ?? null;
  const target = callee && callee.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(callee) : callee;
  if (!target || (target.valueDeclaration ?? null) !== helper || parameterWritten(helper.getSourceFile(), target, checker) || !acyclic(helper.getSourceFile(), checker)) return null;
  if (helper.parameters.some(parameter => !ts.isIdentifier(parameter.name) || (parameter.initializer ?? null) || (parameter.questionToken ?? null) || (parameter.dotDotDotToken ?? null))) return null;
  const first = signature.parameters[0] ?? null;
  const input = first ? checker.getTypeOfSymbolAtLocation(first, node) : null;
  if (!input || !input.isUnion() || !input.types.some(type => Boolean(type.flags & ts.TypeFlags.Null))) return null;
  const primitive = checker.getNonNullableType(input);
  if (!(primitive.flags & ts.TypeFlags.NumberLike) || !(signature.getReturnType().flags & ts.TypeFlags.NumberLike)) return null;
  const others = signature.parameters.slice(1).map(parameter => checker.getTypeOfSymbolAtLocation(parameter, node));
  if (others.some(type => !(type.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.StringLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike)))) return null;
  const parameter = (helper.typeParameters ?? [])[0] ?? null;
  const typeParameter = parameter ? checker.getSymbolAtLocation(parameter.name) ?? null : null;
  return typeParameter && parameterSafe(helper, checker) ? { call: node, receiver, index, receiverType, indexType, array: arrayName !== null, helper, signature, typeParameter } : null;
}

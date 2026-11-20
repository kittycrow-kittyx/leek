import ts from "typescript";
import { unwrap } from "./integers.ts";
import { librarySymbol } from "./integers.ts";

export interface CapturedVariable {
  symbol: ts.Symbol;
  name: ts.Identifier;
  declaration: ts.VariableDeclaration | ts.ParameterDeclaration | ts.BindingElement;
  type: ts.TypeNode;
  mutable: boolean;
}

export interface ClosureUnit {
  arrow: ts.ArrowFunction;
  owner: ts.MethodDeclaration;
  klass: ts.ClassDeclaration;
  variable: ts.VariableDeclaration | null;
  symbol: ts.Symbol | null;
  calls: ts.CallExpression[];
  captures: CapturedVariable[];
  returns: ts.TypeNode;
  callback: boolean;
}

function valueSymbol(node: ts.Identifier, checker: ts.TypeChecker): ts.Symbol | null {
  return ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
    ? checker.getShorthandAssignmentValueSymbol(node.parent) ?? null : checker.getSymbolAtLocation(node) ?? null;
}

function methodOwner(node: ts.Node): ts.MethodDeclaration | null {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isMethodDeclaration(current)) return current;
    if (ts.isFunctionLike(current)) return null;
  }
  return null;
}

function promiseCallback(arrow: ts.ArrowFunction, checker: ts.TypeChecker): boolean {
  let expression: ts.Expression = arrow;
  while (ts.isParenthesizedExpression(expression.parent)) expression = expression.parent;
  const call = expression.parent;
  if (!ts.isCallExpression(call) || !call.arguments.includes(expression) || !ts.isPropertyAccessExpression(call.expression)) return false;
  if (!["then", "catch", "finally"].includes(call.expression.name.text)) return false;
  const symbol = checker.getTypeAtLocation(call.expression.expression).getSymbol() ?? null;
  if (!symbol || symbol.getName() !== "Promise" || !librarySymbol(symbol)) return false;
  return arrow.parameters.every(parameter => ts.isIdentifier(parameter.name) && !(parameter.initializer ?? null) && !(parameter.dotDotDotToken ?? null));
}

function variableList(node: ts.Node): ts.VariableDeclarationList | null {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isVariableDeclarationList(current)) return current;
    if (ts.isStatement(current) || ts.isFunctionLike(current)) return null;
  }
  return null;
}

function sameReceiver(node: ts.Node, owner: ts.MethodDeclaration): boolean {
  for (let current = node.parent; current && current !== owner; current = current.parent) {
    if (ts.isClassLike(current) || ts.isFunctionLike(current) && !ts.isArrowFunction(current)) return false;
  }
  return true;
}

function directCalls(source: ts.SourceFile, arrow: ts.ArrowFunction, variable: ts.VariableDeclaration | null, owner: ts.MethodDeclaration, checker: ts.TypeChecker): ts.CallExpression[] | null {
  if (!variable) {
    let expression: ts.Expression = arrow;
    while (ts.isParenthesizedExpression(expression.parent)) expression = expression.parent;
    return ts.isCallExpression(expression.parent) && expression.parent.expression === expression ? [expression.parent] : null;
  }
  const symbol = checker.getSymbolAtLocation(variable.name) ?? null;
  if (!symbol) return null;
  const calls: ts.CallExpression[] = [];
  let eligible = true;
  const record = (node: ts.Identifier): void => {
    if (node === variable.name || valueSymbol(node, checker) !== symbol) return;
    let expression: ts.Expression = node;
    while (ts.isParenthesizedExpression(expression.parent)) expression = expression.parent;
    const parent = expression.parent;
    const inside = node.pos >= arrow.pos && node.end <= arrow.end;
    if (!ts.isCallExpression(parent) || parent.expression !== expression || !sameReceiver(node, owner) || !inside && node.pos < variable.end) { eligible = false; return; }
    calls.push(parent);
  };
  const scan = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) record(node);
    ts.forEachChild(node, scan);
  };
  scan(source);
  return eligible ? calls : null;
}

export function parameterWritten(owner: ts.Node, symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  let written = false;
  const scan = (node: ts.Node): void => {
    const assignment = ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
    const update = (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken);
    const target = assignment && ts.isBinaryExpression(node) ? unwrap(node.left) : update && (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) ? unwrap(node.operand) : null;
    if (target) {
      const contains = (child: ts.Node): void => {
        if (ts.isIdentifier(child) && valueSymbol(child, checker) === symbol) written = true;
        ts.forEachChild(child, contains);
      };
      contains(target);
    }
    ts.forEachChild(node, scan);
  };
  scan(owner);
  return written;
}

function absentCapture(type: ts.Type): boolean {
  const parts = type.isUnion() ? type.types : [type];
  return parts.some(part => Boolean(part.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Undefined | ts.TypeFlags.Void))) ||
    parts.some(part => Boolean(part.flags & ts.TypeFlags.Null)) && parts.some(part => Boolean(part.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.BooleanLike)));
}

function capturesOf(arrow: ts.ArrowFunction, owner: ts.MethodDeclaration, self: ts.Symbol | null, checker: ts.TypeChecker): CapturedVariable[] | null {
  const captures = new Map<ts.Symbol, CapturedVariable>();
  let eligible = true;
  const record = (node: ts.Identifier): void => {
    const symbol = valueSymbol(node, checker);
    const declaration = symbol ? symbol.valueDeclaration ?? null : null;
    if (!symbol || symbol === self || !declaration || captures.has(symbol)) return;
    if (declaration.getSourceFile() !== arrow.getSourceFile() || declaration.pos < owner.pos || declaration.end > owner.end) return;
    if (declaration.pos >= arrow.pos && declaration.end <= arrow.end) return;
    if (!ts.isVariableDeclaration(declaration) && !ts.isParameter(declaration) && !ts.isBindingElement(declaration)) { eligible = false; return; }
    if (!ts.isIdentifier(declaration.name)) { eligible = false; return; }
    const list = variableList(declaration);
    const parameter = ts.isParameter(declaration);
    const mutable = parameter ? parameterWritten(owner, symbol, checker) : Boolean(list && !(list.flags & ts.NodeFlags.Const));
    const binding = list ? list.parent : null;
    const body = owner.body ?? null;
    const dominates = parameter ? declaration.parent === owner : Boolean(binding && ts.isVariableStatement(binding) && binding.parent === body && binding.end < arrow.pos);
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const annotation = checker.typeToTypeNode(type, arrow, ts.NodeBuilderFlags.NoTruncation) ?? null;
    const unsupported = absentCapture(type) || type.getCallSignatures().length > 0;
    const initializer = ts.isVariableDeclaration(declaration) ? declaration.initializer ?? null : null;
    if (!dominates || !annotation || unsupported || mutable && (!ts.isVariableDeclaration(declaration) || !initializer)) { eligible = false; return; }
    captures.set(symbol, { symbol, name: declaration.name, declaration, type: annotation, mutable });
  };
  const scan = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "arguments" || node.kind === ts.SyntaxKind.SuperKeyword) eligible = false;
    if (ts.isIdentifier(node)) record(node);
    ts.forEachChild(node, scan);
  };
  scan(arrow);
  return eligible ? [...captures.values()] : null;
}

function unitFor(node: ts.ArrowFunction, source: ts.SourceFile, checker: ts.TypeChecker): ClosureUnit | null {
  if (!(node.modifiers ?? []).some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) return null;
  const owner = methodOwner(node);
  if (!owner || !ts.isClassDeclaration(owner.parent)) return null;
  const klass = owner.parent;
  const name = klass.name ?? null;
  const staticOwner = (owner.modifiers ?? []).some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword);
  if (!name || staticOwner || (owner.typeParameters ?? []).length) return null;
  const classTypes = new Set((klass.typeParameters ?? []).map(parameter => parameter.name.text));
  if ((node.typeParameters ?? []).some(parameter => classTypes.has(parameter.name.text))) return null;
  const variable = ts.isVariableDeclaration(node.parent) && (node.parent.initializer ?? null) === node ? node.parent : null;
  const list = variable ? variableList(variable) : null;
  if (variable && (!list || list.declarations.length !== 1 || !ts.isVariableStatement(list.parent))) return null;
  const signature = checker.getSignatureFromDeclaration(node) ?? null;
  const returns = signature ? checker.typeToTypeNode(signature.getReturnType(), node, ts.NodeBuilderFlags.NoTruncation) ?? null : null;
  const callback = !variable && promiseCallback(node, checker);
  const calls = callback ? [] : directCalls(source, node, variable, owner, checker);
  const symbol = variable ? checker.getSymbolAtLocation(variable.name) ?? null : null;
  const captures = capturesOf(node, owner, symbol, checker);
  const nativeParameters = node.parameters.every(parameter => !absentCapture(checker.getTypeAtLocation(parameter.name)));
  const value = signature ? checker.getAwaitedType(signature.getReturnType()) ?? null : null;
  const nativeResult = value !== null && (Boolean(value.flags & ts.TypeFlags.Void) || !absentCapture(value));
  return returns && calls && captures && nativeParameters && nativeResult ? { arrow: node, owner, klass, variable, symbol, calls, captures, returns, callback } : null;
}

/** Discover non-escaping local async calls whose captures can be represented by native parameters and cells. */
export function closureUnits(source: ts.SourceFile, checker: ts.TypeChecker): ClosureUnit[] {
  const units: ClosureUnit[] = [];
  const scan = (node: ts.Node): void => {
    const unit = ts.isArrowFunction(node) ? unitFor(node, source, checker) : null;
    if (unit) units.push(unit);
    ts.forEachChild(node, scan);
  };
  scan(source);
  return units;
}

import { createHash } from "node:crypto";
import ts from "typescript";
import { annotateBinding, nativeMethod, nativeParameter, nativeProperty, nativeVariable } from "../../baguette/src/ast.ts";
import { required } from "../../baguette/src/required.ts";
import { closureUnits, type CapturedVariable, type ClosureUnit } from "./captures.ts";
import { identifiers } from "./names.ts";

interface Cell {
  capture: CapturedVariable;
  name: string;
}

/** Share one cell per mutable binding across lifted functions in the invocation.
 * closureUnits proves local declarations do not escape before they are removed;
 * Promise handlers retain their forwarding call sites.
 */
function closureBindings(source: ts.SourceFile, units: ClosureUnit[]) {
  const prefix = "__leek_" + createHash("sha256").update(source.text).digest("hex").slice(0, 12);
  const names = identifiers(source);
  let serial = 0;
  const fresh = (suffix: string): string => {
    let name: string;
    do { name = prefix + "_" + suffix + serial++; } while (names.has(name));
    names.add(name);
    return name;
  };
  const cellClass = fresh("Cell");
  const cells = new Map<ts.Symbol, Cell>();
  for (const unit of units) for (const capture of unit.captures) {
    if (capture.mutable && !cells.has(capture.symbol)) cells.set(capture.symbol, { capture, name: fresh("cell") });
  }
  const helperNames = new Map(units.map(unit => [unit, fresh("async")]));
  const callUnits = new Map<ts.CallExpression, ClosureUnit>();
  const callbackUnits = new Map(units.filter(unit => unit.callback).map(unit => [unit.arrow, unit]));
  const removed = new Set<ts.Statement>();
  for (const unit of units) {
    for (const call of unit.calls) callUnits.set(call, unit);
    if (unit.variable && ts.isVariableDeclarationList(unit.variable.parent) && ts.isVariableStatement(unit.variable.parent.parent)) removed.add(unit.variable.parent.parent);
  }
  const captureNames = new Map<ClosureUnit, Map<ts.Symbol, string>>();
  for (const unit of units) captureNames.set(unit, new Map(unit.captures.map(capture => [capture.symbol, fresh("capture")])));
  return { cellClass, cells, helperNames, callUnits, callbackUnits, removed, captureNames };
}

/** Expose captured state to Baguette's existing coroutine pass instead of emitting a closure runtime. */
export function lowerClosures(source: ts.SourceFile, checker: ts.TypeChecker): string {
  const units = closureUnits(source, checker);
  if (!units.length) return source.text;
  const factory = ts.factory;
  const { cellClass, cells, helperNames, callUnits, callbackUnits, removed, captureNames } = closureBindings(source, units);
  const helpers = new Map<ts.ClassDeclaration, ts.MethodDeclaration[]>();
  const result = ts.transform(source, [context => root => {
    let current: ClosureUnit | null = null;
    const parameterOf = (symbol: ts.Symbol): string | null => {
      const parameters = current ? captureNames.get(current) ?? null : null;
      return parameters ? parameters.get(symbol) ?? null : null;
    };
    const captureArgument = (capture: CapturedVariable): ts.Expression => {
      const parameter = parameterOf(capture.symbol);
      const cell = cells.get(capture.symbol) ?? null;
      return factory.createIdentifier(parameter ?? (cell ? cell.name : capture.name.text));
    };
    const reference = (node: ts.Identifier): ts.Expression | null => {
      const symbol = checker.getSymbolAtLocation(node) ?? null;
      if (!symbol) return null;
      const parameter = parameterOf(symbol);
      const cell = cells.get(symbol) ?? null;
      if (!parameter && !cell) return null;
      const value = factory.createIdentifier(parameter ?? (cell ? cell.name : node.text));
      return cell ? factory.createPropertyAccessExpression(value, "value") : value;
    };
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      if (ts.isStatement(node) && removed.has(node)) return [];
      const callback = ts.isArrowFunction(node) ? callbackUnits.get(node) ?? null : null;
      if (callback && ts.isArrowFunction(node)) {
        const name = required(helperNames.get(callback) ?? null, "async callback method");
        const arguments_ = callback.arrow.parameters.map(parameter => {
          if (!ts.isIdentifier(parameter.name)) throw new Error("Unsupported callback binding");
          return factory.createIdentifier(parameter.name.text);
        });
        const typeArguments = (node.typeParameters ?? []).map(parameter => factory.createTypeReferenceNode(parameter.name));
        const call = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createThis(), name), typeArguments,
          [...callback.captures.map(captureArgument), ...arguments_]);
        return factory.updateArrowFunction(node, (node.modifiers ?? []).filter(modifier => modifier.kind !== ts.SyntaxKind.AsyncKeyword),
          node.typeParameters ?? [], node.parameters, callback.returns, node.equalsGreaterThanToken, call);
      }
      if (ts.isTypeQueryNode(node)) {
        const entity = (name: ts.EntityName): ts.EntityName => {
          if (ts.isQualifiedName(name)) return factory.updateQualifiedName(name, entity(name.left), name.right);
          const value = reference(name);
          if (value && ts.isIdentifier(value)) return value;
          return value && ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression) && ts.isIdentifier(value.name)
            ? factory.createQualifiedName(value.expression, value.name) : name;
        };
        return factory.updateTypeQueryNode(node, entity(node.exprName), node.typeArguments ?? []);
      }
      const unit = ts.isCallExpression(node) ? callUnits.get(node) ?? null : null;
      if (unit && ts.isCallExpression(node)) {
        const name = required(helperNames.get(unit) ?? null, "lifted async method");
        const arguments_ = node.arguments.map(argument => ts.visitNode(argument, visit, ts.isExpression) ?? argument);
        return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createThis(), name), node.typeArguments ?? [],
          [...unit.captures.map(captureArgument), ...arguments_]);
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const symbol = checker.getSymbolAtLocation(node.name) ?? null;
        const cell = symbol ? cells.get(symbol) ?? null : null;
        const initializer = node.initializer ?? null;
        return cell && initializer ? nativeVariable(factory.createIdentifier(cell.name), factory.createTypeReferenceNode(cellClass, [cell.capture.type]),
          factory.createNewExpression(factory.createIdentifier(cellClass), [cell.capture.type], [ts.visitNode(initializer, visit, ts.isExpression) ?? initializer])) : ts.visitEachChild(node, visit, context);
      }
      if (ts.isShorthandPropertyAssignment(node)) {
        const symbol = checker.getShorthandAssignmentValueSymbol(node) ?? null;
        const parameter = symbol ? parameterOf(symbol) : null;
        const cell = symbol ? cells.get(symbol) ?? null : null;
        const identifier = parameter ?? (cell ? cell.name : null);
        return identifier ? factory.createPropertyAssignment(node.name, cell ? factory.createPropertyAccessExpression(factory.createIdentifier(identifier), "value") : factory.createIdentifier(identifier)) : node;
      }
      if (ts.isIdentifier(node)) return reference(node) ?? node;
      if (ts.isClassDeclaration(node)) {
        const rewritten = ts.visitEachChild(node, visit, context);
        const name = rewritten.name ?? null;
        return name ? factory.updateClassDeclaration(rewritten, rewritten.modifiers ?? [], name, rewritten.typeParameters ?? [],
          rewritten.heritageClauses ?? [], [...rewritten.members, ...(helpers.get(node) ?? [])]) : rewritten;
      }
      return ts.visitEachChild(node, visit, context);
    };
    for (const unit of units) {
      current = unit;
      const name = helperNames.get(unit) ?? null;
      const parameters = captureNames.get(unit) ?? null;
      if (!name || !parameters) throw new Error("Missing async capture parameters");
      const body = ts.isBlock(unit.arrow.body) ? unit.arrow.body : factory.createBlock([factory.createReturnStatement(unit.arrow.body)], true);
      const captures = unit.captures.map(capture => {
        const parameter = parameters.get(capture.symbol) ?? null;
        if (!parameter) throw new Error("Missing async capture binding");
        return nativeParameter(parameter, capture.mutable ? factory.createTypeReferenceNode(cellClass, [capture.type]) : capture.type);
      });
      const helper = nativeMethod({ name: factory.createIdentifier(name), modifiers: [factory.createModifier(ts.SyntaxKind.PrivateKeyword), factory.createModifier(ts.SyntaxKind.AsyncKeyword)],
        typeParameters: unit.arrow.typeParameters ?? [], parameters: [...captures, ...unit.arrow.parameters.map(parameter => {
          const type = (parameter.type ?? null) ?? (checker.typeToTypeNode(checker.getTypeAtLocation(parameter.name), parameter, ts.NodeBuilderFlags.NoTruncation) ?? null);
          const annotated = type ? annotateBinding(parameter, type) : parameter;
          if (!ts.isParameter(annotated)) throw new Error("Invalid async parameter annotation");
          return ts.visitEachChild(annotated, visit, context);
        })], returns: unit.returns,
        body: ts.visitNode(body, visit, ts.isBlock) ?? body, question: false });
      const members = helpers.get(unit.klass) ?? [];
      members.push(helper);
      helpers.set(unit.klass, members);
    }
    current = null;
    const rewritten = ts.visitNode(root, visit, ts.isSourceFile) ?? root;
    if (!cells.size) return rewritten;
    const type = factory.createTypeReferenceNode("T");
    const constructor = factory.createConstructorDeclaration([], [nativeParameter("value", type)], factory.createBlock([
      factory.createExpressionStatement(factory.createAssignment(factory.createPropertyAccessExpression(factory.createThis(), "value"), factory.createIdentifier("value")))
    ], true));
    const cell = factory.createClassDeclaration([], cellClass, [factory.createTypeParameterDeclaration([], "T")], [], [nativeProperty("value", type, null), constructor]);
    return factory.updateSourceFile(rewritten, [cell, ...rewritten.statements]);
  }]);
  try { return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0] ?? source); }
  finally { result.dispose(); }
}

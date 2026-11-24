import ts from "typescript";
import { functionBody } from "./function-body.ts";
import { librarySymbol, unwrap } from "./integers.ts";
import { parameterWritten, valueSymbol } from "./captures.ts";

/** Require the standard Error value and type at a generated binding's lexical scope. */
export function standardError(point: ts.Node, checker: ts.TypeChecker): boolean {
  return [ts.SymbolFlags.Value, ts.SymbolFlags.Type].every(flags => librarySymbol(checker.getSymbolsInScope(point, flags).find(symbol => symbol.getName() === "Error") ?? null));
}

/** Prove the thrown representation across source calls before assigning a native catch binding. */
export function errorDomain(checker: ts.TypeChecker, files: readonly ts.SourceFile[]): (node: ts.Node) => boolean {
  const pending = new Set<ts.Node>();
  const checked = new Map<ts.Node, boolean>();
  const written = new Set<ts.Symbol>();
  type Member = ts.MethodDeclaration | ts.PropertyDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;
  const methods = new Map<string, Member[]>();
  const memberBody = (member: Member): ts.ConciseBody | null => {
    const initial = ts.isPropertyDeclaration(member) ? member.initializer ?? null : null;
    return initial ? functionBody(initial) : functionBody(member);
  };
  const index = (node: ts.Node): void => {
    const assignment = ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
    const target = assignment && ts.isBinaryExpression(node) ? unwrap(node.left) : null;
    const name = target && ts.isPropertyAccessExpression(target) ? target.name : target;
    const key = target && ts.isElementAccessExpression(target) ? target.argumentExpression : null;
    const symbol = key && ts.isStringLiteral(key) && target && ts.isElementAccessExpression(target)
      ? checker.getPropertyOfType(checker.getTypeAtLocation(target.expression), key.text) ?? null
      : name ? checker.getSymbolAtLocation(name) ?? null : null;
    if (symbol) written.add(symbol);
    const member = ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ? node : null;
    if (member && ts.isIdentifier(member.name) && ts.isClassLike(member.parent)) methods.set(member.name.text, [...methods.get(member.name.text) ?? [], member]);
    ts.forEachChild(node, index);
  };
  files.forEach(index);
  const errorClass = (type: ts.Type): boolean => {
    const symbol = type.getSymbol() ?? null;
    if (symbol && symbol.getName() === "Error" && librarySymbol(symbol)) return true;
    return type.isClassOrInterface() && type.isClass() && (type.getBaseTypes() ?? []).some(errorClass);
  };
  const thrown = (expression: ts.Expression): boolean => {
    const node = unwrap(expression);
    if (ts.isNewExpression(node)) return errorClass(checker.getTypeAtLocation(node)) && safe(node);
    if (ts.isConditionalExpression(node)) return thrown(node.whenTrue) && thrown(node.whenFalse);
    if (!ts.isIdentifier(node)) return false;
    const symbol = valueSymbol(node, checker);
    const declaration = symbol ? symbol.valueDeclaration ?? null : null;
    if (!symbol || !declaration) return false;
    if (ts.isVariableDeclaration(declaration) && ts.isCatchClause(declaration.parent)) {
      return safe(declaration.parent.parent.tryBlock) || errorClass(checker.getTypeAtLocation(node));
    }
    const value = ts.isVariableDeclaration(declaration) ? declaration.initializer ?? null : null;
    return value !== null && !parameterWritten(declaration.getSourceFile(), symbol, checker) && thrown(value);
  };
  const initialisers = (type: ts.Type): boolean => {
    const symbol = type.getSymbol() ?? null;
    const classes = (symbol ? symbol.declarations ?? [] : []).filter(ts.isClassDeclaration);
    return classes.every(klass => klass.members.every(member => {
      const value = ts.isPropertyDeclaration(member) ? member.initializer ?? null : null;
      return value === null || safe(value);
    })) && (!type.isClassOrInterface() || (type.getBaseTypes() ?? []).every(initialisers));
  };
  const overridesSafe = (declaration: ts.Node): boolean => {
    const member = ts.isFunctionLike(declaration) && ts.isPropertyDeclaration(declaration.parent) ? declaration.parent : declaration;
    if (!(ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) ||
      !ts.isIdentifier(member.name) || !ts.isClassLike(member.parent)) return true;
    const base = checker.getTypeAtLocation(member.parent);
    const overrides = (methods.get(member.name.text) ?? []).filter(method => ts.isClassLike(method.parent) && checker.isTypeAssignableTo(checker.getTypeAtLocation(method.parent), base));
    return overrides.every(method => { const body = memberBody(method); return body !== null && safe(body); });
  };
  const primitive = (node: ts.Expression): boolean => {
    const type = checker.getTypeAtLocation(node);
    return (type.isUnion() ? type.types : [type]).every(part => Boolean(part.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.StringLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
  };
  const nativeOperator = (node: ts.Node): boolean => {
    if (ts.isTemplateExpression(node)) return node.templateSpans.every(span => primitive(span.expression));
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) return node.operator === ts.SyntaxKind.ExclamationToken || primitive(node.operand);
    if (!ts.isBinaryExpression(node)) return true;
    const operator = node.operatorToken.kind;
    if ([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.CommaToken].includes(operator)) return true;
    if (operator === ts.SyntaxKind.InstanceOfKeyword) {
      const constructor = checker.getSymbolAtLocation(node.right) ?? null;
      const symbol = constructor && constructor.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(constructor) : constructor;
      return symbol !== null && (librarySymbol(symbol) || (symbol.declarations ?? []).some(declaration => ts.isClassDeclaration(declaration) &&
        declaration.members.every(member => { const name = "name" in member ? member.name ?? null : null; return name === null || !ts.isComputedPropertyName(name); })));
    }
    const big = [node.left, node.right].some(operand => {
      const type = checker.getTypeAtLocation(operand);
      return (type.isUnion() ? type.types : [type]).some(part => Boolean(part.flags & ts.TypeFlags.BigIntLike));
    });
    const trapping = [ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken, ts.SyntaxKind.LessThanLessThanToken,
      ts.SyntaxKind.GreaterThanGreaterThanToken, ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken].includes(operator);
    return operator !== ts.SyntaxKind.InKeyword && !(big && trapping) && primitive(node.left) && primitive(node.right);
  };
  const callable = (node: ts.CallExpression | ts.NewExpression): boolean => {
    const signature = checker.getResolvedSignature(node) ?? null;
    const declaration = signature ? signature.declaration ?? null : null;
    if (!declaration) return false;
    const target = node.expression;
    const binding = ts.isPropertyAccessExpression(target) ? target.name : target;
    const direct = checker.getSymbolAtLocation(binding) ?? null;
    const symbol = direct && direct.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(direct) : direct;
    if (symbol && written.has(symbol)) return false;
    const body = functionBody(declaration);
    if (body && !safe(body)) return false;
    if (!overridesSafe(declaration)) return false;
    if (ts.isNewExpression(node) && !initialisers(checker.getTypeAtLocation(node))) return false;
    if (body) return true;
    const file = declaration.getSourceFile();
    const standard = /(?:^|[/\\])lib\.es[^/\\]*\.d\.ts$/.test(file.fileName);
    const owner = declaration.parent;
    const ownerName = "name" in owner ? owner.name ?? null : null;
    const name = ownerName && ts.isIdentifier(ownerName) ? ownerName.text : "";
    const invoked = ts.isIdentifier(target) ? target.text : ts.isPropertyAccessExpression(target) ? target.name.text : "";
    return file.isDeclarationFile && (standard || ["TextEncoder", "TextDecoder"].includes(name)) &&
      !["eval", "Function", "Proxy", "reject", "call", "apply", "bind"].includes(invoked) && !name.startsWith("Promise");
  };
  const scan = (node: ts.Node): boolean => {
    if (ts.isTypeNode(node)) return true;
    if (!nativeOperator(node)) return false;
    if (ts.isThrowStatement(node)) return thrown(node.expression);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      return callable(node) && safe(node.expression) && (node.arguments ?? []).every(argument => {
        const type = checker.getTypeAtLocation(argument);
        const callbacks = type.getCallSignatures();
        return callbacks.every(signature => {
          const declaration = signature.declaration ?? null;
          const body = declaration ? functionBody(declaration) : null;
          return body !== null && safe(body);
        }) && safe(argument);
      });
    }
    if (ts.isFunctionLike(node)) return true;
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node) || ts.isTaggedTemplateExpression(node)) return false;
    const symbol = ts.isPropertyAccessExpression(node) ? checker.getSymbolAtLocation(node.name) ?? null : null;
    const accessors = (symbol ? symbol.declarations ?? [] : []).filter(declaration => ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration));
    if (accessors.some(accessor => { const body = accessor.body ?? null; return body === null || !overridesSafe(accessor) || !safe(body); })) return false;
    return !(ts.forEachChild(node, child => !safe(child)) ?? false);
  };
  const safe = (node: ts.Node): boolean => {
    const previous = checked.get(node) ?? null;
    if (previous !== null) return previous;
    if (pending.has(node)) return true;
    pending.add(node);
    const result = scan(node);
    pending.delete(node);
    // A positive result inside a recursive cycle depends on its ancestors' remaining operations.
    if (!result || !pending.size) checked.set(node, result);
    return result;
  };
  return safe;
}

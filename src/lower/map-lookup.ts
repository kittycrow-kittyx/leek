import ts from "typescript";
import { librarySymbol, unwrap } from "./integers.ts";

export interface MapLookup {
  receiver: ts.Expression;
  key: ts.Expression;
  receiverType: ts.TypeNode;
  keyType: ts.TypeNode;
  valueType: ts.Type;
}

export function mapLookup(expression: ts.Expression, checker: ts.TypeChecker): MapLookup | null {
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
  return receiverNode && keyNode ? { receiver, key, receiverType: receiverNode, keyType: keyNode, valueType } : null;
}


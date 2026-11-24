import ts from "typescript";

/** Collect existing bindings and references before choosing private generated names. */
export function identifiers(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(source);
  return names;
}

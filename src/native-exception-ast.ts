import { CommonFlags, Node, NodeKind, Parser, type BlockStatement, type CallExpression, type ClassDeclaration, type ExpressionStatement, type FieldDeclaration, type IdentifierExpression, type MethodDeclaration, type ReturnStatement, type ThrowStatement } from "assemblyscript";

type Child = Node | Node[] | string | number | boolean | null;

function childNode(value: Child): value is Node {
  return value !== null && typeof value === "object" && !Array.isArray(value) && "kind" in value && "range" in value;
}

/** Visit the public AST children, excluding source ranges which point back to their owning source. */
function rewrite(node: Node, replace: (node: Node) => Node): Node {
  const fields = node as Node & Record<string, Child>;
  const child = (value: Child): Child => {
    if (Array.isArray(value)) return value.map(item => rewrite(item, replace));
    return childNode(value) ? rewrite(value, replace) : value;
  };
  for (const key of Object.keys(fields).filter(key => key !== "range")) {
    const original = fields[key] ?? null;
    const replacement = child(original);
    if (replacement !== original) fields[key] = replacement;
  }
  return replace(node);
}

function call(name: string, args: Node[], range: Node["range"]): Node {
  return Node.createCallExpression(Node.createIdentifierExpression(name, range), null, args, range);
}

function members(text: string, range: Node["range"]): ClassDeclaration["members"] {
  const parser = new Parser();
  parser.parseFile("class LeekTemplate<T> {" + text + "}", "leek-exception-template.ts", false);
  const source = parser.sources[0] ?? null;
  const declaration = source ? source.statements[0] ?? null : null;
  if (!declaration || declaration.kind !== NodeKind.ClassDeclaration || parser.diagnostics.length) throw new Error("Invalid native exception member template");
  return (declaration as ClassDeclaration).members.map(member => rewrite(member, node => { node.range = range; return node; })) as ClassDeclaration["members"];
}

function resumeMethod(klass: ClassDeclaration, name: string): MethodDeclaration {
  const member = klass.members.find(member => member.kind === NodeKind.MethodDeclaration && member.name.text === name) ?? null;
  if (!member || member.kind !== NodeKind.MethodDeclaration) throw new Error("Missing Baguette method " + name);
  return member as MethodDeclaration;
}

function extendTask(klass: ClassDeclaration, empty: boolean): void {
  const resume = resumeMethod(klass, "__bq_resume");
  klass.members.push(...members(`private __leek_error: Error | null = null;
        __leek_reject(error: Error): void {
          if (this.__bq_ready()) return;
          this.__leek_error = error;
          this.__bq_resolve(${empty ? "" : "this.__bq_value"});
        }`, klass.range));
  const replacement = members(`__bq_resume(): ${empty ? "void" : "T"} {
        const error = this.__leek_error;
        if (error) { LeekRaise(error); unreachable(); }
        ${empty ? "" : "return this.__bq_value;"}
      }`, klass.range)[0] ?? null;
  if (!replacement || replacement.kind !== NodeKind.MethodDeclaration) throw new Error("Missing native rejection method");
  resume.body = (replacement as MethodDeclaration).body;
}

/** Baguette's synthetic fields use AssemblyScript's normal zero/null initialisation.
 * The definite-assignment assertion is type-only and has no runtime effect.
 * Remove it solely from Baguette-owned classes, leaving canonical OS classes untouched.
 */
function generatedFields(klass: ClassDeclaration): void {
  for (const member of klass.members) {
    if (member.kind !== NodeKind.FieldDeclaration) continue;
    const field = member as FieldDeclaration;
    field.flags &= ~CommonFlags.DefinitelyAssigned;
  }
}

function extendFrame(klass: ClassDeclaration): void {
  const resume = resumeMethod(klass, "__bq_resume_frame");
  if (!resume.body) throw new Error("Missing Baguette frame body");
  const wrapper = members("__bq_resume_frame(): void { if (LeekTry()) {} else { this.__bq_task.__leek_reject(LeekCaught()); } }", klass.range)[0] ?? null;
  if (!wrapper || wrapper.kind !== NodeKind.MethodDeclaration) throw new Error("Missing native frame handler");
  const body = (wrapper as MethodDeclaration).body;
  const branch = body && body.kind === NodeKind.Block ? (body as BlockStatement).statements[0] ?? null : null;
  if (!branch || branch.kind !== NodeKind.If) throw new Error("Missing native frame region");
  (branch as Node & { ifTrue: Node }).ifTrue = resume.body;
  resume.body = body;
}

function callName(statement: Node | null): string {
  const expression = statement && statement.kind === NodeKind.Expression ? (statement as ExpressionStatement).expression :
    statement && statement.kind === NodeKind.Return ? (statement as ReturnStatement).value : null;
  const target = expression && expression.kind === NodeKind.Call ? (expression as CallExpression).expression : null;
  return target && target.kind === NodeKind.Identifier ? (target as IdentifierExpression).text : "";
}

function raisedBlock(node: Node): Node | null {
  if (node.kind !== NodeKind.Block) return null;
  const statements = (node as BlockStatement).statements;
  const first = statements[0] ?? null, last = statements[1] ?? null;
  if (statements.length !== 2 || !first || callName(first) !== "LeekRaise" || callName(last) !== "unreachable") return null;
  // Keep AS's terminating-flow proof. The tag throw always exits before the synthetic abort.
  return Node.createBlockStatement([first, Node.createThrowStatement(Node.createNullExpression(node.range), node.range)], node.range);
}

/** Extend Baguette's existing tasks with rejection and route standard-library throws through the same native tag. */
export function nativeExceptionAst(parser: Parser): void {
  for (const source of parser.sources) rewrite(source, node => {
    if (source.normalizedPath.startsWith("~lib/") && node.kind === NodeKind.Throw) {
      const statement = node as ThrowStatement;
      return Node.createBlockStatement([
        Node.createExpressionStatement(call("LeekRaise", [statement.value], node.range)),
        Node.createThrowStatement(Node.createNullExpression(node.range), node.range)
      ], node.range);
    }
    const raised = raisedBlock(node);
    if (raised) return raised;
    if (node.kind !== NodeKind.ClassDeclaration) return node;
    const klass = node as ClassDeclaration;
    if (["__BqTask", "__BqTaskVoid"].includes(klass.name.text)) extendTask(klass, klass.name.text === "__BqTaskVoid");
    if (klass.name.text.startsWith("__BqFrame_") || ["__BqTask", "__BqTaskVoid", "__BqContinuation"].includes(klass.name.text)) generatedFields(klass);
    if (klass.name.text.startsWith("__BqFrame_")) extendFrame(klass);
    return node;
  });
}

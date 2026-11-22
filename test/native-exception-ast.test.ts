import assert from "node:assert/strict";
import { test } from "node:test";
import { CommonFlags, NodeKind, Parser, type ClassDeclaration, type FieldDeclaration } from "assemblyscript";
import { nativeExceptionAst } from "../src/native-exception-ast.ts";

test("native frame AST removes redundant constructor field assertions, not conditional ones", () => {
  const parser = new Parser();
  parser.parseFile(`class DummyTask { __leek_reject(error: Error): void {} }
class __BqFrame_Fixture {
  __bq_task!: DummyTask;
  __bq_value!: i32;
  __bq_optional!: i32;
  __bq_pending!: i32;
  constructor(task: DummyTask, value: i32, enabled: bool) {
    this.__bq_task = task;
    this.__bq_value = value;
    if (enabled) this.__bq_optional = value;
  }
  __bq_resume_frame(): void {}
}`, "frame-fixture.ts", false);
  assert.equal(parser.diagnostics.length, 0);
  const source = parser.sources[0];
  assert.ok(source);
  const klass = source.statements.find(node => node.kind === NodeKind.ClassDeclaration && node.name.text === "__BqFrame_Fixture");
  assert.ok(klass && klass.kind === NodeKind.ClassDeclaration);
  if (!klass || klass.kind !== NodeKind.ClassDeclaration) throw new Error("Missing native frame fixture");
  const fields = (klass as ClassDeclaration).members.filter(member => member.kind === NodeKind.FieldDeclaration) as FieldDeclaration[];
  const state = (): Map<string, boolean> => new Map(fields.map(field => [field.name.text, Boolean(field.flags & CommonFlags.DefinitelyAssigned)]));
  assert.deepEqual([...state().values()], [true, true, true, true]);
  nativeExceptionAst(parser);
  const result = state();
  assert.equal(result.get("__bq_task"), false);
  assert.equal(result.get("__bq_value"), false);
  assert.equal(result.get("__bq_optional"), true);
  assert.equal(result.get("__bq_pending"), true);
});

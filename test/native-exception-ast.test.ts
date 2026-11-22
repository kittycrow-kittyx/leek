import assert from "node:assert/strict";
import { test } from "node:test";
import { ClassDeclaration, CommonFlags, FieldDeclaration, Parser } from "assemblyscript";
import { nativeExceptionAst } from "../src/native-exception-ast.ts";

test("native frame AST removes type-only assertions from generated fields", () => {
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
  const source = parser.sources[0] ?? null;
  if (!source) throw new Error("Missing native frame source");
  const declaration = source.statements[1] ?? null;
  if (!(declaration instanceof ClassDeclaration)) throw new Error("Missing native frame fixture");
  assert.equal(declaration.name.text, "__BqFrame_Fixture");
  const fields = declaration.members.filter((member): member is FieldDeclaration => member instanceof FieldDeclaration);
  const state = (): Array<[string, boolean]> => fields.map(field => [field.name.text, Boolean(field.flags & CommonFlags.DefinitelyAssigned)]);
  assert.deepEqual(state(), [
    ["__bq_task", true],
    ["__bq_value", true],
    ["__bq_optional", true],
    ["__bq_pending", true]
  ]);
  nativeExceptionAst(parser);
  assert.deepEqual(state(), [
    ["__bq_task", false],
    ["__bq_value", false],
    ["__bq_optional", false],
    ["__bq_pending", false]
  ]);
});

test("native AST preserves canonical class assertions", () => {
  const parser = new Parser();
  parser.parseFile(`class CanonicalKernel {
  pending!: i32;
}
class __BqContinuation {
  value!: i32;
  __bq_resume_frame(): void {}
}`, "assertion-fixture.ts", false);
  assert.equal(parser.diagnostics.length, 0);
  nativeExceptionAst(parser);
  const source = parser.sources[0] ?? null;
  if (!source) throw new Error("Missing assertion fixture source");
  const canonical = source.statements[0] ?? null;
  const generated = source.statements[1] ?? null;
  if (!(canonical instanceof ClassDeclaration) || !(generated instanceof ClassDeclaration)) throw new Error("Missing assertion fixture classes");
  const canonicalField = canonical.members[0] ?? null;
  const generatedField = generated.members[0] ?? null;
  if (!(canonicalField instanceof FieldDeclaration) || !(generatedField instanceof FieldDeclaration)) throw new Error("Missing assertion fixture fields");
  assert.ok(canonicalField.flags & CommonFlags.DefinitelyAssigned);
  assert.equal(Boolean(generatedField.flags & CommonFlags.DefinitelyAssigned), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { lowerNumeric } from "../src/lower/numeric.ts";

function lowered(text: string): string {
  const root = mkdtempSync(join(tmpdir(), "leek-numeric-"));
  try {
    const file = join(root, "source.ts");
    writeFileSync(file, text);
    const programme = ts.createProgram([file], { target: ts.ScriptTarget.ES2022, strict: true, types: [] });
    const source = programme.getSourceFile(file) ?? null;
    assert.ok(source);
    return lowerNumeric(source, programme.getTypeChecker());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("numeric predicates retain their semantics at floating-point boundaries", () => {
  const input = "function check(n: number): boolean[] { return [Number.isNaN(n), Number.isFinite(n), Number.isInteger(n), Number.isSafeInteger(n)]; }";
  const output = lowered(input);
  assert.ok(!output.includes("Number.is"));
  // The emitted test fixture is executed only in the test runner.
  const code = ts.transpileModule(output, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const values = [NaN, Infinity, -Infinity, -0, 0, 0.5, -0.5, 42, -42, Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1];
  const literals = values.map(n => Object.is(n, -0) ? "-0" : String(n)).join(", ");
  const actual = execFileSync(process.execPath, ["-e", code + "\nconsole.log(JSON.stringify([" + literals + "].map(check)));"], { encoding: "utf8" }).trim();
  const expected = values.map(n => [Number.isNaN(n), Number.isFinite(n), Number.isInteger(n), Number.isSafeInteger(n)]);
  assert.equal(actual, JSON.stringify(expected));
});

test("locally shadowed Number and non-numeric input remain unchanged", () => {
  const local = "function check(Number: { isFinite(n: number): boolean }): boolean { return Number.isFinite(3); }";
  const unknown = "function check(n: unknown): boolean { return Number.isFinite(n); }";
  assert.equal(lowered(local), local);
  assert.equal(lowered(unknown), unknown);
});

test("an expression is evaluated only once and helper names do not collide", () => {
  const input = "function __leek_isFinite(): number { return 1; } function check(): boolean { return Number.isFinite(__leek_isFinite()); }";
  const output = lowered(input);
  assert.match(output, /__leek_isFinite_\(__leek_isFinite\(\)\)/);
});

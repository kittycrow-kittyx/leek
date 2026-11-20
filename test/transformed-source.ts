import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

/** Recheck a staged transformation before comparing its behaviour with the original source. */
export function withTransformedSource<T>(text: string, lower: (source: ts.SourceFile, checker: ts.TypeChecker) => string,
  verify: (file: string, output: string) => T, overrides: ts.CompilerOptions = {}): T {
  const root = mkdtempSync(join(tmpdir(), "leek-transform-"));
  try {
    const file = join(root, "entry.ts");
    writeFileSync(file, text);
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, types: [], noEmit: true, ...overrides };
    const program = ts.createProgram([file], options);
    const source = program.getSourceFile(file) ?? null;
    assert.ok(source);
    const output = lower(source, program.getTypeChecker());
    writeFileSync(file, output);
    const checked = ts.createProgram([file], options);
    assert.deepEqual(ts.getPreEmitDiagnostics(checked).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
    return verify(file, output);
  } finally { rmSync(root, { recursive: true, force: true }); }
}


/** Compare observable output after checking the transformed source, using a separate process for each programme. */
export function compareTransformedExecution(text: string, lower: (source: ts.SourceFile, checker: ts.TypeChecker) => string): { text: string; output: string } {
  return withTransformedSource(text, lower, (file, output) => {
    const actual = execFileSync(process.execPath, [file], { encoding: "utf8" });
    writeFileSync(file, text);
    const expected = execFileSync(process.execPath, [file], { encoding: "utf8" });
    assert.equal(actual, expected);
    return { text: output, output: actual };
  });
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, sourceEntry, target } from "../src/project.ts";

test("target selection is explicit", () => {
  for (const value of ["wasm", "clang", "rust"]) assert.equal(target(value), value);
  assert.throws(() => target("javascript"));
});
test("only real mikuOS implementation entries are selected", () => {
  const root = mkdtempSync(join(tmpdir(), "leek-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "shell.ts"), "export const example = 1;");
    writeFileSync(join(root, "src", "types.d.ts"), "declare const example: number;");
    writeFileSync(join(root, "outside.ts"), "export {};");
    const entry = sourceEntry(root, "src/shell.ts");
    assert.throws(() => sourceEntry(root, "outside.ts"));
    assert.throws(() => sourceEntry(root, "src/types.d.ts"));
    assert.throws(() => sourceEntry(root, entry));
    const project = join(root, "build", "tsconfig.json");
    createProject(root, [entry], project);
    const expected = {
      extends: join(root, "tsconfig.json"),
      compilerOptions: {
        noEmit: true, incremental: false, composite: false,
        declaration: false, declarationMap: false, sourceMap: false,
        rootDir: join(root, "src")
      },
      files: [entry], include: [], exclude: []
    };
    assert.equal(readFileSync(project, "utf8"), JSON.stringify(expected, null, 2) + "\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

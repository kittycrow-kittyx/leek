import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { options } from "../src/args.ts";

test("target selects compilation output", () => {
  for (const target of ["wasm", "clang", "rust"]) {
    const parsed = options(["--target=" + target], process.cwd());
    assert.equal(parsed.command, "compile");
    assert.equal(parsed.selected, target);
    assert.equal(parsed.entry, "src/main/boot.ts");
    assert.equal(parsed.source, process.cwd());
  }
});

test("source path is relative to the caller", () => {
  const cwd = resolve("caller");
  const parsed = options(["--source", "../mikuOS", "--target", "rust"], cwd);
  assert.equal(parsed.source, resolve(cwd, "../mikuOS"));
  assert.equal(parsed.selected, "rust");
});

test("analysis and validation are explicit", () => {
  const parsed = options(["analyse", "--source=../mikuOS", "--entry=src/sh/lex.ts", "--validate-only"], process.cwd());
  assert.equal(parsed.command, "analyse");
  assert.equal(parsed.entry, "src/sh/lex.ts");
  assert.equal(parsed.validateOnly, true);
  assert.throws(() => options(["--source"], process.cwd()), /Missing value/);
  assert.throws(() => options(["--target=javascript"], process.cwd()), /Expected target/);
});

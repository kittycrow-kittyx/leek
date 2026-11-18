import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { options } from "../src/args.ts";

test("source is resolved relative to the caller", () => {
  const cwd = resolve("caller");
  const parsed = options(["analyse", "--source", "../mikuOS", "--target", "rust"], cwd);
  assert.equal(parsed.source, resolve(cwd, "../mikuOS"));
  assert.equal(parsed.selected, "rust");
  assert.equal(parsed.entry, "src/sh/lex.ts");
});

test("source must be supplied for every command", () => {
  for (const command of ["analyse", "lower", "wasm"]) {
    assert.throws(() => options([command], process.cwd()), /--source PATH is required/);
    assert.throws(() => options([command, "--source"], process.cwd()), /Missing value/);
  }
});

test("WASM accepts an external source and a validation flag", () => {
  const parsed = options(["wasm", "--source", "../mikuOS", "--entry", "src/main/boot.ts", "--validate-only"], process.cwd());
  assert.equal(parsed.validateOnly, true);
  assert.equal(parsed.entry, "src/main/boot.ts");
  assert.equal(parsed.selected, "wasm");
  assert.throws(() => options(["wasm", "--source", ".", "--target", "rust"], process.cwd()), /fixed target/);
});

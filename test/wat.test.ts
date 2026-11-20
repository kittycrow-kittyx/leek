import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { modularWat } from "../baguette/src/wat-modules.ts";
import { linkWat } from "../src/wat.ts";

test("the separate WAT stage reproduces Baguette text with Unicode offsets and rejects altered layouts", () => {
  const root = mkdtempSync(join(tmpdir(), "leek-wat-"));
  const text = '(module\n (func $__bq_12345678_run (result i32) i32.const 42)\n (data (i32.const 0) "🌱")\n (export "run" (func $__bq_12345678_run))\n)';
  try {
    const emitted = modularWat(text, [{ source: "src/main/boot.ts", file: "src/main/boot.wat", symbolPrefix: "__bq_12345678_", exports: ["run"] }]);
    for (const [file, contents] of emitted.files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const layoutPath = join(root, "layout.json");
    writeFileSync(layoutPath, JSON.stringify(emitted.layout));
    assert.equal(linkWat(layoutPath), text);
    writeFileSync(layoutPath, JSON.stringify({ ...emitted.layout, order: [["../outside.wat", 0, 1]] }));
    assert.throws(() => linkWat(layoutPath), /Unknown WAT module/);
    writeFileSync(layoutPath, JSON.stringify({ ...emitted.layout, modules: [{ source: "outside.ts", file: "../outside.wat", fields: 1 }] }));
    assert.throws(() => linkWat(layoutPath), /Invalid WAT module path/);
    writeFileSync(layoutPath, JSON.stringify({ ...emitted.layout, order: emitted.layout.order.map(([file, offset, length]) => [file, offset + 1, length]) }));
    assert.throws(() => linkWat(layoutPath), /Invalid WAT field order/);
    writeFileSync(layoutPath, JSON.stringify(emitted.layout));
    writeFileSync(join(root, "runtime.wat"), (emitted.files.get("runtime.wat") ?? "") + "(func $hidden)");
    assert.throws(() => linkWat(layoutPath), /Unlinked WAT declarations/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("WAT source symlinks cannot escape the layout directory", () => {
  const root = mkdtempSync(join(tmpdir(), "leek-wat-boundary-"));
  try {
    mkdirSync(join(root, "source"));
    writeFileSync(join(root, "outside.wat"), "\n");
    symlinkSync(join(root, "outside.wat"), join(root, "source/module.wat"));
    writeFileSync(join(root, "source/layout.json"), JSON.stringify({ schema: 1, encoding: "utf-16-code-units", prefix: "(module", suffix: ")", modules: [], order: [] }));
    assert.throws(() => linkWat(join(root, "source/layout.json")), /outside layout directory/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

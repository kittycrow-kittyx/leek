import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { WatLayout } from "../baguette/src/wat-modules.ts";

const decodeLayout: (text: string) => WatLayout = JSON.parse;
const array = (value: object): boolean => Array.isArray(value);

/** Reassemble the pinned Baguette layout exactly, using its UTF-16 field offsets. */
export function linkWat(layoutPath: string): string {
  const layout = decodeLayout(readFileSync(layoutPath, "utf8"));
  assert.equal(layout.schema, 1);
  assert.equal(layout.encoding, "utf-16-code-units");
  assert.equal(typeof layout.prefix, "string");
  assert.equal(typeof layout.suffix, "string");
  assert.ok(array(layout.modules) && array(layout.order));
  const root = realpathSync(dirname(layoutPath));
  const allowed = new Set(["module.wat", "runtime.wat"]);
  for (const module of layout.modules) {
    assert.equal(typeof module.source, "string");
    assert.ok(Number.isSafeInteger(module.fields) && module.fields >= 0);
    assert.ok(!allowed.has(module.file), "Duplicate WAT module path");
    allowed.add(module.file);
  }
  const files = new Map<string, string>();
  for (const path of allowed) {
    assert.ok(typeof path === "string" && /^[A-Za-z0-9_./-]+\.wat$/.test(path) &&
      path.split("/").every(part => part && part !== "." && part !== ".."), "Invalid WAT module path");
    const file = realpathSync(resolve(root, path));
    const rel = relative(root, file);
    assert.ok(!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep), "WAT module outside layout directory");
    files.set(path, readFileSync(file, "utf8"));
  }
  const positions = new Map<string, number>();
  const counts = new Map<string, number>();
  const chunks = [layout.prefix];
  for (const field of layout.order) {
    assert.ok(array(field) && field.length === 3, "Invalid WAT field record");
    const [file, offset, length] = field;
    const text = files.get(file) ?? null;
    assert.ok(text !== null, "Unknown WAT module in layout order");
    assert.ok(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && length > 0);
    assert.equal(offset, positions.get(file) ?? 0, "Invalid WAT field order");
    assert.ok(offset + length <= text.length, "Truncated WAT field");
    chunks.push(text.slice(offset, offset + length));
    positions.set(file, offset + length);
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  for (const [file, text] of files) assert.equal(text.slice(positions.get(file) ?? 0),
    positions.has(file) ? "\n" : ";; No standalone declarations emitted for this module.\n", "Unlinked WAT declarations in " + file);
  for (const module of layout.modules) assert.equal(counts.get(module.file) ?? 0, module.fields, "Incorrect WAT field count");
  chunks.push(layout.suffix);
  return chunks.join("");
}

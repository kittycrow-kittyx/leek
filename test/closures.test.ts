import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { lowerClosures } from "../src/lower/closures.ts";

function transform(text: string, execute: boolean): { text: string; output: string } {
  const root = mkdtempSync(join(tmpdir(), "leek-captures-"));
  try {
    const file = join(root, "source.ts");
    writeFileSync(file, text);
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, types: [], noEmit: true };
    const program = ts.createProgram([file], options);
    const source = program.getSourceFile(file) ?? null;
    assert.ok(source);
    const output = lowerClosures(source, program.getTypeChecker());
    writeFileSync(file, output);
    const checked = ts.createProgram([file], options);
    assert.deepEqual(ts.getPreEmitDiagnostics(checked).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
    const result = execute ? execFileSync(process.execPath, [file], { encoding: "utf8" }) : "";
    writeFileSync(file, text);
    const expected = execute ? execFileSync(process.execPath, [file], { encoding: "utf8" }) : "";
    assert.equal(result, expected);
    return { text: output, output: result };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("local recursive async functions retain their receiver, private access and mutable state", () => {
  const source = `export {};
class Counter {
  private base = 3;
  async run(input: number): Promise<number> {
    const scale = input + this.base;
    let count = 0;
    const one = async (depth: number): Promise<number> => {
      count++;
      if (depth > 0) return await one(depth - 1) + scale;
      return this.base + count;
    };
    const first = await one(2);
    count += 1;
    return first + await one(0);
  }
}
console.log(JSON.stringify(await Promise.all([new Counter().run(4), new Counter().run(7)])));`;
  const result = transform(source, true);
  assert.match(result.text, /private async __leek_/);
  assert.doesNotMatch(result.text, /const one = async/);
  assert.equal(result.output.trim(), "[28,34]");
});

test("concurrent callbacks share captured cells while each method call owns its state", () => {
  const source = `export {};
class Capture {
  async run(input: number): Promise<object> {
    let count = input;
    const first = async (value: number): Promise<object> => {
      count += value;
      await Promise.resolve();
      const snapshot: typeof count = count;
      return { count, snapshot };
    };
    const second = async (value: number): Promise<number> => { count += value; return count; };
    const pending = first(2);
    const intermediate = await second(3);
    const result = await pending;
    return { result, intermediate, count };
  }
}
console.log(JSON.stringify(await Promise.all([new Capture().run(1), new Capture().run(10)])));`;
  const result = transform(source, true);
  assert.match(result.text, /Cell\d+<T>/);
  assert.doesNotMatch(result.text, /const first = async/);
  assert.doesNotMatch(result.text, /const second = async/);
});

test("async immediate invocation preserves destructured captures and thrown failures", () => {
  const source = `export {};
class Capture {
  private value = 5;
  async run(input: number): Promise<number> {
    const { amount } = { amount: input };
    return (async (extra = amount): Promise<number> => {
      if (extra < 0) throw new Error("negative");
      return extra + this.value;
    })();
  }
}
const run = new Capture();
console.log(await run.run(4));
try { await run.run(-1); } catch (error) { console.log(error instanceof Error ? error.message : "unexpected"); }`;
  const result = transform(source, true);
  assert.match(result.text, /private async __leek_/);
  assert.doesNotMatch(result.text, /\(async \(extra/);
});

test("escaping callbacks, forward bindings and mutable parameters await explicit lowering", () => {
  for (const source of [
    'export {}; class C { run(): () => Promise<number> { const fn = async (): Promise<number> => 1; return fn; } }',
    'export {}; class C { async run(): Promise<number> { const fn = async (): Promise<number> => later; const later = 1; return fn(); } }',
    'export {}; class C { async run(value: number): Promise<number> { const fn = async (): Promise<number> => value; [value] = [2]; return fn(); } }',
    'export {}; class C { run(): object { const fn = async (): Promise<number> => 1; return { fn }; } }'
  ]) assert.equal(transform(source, false).text, source);
});

test("different receivers and shadowed class generics retain their original closure", () => {
  for (const source of [
    'export {}; class C { run(): Promise<number> { const fn = async (): Promise<number> => 1; function use(): Promise<number> { return fn(); } return use(); } }',
    'export {}; class C { run(): Promise<number> { const fn = async (): Promise<number> => 1; class Inner { use = (): Promise<number> => fn(); } return new Inner().use(); } }',
    'export {}; class C<T> { run(value: T): Promise<number> { const fn = async <T>(extra: T): Promise<number> => { String(value); String(extra); return 1; }; return fn(2); } }'
  ]) assert.equal(transform(source, false).text, source);
});

test("Promise handlers retain fulfilment, rejection and microtask ordering", () => {
  const source = `export {};
const events: string[] = [];
class Queue {
  private previous: Promise<void> = Promise.resolve();
  run(input: number): Promise<void> {
    const delta = input;
    let count = input;
    this.previous = this.previous.then(async () => {
      events.push("start:" + delta);
      await Promise.resolve();
      count++;
      if (delta < 0) throw new Error("negative");
      events.push("done:" + count);
    }, null).catch(async <T>(reason: T) => {
      await Promise.resolve();
      events.push(reason instanceof Error ? reason.message : "other");
    }).finally(async () => { events.push("finally:" + delta); });
    return this.previous;
  }
}
const queue = new Queue();
const first = queue.run(1);
const second = queue.run(-1);
const observer = Promise.resolve().then(() => events.push("observer"));
await Promise.all([first, second, observer]);
console.log(JSON.stringify(events));`;
  const result = transform(source, true);
  assert.match(result.text, /private async __leek_/);
  assert.doesNotMatch(result.text, /\.then\(async|\.catch\(async|\.finally\(async/);
});

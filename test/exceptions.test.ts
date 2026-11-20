import assert from "node:assert/strict";
import { test } from "node:test";
import { withTransformedSource, compareTransformedExecution } from "./transformed-source.ts";
import { lowerLocalExceptions } from "../src/lower/exceptions.ts";


test("local Error catches retain returns, loop exits and catch effects", () => {
  const source = `const events: string[] = [];
function run(input: number): number {
  let total = 0;
  for (let index = 0; index < 3; index++) {
    try {
      total++;
      if (input < 0) throw new Error("negative");
      if (index === 1) continue;
      total += input + index;
    } catch (error) { events.push(error instanceof Error ? error.message : "unexpected"); total += 7; }
  }
  return total;
}
function returned(input: number): number { try { if (input < 0) throw new Error("bad"); return input + 1; } catch (error) { return error instanceof Error ? error.message.length : 0; } }
function ignored(input: number): number { try { if (input < 0) throw new Error("bad"); return input; } catch { return 7; } }
console.log(JSON.stringify([[-1,0,1,4].map(run), [-1,0,1].map(returned), [-1,0,1].map(ignored), events]));`;
  const output = compareTransformedExecution(source, lowerLocalExceptions).text;
  assert.doesNotMatch(output, /\btry\b|\bthrow\b|\bcatch\b/);
  assert.match(output, /do \{/);
});

test("untracked effects, arbitrary throws, finally and narrowed primitive catches retain their source", { timeout: 30000 }, () => {
  const sources = [
    'function call():void {} function run():number { try { call(); throw new Error("x"); } catch(error) { return 1; } }',
    'function run():number { try { throw "x"; } catch(error) { return typeof error === "string" ? error.length : 0; } }',
    'function run():number { try { throw new Error("x"); } catch(error) { return 1; } finally { console.log("cleanup"); } }',
    'function run():number { try { throw new Error("x"); } catch(error) { return typeof error === "string" ? error.length : 0; } }',
    'function run(value: { readonly flag: boolean }):number { try { if(value.flag) throw new Error("x"); return 0; } catch(error) { return 1; } }',
    'function run(value: bigint):number { try { const quotient = 1n / value; throw new Error("x"); } catch(error) { return 1; } }',
    'function run(value: object):number { try { const number = +value; throw new Error("x"); } catch(error) { return 1; } }',
    'function run(value: number[]):number { try { value.length = -1; throw new Error("x"); } catch(error) { return 1; } }',
    'function run(flag: boolean):number { try { const a = flag ? 1n : 2n; const b = flag ? 0n : 1n; const value = a / b; throw new Error("x"); } catch(error) { return 1; } }',
    'function run():Error { try { throw new Error("x"); } catch(error) { if(error instanceof Error)return error; return new Error("fallback"); } }',
    'function run():number { try { throw new Error("x"); } catch(error) { return error instanceof Error ? error.stack?.length ?? 0 : 0; } }',
    'export {}; type Error = { value: number }; function run():number { try { throw new Error("x"); } catch(error) { return 1; } }'

  ];
  for (const source of sources) withTransformedSource(source, lowerLocalExceptions, (_file, output) => assert.equal(output, source));
});

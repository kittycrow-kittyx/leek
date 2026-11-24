import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { lowerWasm } from "../src/lower/wasm.ts";
import { viewReference } from "../src/lower/views.ts";
import { typedArrays } from "../src/lower/integers.ts";
import { compareTransformedExecution, withTransformedSource } from "./transformed-source.ts";

function lower(source: ts.SourceFile, checker: ts.TypeChecker): string {
  const output = lowerWasm(source, checker);
  writeFileSync(join(dirname(source.fileName), "__leek_wasm_intrinsics.ts"), output.views.map(viewReference).join(""));
  return output.text;
}

test("buffer views preserve aliasing, index conversion, omitted lengths and range failures", () => {
  const source = `function run(offset:number,length:number,explicit:boolean):string {
    const buffer=new ArrayBuffer(32);
    const all=new BigInt64Array(buffer);
    try {
      const view=explicit?new BigInt64Array(buffer,offset,length):new BigInt64Array(buffer,offset);
      if(view.length)view[0]=-7n;
      return JSON.stringify([view.length,view.byteOffset,view.byteLength,view.buffer===buffer,String(all[view.byteOffset/8])]);
    } catch(error) { return error instanceof RangeError?"range":"unexpected"; }
  }
  function empty():number { return ${typedArrays.map(name => "new " + name + "().length").join("+")}; }
  console.log(JSON.stringify([empty(),[-Infinity,-1,-0.5,-0,0,0.5,1,8,8.5,16,32,40,NaN,Infinity,4294967296].flatMap(offset=>[-1,-0.5,0,1,2,4,NaN,Infinity,536870912].flatMap(length=>[false,true].map(explicit=>run(offset,length,explicit))))]));`;
  const output = compareTransformedExecution(source, lower).text;
  assert.match(output, /LeekBufferViewBigInt64Array/);
  assert.match(output, /new Uint8Array\(0\)/);
});

test("shared buffers, local constructor lookalikes and unresolved optional indices retain their source", () => {
  const source = `export {};
  function shared(buffer:SharedArrayBuffer):Uint8Array { return new Uint8Array(buffer); }
  function optional(buffer:ArrayBuffer,offset:number|undefined):Uint8Array { return new Uint8Array(buffer,offset); }
  class Uint16Array { constructor() {} }
  function local():Uint16Array { return new Uint16Array(); }`;
  withTransformedSource(source, lower, (_file, output) => assert.equal(output, source));
});

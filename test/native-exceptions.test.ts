import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { withTransformedSource } from "./transformed-source.ts";
import { exceptionReference, lowerNativeExceptions } from "../src/lower/native-exceptions.ts";

function lower(source: ts.SourceFile, checker: ts.TypeChecker): string {
  writeFileSync(join(dirname(source.fileName), "__leek_wasm_intrinsics.ts"), exceptionReference);
  return lowerNativeExceptions(source, checker, "./__leek_wasm_intrinsics.js").text;
}

test("native error regions preserve exported calls, subclass identity and rethrows", () => {
  const source = `export class Failure extends Error { constructor(readonly code:number){super("failure");} }
export function called(value:number):number {if(value<0)throw new Failure(value);return value;}
export function outer(value:number):number {
 try {try{return called(value);}catch(error){if(error instanceof Failure)throw error;return -1;}}
 catch(error){return error instanceof Failure?error.code:0;}
}`;
  withTransformedSource(source, lower, (_file, output) => {
    assert.doesNotMatch(output, /\btry\b|\bcatch\b|\bthrow\b/);
    assert.match(output, /return called\(value\)/);
    assert.match(output, /LeekRaise\(error\)/);
    assert.match(output, /LeekErrorAs<Failure>\(error\).code/);
  });
});

test("arbitrary thrown values, unknown callbacks, mutation and recursive uncertainty retain their catches", { timeout: 30000 }, () => {
  const cases = [
    'function called():number {throw "text";} function run():number {try{return called();}catch(error){return 0;}}',
    'function run(called:()=>number):number {try{return called();}catch(error){return 0;}}',
    'let called=():number=>{throw new Error("error");}; called=()=>{throw 7;}; function run():number {try{return called();}catch(error){return 0;}}',
    'function a(n:number):number {if(n>0)return b(n-1);throw "text";} function b(n:number):number{return a(n);} function run(n:number):number {try{return a(n)+b(n);}catch(error){return 0;}}',
    'class Base {run():number {throw new Error("base");}} class Derived extends Base {override run():number {throw 1;}} function run(base:Base):number {try{return base.run();}catch(error){return 0;}}',
    'function fail():number {throw 1;} class Failure extends Error {field=fail();} function run():number {try{throw new Failure("error");}catch(error){return 0;}}',
    'class Base {run():number {throw new Error("base");}} class Derived extends Base {override run=():number=>{throw 1;};} function run(base:Base):number {try{return base.run();}catch(error){return 0;}}',
    'class Base {get value():number {throw new Error("base");}} class Derived extends Base {override get value():number {throw 1;}} function run(base:Base):number {try{return base.value;}catch(error){return 0;}}',
    'const object={run:():number=>{throw new Error("error");}};object["run"]=()=>{throw 1;};function run():number {try{return object.run();}catch(error){return 0;}}',
    'function run(value:bigint):bigint {try{return 1n/value;}catch(error){return 0n;}}',
    'function run(value:object):number {try{return +value;}catch(error){return 0;}}',
    'function called():number {throw new Error("error");} async function run():Promise<number> {try{return called();}catch(error){return 0;}}',
    'function called():number {throw new Error("error");} function run():number {try{return called();}catch(error){return 0;}finally{called();}}',
    'function run():number {try{throw new Error("error");}catch(error){error="changed";return typeof error==="string"?error.length:0;}}'
  ];
  for (const source of cases) withTransformedSource(source, lower, (_file, output) => assert.match(output, /\btry\b/));
});


test("native throws preserve terminating flow through async catch and finally", () => {
  const source = `export async function request():Promise<number> {
    try { return 42; }
    catch (error) { throw error instanceof Error ? error : new Error("request failed"); }
    finally { Math.abs(-1); }
  }`;
  withTransformedSource(source, lower, (_file, output) => {
    assert.match(output, /LeekRaise/);
    assert.match(output, /return unreachable\(\)/);
    assert.match(output, /finally/);
  });
});

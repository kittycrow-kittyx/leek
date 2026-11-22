import assert from "node:assert/strict";
import { test } from "node:test";
import { lowerErrorCalls } from "../src/lower/error-calls.ts";
import { lowerLocalExceptions } from "../src/lower/exceptions.ts";
import { compareTransformedExecution, withTransformedSource } from "./transformed-source.ts";

const source = `export {};
const events:string[]=[];
function checked(input:number,label:string):number {
  if(input<0)throw new Error(label);
  let value=input+1;
  if(value>4)value+=3;
  return value;
}
function run(input:number):number {
  const value=50;
  try { return checked(input++,"negative"); }
  catch(error) { events.push(error instanceof Error?error.message:"other"); return input+value; }
}
function other(input:number):number { try { return (checked)(input,"other"); } catch(error) { return error instanceof Error?error.message.length:0; } }
console.log(JSON.stringify([[-7,-1,-0,0,1,4,NaN,Infinity].map(run),[-1,0,7].map(other),events]));`;

test("closed private tail calls expose their original throws and preserve parameter and local scopes", () => {
  const output = compareTransformedExecution(source, lowerErrorCalls).text;
  assert.doesNotMatch(output, /function checked|checked\(/);
  assert.match(output, /throw new Error/);
  assert.match(output, /__leekErrorArgument/);
  const caught = compareTransformedExecution(output, lowerLocalExceptions).text;
  assert.doesNotMatch(caught, /\btry\b|\bthrow\b|\bcatch\b/);
});

test("void tail calls still return from the caller after an ordinary helper exit", () => {
  const input = `export {};
let reached=0;
function checked(input:number):void { if(input<0)throw new Error("negative"); }
function run(input:number):void { try { return checked(input); } catch(error) { reached=error instanceof Error?1:2; } reached+=7; }
run(0); run(-1); console.log(reached);`;
  assert.doesNotMatch(compareTransformedExecution(input, lowerErrorCalls).text, /function checked/);
});

test("escaping, uncaught, stack-observing and foreign lexical contracts retain their original helpers", { timeout: 30000 }, () => {
  const helper='function checked(value:number):number { if(value<0)throw new Error("negative"); return value+1; }';
  const cases=[
    'export {}; '+helper+' const copy=checked; function run(value:number):number { try{return copy(value);}catch(error){return 0;} }',
    'export {}; '+helper+' const object={checked}; function run(value:number):number { try{return checked(value);}catch(error){return 0;} }',
    'export {}; '+helper+' export {checked as publicChecked}; function run(value:number):number { try{return checked(value);}catch(error){return 0;} }',
    'export {}; '+helper+' function run(value:number):number { return checked(value); }',
    'export {}; '+helper+' function run(value:number):number { try{return checked(value);}catch(error){return error instanceof Error?error.stack?.length??0:0;} }',
    'export {}; '+helper+' function run(value:number):Error { try{return new Error(String(checked(value)));}catch(error){return error instanceof Error?error:new Error("other");} }',
    'export {}; '+helper+' async function run(value:number):Promise<number> { try{return checked(value);}catch(error){return 0;} }',
    'export {}; '+helper+' function run(value:number):number { const Error=Number; try{return checked(value);}catch(error){return 0;} }',
    'export {}; '+helper+' function run(value:number):number { try{return checked(value);}catch(error){return 0;}finally{console.log("end");} }',
    'export {}; function checked(value:number):number { var previous:number|undefined; if(value>0)previous=value; if(value<0)throw new Error("negative"); return previous??0; } function run(value:number):number { try{return checked(value);}catch(error){return 0;} }',
    helper+' function run(value:number):number { try{return checked(value);}catch(error){return 0;} }',
    'export {}; type Value=number; function checked(value:number):number { let copy:Value=value; if(copy<0)throw new Error("negative"); return copy; } function run(value:number):number { type Value=string; try{return checked(value);}catch(error){return 0;} }',
    'export {}; '+helper+' function run(value:number):number { try{return checked(value);}catch(error){return 0;} } console.log(eval("checked(1)"));'
  ];
  for(const input of cases) withTransformedSource(input,lowerErrorCalls,(_file,output)=>assert.equal(output,input));
});

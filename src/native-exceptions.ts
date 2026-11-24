import type binaryen from "binaryen";
import type { Parser } from "assemblyscript";
import { nativeExceptionAst } from "./native-exception-ast.ts";

type NativeFunction = binaryen.FunctionInfo;

/** Convert Leek's checked region markers through AssemblyScript's public afterCompile hook. */
export default class NativeExceptions {
  declare binaryen: typeof binaryen;

  afterParse(parser: Parser): void {
    nativeExceptionAst(parser);
  }

  afterCompile(module: binaryen.Module): void {
    const b = this.binaryen;
    const functions: NativeFunction[] = [];
    for (let index = 0; index < module.getNumFunctions(); index++) functions.push(b.getFunctionInfo(module.getFunctionByIndex(index)));
    const markers = new Map(functions.filter(fn => fn.module === "leek.internal").map(fn => [fn.base, fn]));
    if (!markers.size) return;
    for (const name of markers.keys()) if (!["try", "raise", "caught"].includes(name ?? "")) throw new Error("Unknown native exception marker " + name);
    module.setFeatures(module.getFeatures() | b.Features.ExceptionHandling);
    module.addTag("__leek_error", b.i32, b.none);
    module.addGlobal("__leek_caught", b.i32, true, module.i32.const(0));
    const raised = markers.get("raise") ?? null, caught = markers.get("caught") ?? null;
    if (raised) this.replace(module, raised, module.throw("__leek_error", [module.local.get(0, b.i32)]));
    if (caught) this.replace(module, caught, module.global.get("__leek_caught", b.i32));
    const condition = markers.get("try") ?? null;
    const globals: binaryen.GlobalInfo[] = [];
    for (let index = 0; index < module.getNumGlobals(); index++) globals.push(b.getGlobalInfo(module.getGlobalByIndex(index)));
    const stacks = globals.filter(global => global.name.endsWith("/__stack_pointer") && global.mutable && global.type === b.i32);
    const stack = stacks[0] ?? null;
    if (stacks.length !== 1 || !stack) throw new Error("Missing or ambiguous AssemblyScript shadow stack");
    const exported = new Set<string>();
    for (let index = 0; index < module.getNumExports(); index++) {
      const item = b.getExportInfo(module.getExportByIndex(index));
      if (item.kind === b.ExternalKinds.Function) exported.add(item.value);
    }
    for (const fn of functions.filter(fn => !fn.module)) this.regions(module, fn, condition ? condition.name : null, stack.name, exported.has(fn.name));
    // Any marker left outside a structured statement region makes backend validation fail.
    if (condition) module.removeFunction(condition.name);
    if (!module.validate()) throw new Error("Invalid native exception regions");
  }

  private replace(module: binaryen.Module, fn: NativeFunction, body: binaryen.ExpressionRef, vars = fn.vars): void {
    module.removeFunction(fn.name);
    module.addFunction(fn.name, fn.params, fn.results, vars, body);
  }

  private regions(module: binaryen.Module, fn: NativeFunction, condition: string | null, stack: string, exported: boolean): void {
    const b = this.binaryen, vars = [...fn.vars];
    const walk = (expression: binaryen.ExpressionRef): binaryen.ExpressionRef => {
      if (!expression) return 0;
      const id = b.getExpressionId(expression);
      if (id === b.BlockId) {
        const block = b.getExpressionInfo(expression) as binaryen.BlockInfo;
        return module.block(block.name, block.children.map(walk), block.type);
      }
      if (id === b.LoopId) {
        const loop = b.getExpressionInfo(expression) as binaryen.LoopInfo;
        return module.loop(loop.name, walk(loop.body));
      }
      if (id !== b.IfId) return expression;
      const branch = b.getExpressionInfo(expression) as binaryen.IfInfo;
      const marker = b.getExpressionId(branch.condition) === b.CallId ? b.getExpressionInfo(branch.condition) as binaryen.CallInfo : null;
      if (!marker || marker.target !== condition) return module.if(branch.condition, walk(branch.ifTrue), walk(branch.ifFalse));
      if (marker.operands.length) throw new Error("Invalid native catch region");
      const local = b.expandType(fn.params).length + vars.length;
      vars.push(b.i32);
      const body = walk(branch.ifTrue), handler = branch.ifFalse ? walk(branch.ifFalse) : module.nop();
      return module.block(null, [
        module.local.set(local, module.global.get(stack, b.i32)),
        module.try("", body, ["__leek_error"], [module.block(null, [
          module.global.set("__leek_caught", module.i32.pop()),
          // Unwound AS frames cannot pop their manual GC roots. Restore the caller before binding the payload.
          module.global.set(stack, module.local.get(local, b.i32)),
          handler
        ], branch.type)])
      ], branch.type);
    };
    const body = walk(fn.body);
    if (!exported) { this.replace(module, fn, body, vars); return; }
    const local = b.expandType(fn.params).length + vars.length;
    vars.push(b.i32);
    const boundary = "__leek_boundary";
    this.replace(module, fn, module.block(null, [
      module.local.set(local, module.global.get(stack, b.i32)),
      module.try(boundary, body, ["__leek_error"], [module.block(null, [
        module.drop(module.i32.pop()), module.global.set(stack, module.local.get(local, b.i32)), module.rethrow(boundary)
      ], fn.results)])
    ], fn.results), vars);
  }
}

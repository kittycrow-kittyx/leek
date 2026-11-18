import { resolve } from "node:path";
import { target, type Target } from "./project.ts";

export interface Options {
  command: "compile" | "analyse" | "lower";
  source: string;
  selected: Target;
  entry: string;
  validateOnly: boolean;
}

export function options(args: readonly string[], cwd: string): Options {
  let command: Options["command"] = "compile";
  let start = 0;
  let selected: Target = "wasm";
  const first = args[0] ?? "";
  if (first === "analyse" || first === "lower" || first === "compile") {
    command = first;
    start = 1;
  }
  if (first === "wasm") start = 1;
  let entry = "src/main/boot.ts";
  let source = cwd;
  let validateOnly = false;
  for (let i = start; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--validate-only") {
      validateOnly = true;
      continue;
    }
    const split = arg.indexOf("=");
    const name = split < 0 ? arg : arg.slice(0, split);
    if (name !== "--entry" && name !== "--target" && name !== "--source") {
      throw new Error("Unknown option: " + name);
    }
    const value = split < 0 ? (args[++i] ?? "") : arg.slice(split + 1);
    if (!value || value.startsWith("--")) throw new Error("Missing value for " + name);
    switch (name) {
      case "--entry":
        entry = value;
        break;
      case "--source":
        source = resolve(cwd, value);
        break;
      case "--target":
        selected = target(value);
        break;
    }
  }
  return { command, source, selected, entry, validateOnly };
}

import { resolve } from "node:path";
import { target, type Target } from "./project.ts";

export interface Options {
  command: "analyse" | "lower" | "wasm";
  source: string;
  selected: Target;
  entry: string;
  validateOnly: boolean;
}

export function options(args: readonly string[], cwd: string): Options {
  const command = args[0];
  if (command !== "analyse" && command !== "lower" && command !== "wasm") {
    throw new Error("Unknown command: " + command);
  }
  let selected = target("wasm");
  let entry = "src/sh/lex.ts";
  let source = "";
  let validateOnly = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--validate-only" && command === "wasm") {
      validateOnly = true;
      continue;
    }
    if (arg !== "--entry" && arg !== "--target" && arg !== "--source") {
      throw new Error("Unknown option: " + arg);
    }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error("Missing value for " + arg);
    switch (arg) {
      case "--entry":
        entry = value;
        break;
      case "--source":
        source = resolve(cwd, value);
        break;
      case "--target":
        if (command === "wasm") throw new Error("wasm has a fixed target");
        selected = target(value);
        break;
    }
  }
  if (!source) throw new Error("--source PATH is required");
  return { command, source, selected, entry, validateOnly };
}

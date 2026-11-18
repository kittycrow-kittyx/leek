import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadProject } from "@kitty-crow/code-guards/dist/src/project.js";
import { renderFindings } from "@kitty-crow/code-guards/dist/src/diagnostics.js";
import {
  noNestedIf, typeReuse, functionQuality, moduleCohesion, codeHealth, crossModule,
  documentation, repoHygiene, enterpriseLookingNaming, reviewPractices
} from "@kitty-crow/code-guards/dist/src/guards/index.js";
import { failed, resolveExpectations, type Finding } from "@kitty-crow/code-guards/dist/src/model.js";
import { owned, scoped } from "./scope.ts";

async function check(view: string): Promise<number> {
  const loaded = loadProject(resolve(view, "tsconfig.json"));
  const project = { ...loaded, files: loaded.files.filter(file => owned(view, file.fileName)) };
  const raw: Finding[] = [
    ...noNestedIf(project),
    ...await typeReuse(project, true),
    ...await functionQuality(project, true),
    ...await moduleCohesion(project, true),
    ...codeHealth(project, true),
    ...crossModule(project),
    ...await documentation(project),
    ...repoHygiene(project.root),
    ...enterpriseLookingNaming(project, true),
    ...reviewPractices(project, true)
  ];
  const findings = resolveExpectations(project.root, project.files, raw);
  mkdirSync("logs", { recursive: true });
  writeFileSync("logs/code-guards.json", renderFindings(findings, { root: view, format: "json", colour: "never" }) + "\n");
  console.log(renderFindings(findings, { root: view, format: "text", colour: "auto" }));
  return failed(findings, true) ? 1 : 0;
}

process.exitCode = await scoped(check);

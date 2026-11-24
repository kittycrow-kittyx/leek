# Native exception compiler hook

`NativeExceptions` implements AssemblyScript's public transform hooks. `afterParse(parser)` adds native throw and task rejection support. `afterCompile(module)` uses the injected Binaryen instance to replace checked region markers with native exception instructions and remove their temporary imports.

A native tag carries the original Error reference. Each catch restores AssemblyScript's manual shadow stack before binding that payload, so unwound frames cannot retain invalid GC roots. Returns, loop branches and nested handlers retain their compiled control flow. Backend validation rejects any marker left outside a supported region.

Exported function boundaries restore their entry shadow stack before rethrowing uncaught native errors to the host. Later calls can therefore continue after an observed exception without retaining abandoned managed roots.

The transform operates on the compilation workspace and in-memory compiler output. It does not change Baguette, AssemblyScript, Bake or the kernel checkout. It does not turn host traps or arbitrary JavaScript values into Error objects. Canonical async catch lowering and finally remain incomplete.

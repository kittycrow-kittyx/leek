# Source staging

`stageSource` takes the canonical mikuOS checkout, the absolute entry path and a working directory. It checks the complete TypeScript graph and stages its original directory structure, including inherited Thistle and ThistleASM modules outside `mikuOS/src`. A dependency outside the checkout raises `Source dependency outside canonical mikuOS checkout`, including when a symlink resolves there.

The function optionally lowers numeric predicates. The WASM path preserves them until its native extension runs. `LoweredProject` contains the generated project path, staged entry, file count and source-manifest path. `SourceManifest` records schema 1, the relative entry and a sorted array of original module paths and SHA-256 hashes, before any transformation. The manifest describes consumed source, not successful whole-system compilation.

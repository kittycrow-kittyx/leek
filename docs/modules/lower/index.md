# Source staging

`stageSource` takes the mikuOS directory, the absolute entry path and a working directory. It builds a checked TypeScript source graph, copies each owned source file into the staging directory and optionally lowers numeric predicates in implementation files. The WASM compile path preserves the predicates until its native extension runs. Dependencies outside the source tree are rejected. The returned `LoweredProject` contains the generated configuration path, staged entry path and copied file count.

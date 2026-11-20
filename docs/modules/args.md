# Command options

`options` accepts the argument vector and current working directory and returns an `Options` record containing the command, target, source directory, entry, validation flag and optional output directory. `--out-dir` resolves relative to the caller. A null output selects the target's default directory. The defaults select WebAssembly and the canonical mikuOS boot entry. An absent value or unrecognised flag raises an error before compilation begins.

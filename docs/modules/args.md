# Command options

`options` accepts the argument vector and current working directory and returns an `Options` record containing the command, target, source directory, entry and validation flag. The defaults select the WebAssembly target and mikuOS boot entry. An absent value or unrecognised flag raises an error before compilation begins.

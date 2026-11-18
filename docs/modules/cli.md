# CLI entry

The Bun entry point reads arguments, resolves the input source and selects a target-specific build directory. It rejects source inside that directory before removing the previous build output. Source staging precedes backend execution. Analysis requests validate without emission; errors set a failing process exit status.

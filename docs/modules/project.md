# Project configuration

`Target` names the three compilation targets. `target` validates a command-line target string. `sourceEntry` resolves an implementation file within the real mikuOS source directory and rejects paths outside it. `requirePin` and `requireBake` verify immutable Git revisions and reject tracked local modifications. `createProject` writes a no-emit TypeScript configuration for selected entry files, using `json` to create parent directories and serialise the configuration.

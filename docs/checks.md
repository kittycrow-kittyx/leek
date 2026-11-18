# Strict code checks

`npm run guards` checks Leek's own TypeScript, tests, documentation
and repository configuration using all Code Guards rules. Every warning
fails the command. `npm run build` requires this check before type validation.

The scan uses a temporary view of the working tree. Git submodules
remain available for type resolution but their source and documentation
are not examined by the guards. This excludes Baguette, Croissant and
Crust, including the Bake checkouts nested within them.

The report is written to `logs/code-guards.json`. Semantic checks use
the local Code Guards model and may download model weights on first use.

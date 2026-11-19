#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
version="$(bun --version)"
minimum=1.4.5
if [[ "$(printf '%s\n' "$minimum" "$version" | sort -V | head -n 1)" != "$minimum" ]]; then
  printf 'Bun %s or later is required for the pinned upstream lockfiles (found %s).\n' "$minimum" "$version" >&2
  exit 1
fi
git submodule update --init --recursive
bun install --no-save
for compiler in baguette croissant crust; do
  bun install --cwd "$compiler" --frozen-lockfile
  bun install --cwd "$compiler/bake" --frozen-lockfile
done

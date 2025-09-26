#!/bin/bash
set -euo pipefail

# Minimal runner: executes Foundry tests in mercata/evm-tests and prints raw output.

if ! command -v forge >/dev/null 2>&1; then
  echo "[ERROR] forge not found on PATH. Please install Foundry (https://book.getfoundry.sh/getting-started/installation)." >&2
  exit 127
fi

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PROJ_DIR="$ROOT_DIR/mercata/evm-tests"

if [ ! -d "$PROJ_DIR" ]; then
  echo "[ERROR] EVM tests project not found: $PROJ_DIR" >&2
  exit 1
fi

cd "$PROJ_DIR"
echo "[INFO] Running forge tests in $PROJ_DIR" >&2

# Verbose to include a summary line we can grep in comparison.
forge test -vvv | cat



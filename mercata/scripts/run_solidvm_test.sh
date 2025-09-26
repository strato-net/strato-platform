#!/bin/bash
set -euo pipefail

# Minimal runner: compiles and runs SolidVM tests for a single file and prints raw JSON.
# Usage: mercata/scripts/run_solidvm_test.sh <path-to-solidity-file>

if [ $# -lt 1 ]; then
  echo "Usage: $0 <path-to-solidity-file>" >&2
  exit 1
fi

SOL_FILE="$1"

if [ ! -f "$SOL_FILE" ]; then
  echo "File not found: $SOL_FILE" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "[INFO] Running solidvm-cli test (json) on $SOL_FILE" >&2

if ! command -v solid-vm-cli >/dev/null 2>&1; then
  echo "[ERROR] solid-vm-cli not found on PATH. Please install or provide the binary without invoking stack." >&2
  exit 127
fi

# Print JSON result for automation; callers can diff/grep.
solid-vm-cli test json "$SOL_FILE" | cat



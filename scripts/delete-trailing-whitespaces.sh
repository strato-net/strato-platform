#!/usr/bin/env bash

# Usage:
#   ./delete_trailing_whitespaces.sh [-v] [TARGET_DIR]
#   ./delete_trailing_whitespaces.sh --staged [-v]
# Description:
#   Removes trailing whitespace from *.hs, *.js, *.txt files.
#   If --staged is provided, only staged files are processed (for use in pre-commit hooks).
#   If -v is provided, verbose output is shown.

set -euo pipefail

VERBOSE=0
STAGED_MODE=0
TARGET_DIR="."



EXTENSIONS=(
  hs
  html
  js
  json
  lua
  md
  markdown
  nix
  sh
  sol
  tpl
  ts
  txt
  xml
  yaml
  yml
)

# Parse options
while [[ $# -gt 0 ]]; do
  case "$1" in
    -v|--verbose)
      VERBOSE=1
      shift
      ;;
    --staged)
      STAGED_MODE=1
      shift
      ;;
    *)
      TARGET_DIR="$1"
      shift
      ;;
  esac
done

vlog() {
  if [[ "$VERBOSE" -eq 1 ]]; then
    echo "$@"
  fi
}

process_file() {
  local file="$1"
  if git check-ignore -q "$file"; then
    vlog "Skipping ignored file: $file"
    return
  fi

  if [[ -f "$file" ]]; then
    vlog "Processing: $file"
    sed -i.bak -E 's/[[:space:]]+$//' "$file" && rm "$file.bak"
  fi
}

if [[ "$STAGED_MODE" -eq 1 ]]; then
  # Only staged files
  git diff --cached --name-only --diff-filter=ACM | while read -r file; do
    for ext in "${EXTENSIONS[@]}"; do
      if [[ "$file" == *.$ext ]]; then
        process_file "$file"
      fi
    done
  done
else
  # Full directory scan
  cd "$TARGET_DIR"
  if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    echo "Error: $TARGET_DIR is not a Git repository." >&2
    exit 1
  fi

  for ext in "${EXTENSIONS[@]}"; do
    find . -type f -name "*.${ext}" | while read -r file; do
      process_file "$file"
    done
  done
fi

vlog "Done."

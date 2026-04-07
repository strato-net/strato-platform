#!/usr/bin/env bash

# Usage:
#   ./delete_trailing_whitespaces.sh [-v] [--excludeDir DIR]... [TARGET_DIR]
#   ./delete_trailing_whitespaces.sh --staged [-v]
#   ./delete_trailing_whitespaces.sh --check [-v] [--excludeDir DIR]... [TARGET_DIR]
# Description:
#   Removes trailing whitespace from *.hs, *.js, *.txt files.
#   If --staged is provided, only staged files are processed (for use in pre-commit hooks).
#   If --check is provided, exits with status 1 if any files were modified (for CI checks).
#   If -v is provided, verbose output is shown.
#   If --excludeDir is provided (can be repeated), those directories are excluded from processing.

set -euo pipefail

VERBOSE=0
STAGED_MODE=0
CHECK_MODE=0
TARGET_DIR="."
EXCLUDE_DIRS=()

# Extensions that will be included to delete trailing whitespaces
EXTENSIONS=(
  hs
  # html
  # js
  # json
  # lua
  # md
  # markdown
  # nix
  # sh
  sol
  # tpl
  # ts
  # txt
  # xml
  # yaml
  # yml
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
    --check)
      CHECK_MODE=1
      shift
      ;;
    --excludeDir)
      EXCLUDE_DIRS+=("$2")
      shift 2
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

# If in check mode, verify working directory is clean before proceeding
if [[ "$CHECK_MODE" -eq 1 ]]; then
  if ! git diff --exit-code > /dev/null 2>&1; then
    echo "Error: Working directory is not clean. Please commit or stash changes before running with --check." >&2
    echo "This ensures accurate detection of trailing whitespace violations." >&2
    exit 1
  fi
  vlog "Working directory is clean. Proceeding with check..."
fi

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

  # Build find exclude arguments
  FIND_EXCLUDES=()
  for dir in "${EXCLUDE_DIRS[@]+"${EXCLUDE_DIRS[@]}"}"; do
    FIND_EXCLUDES+=(-path "./$dir" -prune -o)
  done

  for ext in "${EXTENSIONS[@]}"; do
    find . ${FIND_EXCLUDES[@]+"${FIND_EXCLUDES[@]}"} -type f -name "*.${ext}" -print | while read -r file; do
      process_file "$file"
    done
  done
fi

vlog "Done."

# Check if --check flag is set and if any files were modified
if [[ "$CHECK_MODE" -eq 1 ]]; then
  if ! git diff --exit-code > /dev/null 2>&1; then
    echo "Error: Trailing whitespace was found and removed. Please commit the changes." >&2
    exit 1
  fi
  vlog "No trailing whitespace found."
fi

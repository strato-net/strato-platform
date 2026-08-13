#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: apply-patches.sh RELAYER_CHECKOUT" >&2
  exit 1
}

RELAYER_CHECKOUT="${1:-}"
[[ -n "$RELAYER_CHECKOUT" ]] || usage
git -C "$RELAYER_CHECKOUT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || usage

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED_COMMIT="4f19338d78949cd237bbaa65fcefd9aef81edb6b"
ACTUAL_COMMIT="$(git -C "$RELAYER_CHECKOUT" rev-parse HEAD)"

if [[ "$ACTUAL_COMMIT" != "$EXPECTED_COMMIT" ]]; then
  echo "Across relayer commit mismatch: expected $EXPECTED_COMMIT, got $ACTUAL_COMMIT" >&2
  exit 1
fi

git -C "$RELAYER_CHECKOUT" apply --check "$SCRIPT_DIR/patches/0001-solidvm-private-chain.patch"
git -C "$RELAYER_CHECKOUT" apply "$SCRIPT_DIR/patches/0001-solidvm-private-chain.patch"

echo "Applied STRATO SolidVM adapter to Across relayer $EXPECTED_COMMIT"

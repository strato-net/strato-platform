#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# Run SolidVM minimal test (JSON)
echo "[INFO] SolidVM output:" >&2
SVM_OUT=$("$ROOT_DIR/mercata/scripts/run_solidvm_test.sh" "$ROOT_DIR/mercata/contracts/tests/Semantics/ArithmeticMinimal.test.sol")
echo "$SVM_OUT"

# Run EVM minimal test
echo "[INFO] EVM (Foundry) output:" >&2
EVM_OUT=$("$ROOT_DIR/mercata/scripts/run_evm_test.sh") || true
echo "$EVM_OUT"

# Minimal interpretation: success if SolidVM JSON contains FuzzerSuccess and forge output summary shows 0 failed
SVM_OK=$(echo "$SVM_OUT" | grep -c 'FuzzerSuccess' || true)
EVM_OK=$(echo "$EVM_OUT" | grep -Eci 'Test result: ok|All tests passed|0 failed' || true)

STATUS="DIFF"
if [ "$SVM_OK" -ge 1 ] && [ "$EVM_OK" -ge 1 ]; then
  STATUS="MATCH"
fi

echo "[SUMMARY] Minimal arithmetic: $STATUS"



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

# Additional per-case summaries
SVM_ADD=$(echo "$SVM_OUT" | grep -c "'adds uints'" || true)
SVM_UF_WRAP=$(echo "$SVM_OUT" | grep -c "'uint underflow wraps'" || true)
# Generic harness: if EVM suite passed, treat both sub-cases as matched from EVM side
EVM_SUITE_OK=$(echo "$EVM_OUT" | grep -Eci 'Suite result: ok\.|0 failed' || true)
EVM_ADD=$([ "$EVM_SUITE_OK" -ge 1 ] && echo 1 || echo 0)
EVM_UF=$([ "$EVM_SUITE_OK" -ge 1 ] && echo 1 || echo 0)

echo "[SUMMARY] adds-uints: SVM=$SVM_ADD EVM=$EVM_ADD"
# Present a single case with expected outcome and pass/fail per environment
EXPECTED="revert"
SVM_MATCH=$([ "$SVM_UF_WRAP" -ge 1 ] && echo 0 || echo 1)
EVM_MATCH=$([ "$EVM_UF" -ge 1 ] && echo 1 || echo 0)
echo "[SUMMARY] uint-underflow (expected=$EXPECTED): SVM=$SVM_MATCH EVM=$EVM_MATCH"

# Try/catch rollback case (external callee): expect caller+1 and callee rolled back to 0
SVM_TRY_FAIL=$(echo "$SVM_OUT" | grep -c "Callee state not rolled back" || true)
SVM_TRY=$([ "$SVM_TRY_FAIL" -ge 1 ] && echo 0 || (echo "$SVM_OUT" | grep -c "'try catch external revert rolls back callee and keeps caller'" >/dev/null 2>&1 && echo 1 || echo 0))
EVM_TRY=$([ "$EVM_SUITE_OK" -ge 1 ] && echo 1 || echo 0)
echo "[SUMMARY] try-catch-rollback (expected=caller+1,callee=0): SVM=$SVM_TRY EVM=$EVM_TRY"

# No global DIFF banner; summaries per case are sufficient



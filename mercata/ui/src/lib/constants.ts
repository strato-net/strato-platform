export const usdstAddress = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010"
export const safetyModuleAddress = "0000000000000000000000000000000000001015"
export const DECIMAL = 18

// ============================================
// Input Validation Patterns
// ============================================

/**
 * Regex pattern for validating decimal input
 * Allows: digits, optional decimal point, digits after decimal
 * Examples: "123", "123.45", "0.1", ".5"
 */
export const DECIMAL_PATTERN = /^\d*\.?\d*$/;

// ============================================
// Transaction fees
// ============================================
export const VOUCHER_TO_USDST_FACTOR = 100n; // 1 voucher (1e18) = 0.01 USDST (1e16)
export const SWAP_FEE = "0.02"; // USDST fee for swap transactions
export const TRANSFER_FEE = "0.01"; // USDST fee for transfer transactions
export const BORROW_FEE = "0.01"; // USDST fee for borrow transactions
export const REPAY_FEE = "0.02"; // USDST fee for repay transactions
export const SUPPLY_COLLATERAL_FEE = "0.02"; // USDST fee for supply collateral transactions
export const WITHDRAW_COLLATERAL_FEE = "0.01"; // USDST fee for withdraw collateral transactions
export const DEPOSIT_FEE = "0.03"; // USDST fee for deposit transactions
export const WITHDRAW_FEE = "0.01"; // USDST fee for withdraw transactions
export const LENDING_DEPOSIT_FEE = "0.02"; // USDST fee for lending pool deposit transactions
export const LENDING_WITHDRAW_FEE = "0.01"; // USDST fee for lending pool withdraw transactions
export const WITHDRAW_USDST_FEE = "0.02"; // USDST fee for withdraw USDST transactions
export const BRIDGE_OUT_FEE = "0.02"; // USDST fee for bridge out transactions
export const SAFETY_STAKE_FEE = "0.02"; // USDST fee for SafetyModule stake transactions
export const SAFETY_REDEEM_FEE = "0.01"; // USDST fee for SafetyModule redeem transactions
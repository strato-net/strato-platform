// TODO: All backend data related constants on a UI side must be fetched from the backend via a /constants route at the app page load time

export const usdstAddress = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010"
export const safetyModuleAddress = "0000000000000000000000000000000000001015"
export const sUsdstAddress = "0000000000000000000000000000000000001016"
export const mUsdstAddress = "000000000000000000000000000000000000100f"
export const cataAddress = "2680dc6693021cd3fefb84351570874fbef8332a"
const STRATO_TOKEN_BY_NETWORK: Record<string, string> = {
  helium: "8ee9a3391e38176feebf5d43cb2c1d6c4f728b04",
  upquark: "2ca3e170e6714282da77815f7864b17f612f5f83",
};

export const getStratoTokenAddress = (): string | undefined => {
  const network = (typeof window !== "undefined"
    ? (window as { ENV?: { NETWORK_NAME?: string } }).ENV?.NETWORK_NAME
    : undefined)?.toLowerCase();
  return network ? STRATO_TOKEN_BY_NETWORK[network] : undefined;
};
export const rewardsAddress = "0000000000000000000000000000000000001020" // TODO: Update with actual deployed address
export const DECIMAL = 18
export const WAD = 10n ** 18n;

// ============================================
// Diversified Vault sunset
// ============================================

/**
 * Last moment users can withdraw from the Diversified Vault before it is
 * deprecated: end of day September 30, 2026, US Eastern (EDT, UTC-4).
 * Drives the countdown in VaultSunsetBanner; dates are rendered in
 * VAULT_WITHDRAWAL_TIME_ZONE so every user sees the same calendar day.
 */
export const VAULT_WITHDRAWAL_DEADLINE = "2026-09-30T23:59:59-04:00";
export const VAULT_WITHDRAWAL_TIME_ZONE = "America/New_York";

// ============================================
// Feature Flags
// ============================================

/**
 * Enable/disable rewards functionality in the UI
 * When false, all rewards-related UI elements will be hidden
 */
export const rewardsEnabled = false;

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
// Contract calls each action makes; the per-call network fee comes from /fees/quote.
export const SWAP_CALLS = 2;
export const TRANSFER_CALLS = 1;
export const BORROW_CALLS = 1;
export const REPAY_CALLS = 2;
export const SUPPLY_COLLATERAL_CALLS = 2;
export const WITHDRAW_COLLATERAL_CALLS = 1;
export const DEPOSIT_CALLS = 3;
export const WITHDRAW_CALLS = 1;
export const LENDING_DEPOSIT_CALLS = 2;
export const LENDING_WITHDRAW_CALLS = 1;
export const BRIDGE_OUT_CALLS = 2;
export const SAFETY_STAKE_CALLS = 2; // approve + stake
export const SAFETY_REDEEM_CALLS = 1;
export const STAKING_STAKE_CALLS = 2; // approve + stake
export const STAKING_ACTION_CALLS = 1; // claim/unstake/withdraw
export const METAL_BUY_CALLS = 2; // approve + mintMetal
export const PSM_MINT_CALLS = 2; // approve + mint
export const PSM_REDEEM_CALLS = 2; // approve + redeem

// ============================================
// Withdrawal limits
// ============================================
export const MIN_USDST_WITHDRAWAL = "10.0"; // Minimum USDST withdrawal amount

// ============================================
// Admin constants
// ============================================

export const ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE = 10; // # of executed issues/page to display on the vote tab
export const ADMIN_VOTE_OPEN_ISSUES_PER_PAGE = 3; // # of open issues/page to display on the vote tab
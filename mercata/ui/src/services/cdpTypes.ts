export interface VaultData {
  asset: string;                               // Collateral asset address
  symbol: string;                              // Asset symbol (e.g., "ETH", "WBTC")
  collateralAmount: string;                    // Raw integer string (wei format)
  collateralAmountDecimals: number;            // Decimals for proper formatting
  collateralValueUSD: string;                  // Raw integer string (18 decimals)
  debtAmount: string;                          // Raw integer string (18 decimals) - USDST debt
  collateralizationRatio: number;              // Ratio of collateral to debt (percentage)
  liquidationRatio: number;                    // Minimum required collateralization ratio
  healthFactor: number;                        // Vault health (CR / liquidationRatio)
  stabilityFeeRate: number;                    // Annual interest rate (percentage)
  borrower?: string;                           // Borrower address (for liquidatable positions)
  scaledDebt: string;                          // Raw scaled debt (wei format) - for precision calculations
  rateAccumulator: string;                     // Current rate accumulator (RAY format) - for precision calculations
}

export interface AssetConfig {
  asset: string;                          // Asset address
  symbol: string;                         // Asset symbol
  liquidationRatio: number;               // Liquidation threshold (decimal percentage)
  minCR: number;                          // Min collateral ratio for user actions (decimal percentage)
  liquidationPenaltyBps: number;          // Liquidation penalty in basis points
  closeFactorBps: number;                 // Max liquidation percentage in basis points
  stabilityFeeRate: number;               // Annual interest rate (percentage)
  debtFloor: string;                      // Minimum vault debt amount
  debtCeiling: string;                    // Maximum total protocol debt for this asset
  unitScale: string;                      // Price scaling factor
  isPaused: boolean;                      // Whether asset operations are paused
  isSupported: boolean;                   // Whether asset is supported
}

// ============================================================================
// Mint Planning Types
// ============================================================================

/**
 * PlanItem for UI display (decimal values)
 * Derived from Allocation with decimal string values for display
 */
export interface PlanItem {
  assetAddress: string;
  symbol: string;
  depositAmount: string;
  depositAmountUSD: string;
  mintAmount: string;
  stabilityFeeRate: number;
  existingCollateralUSD: string;
  userBalance: string;
  userBalanceUSD: string;
}

export interface TransactionResponse {
  status: string;                         // Transaction status (e.g., "success")
  hash: string;                           // Transaction hash
}

export interface BadDebt {
  asset: string;                          // Asset address
  badDebt: string;                        // Raw integer string (wei format, 18 decimals)
  symbol?: string;                        // Token symbol (e.g., "WBTC", "ETHST")
}

export interface JuniorNote {
  owner: string;                          // Account that owns the note
  capUSDST: string;                       // Remaining payout cap in wei (18 decimals)
  entryIndex: string;                     // Earning baseline (RAY format, 27 decimals)
  claimableAmount: string;                // Real-time claimable amount calculated via gas-free Cirrus queries
}

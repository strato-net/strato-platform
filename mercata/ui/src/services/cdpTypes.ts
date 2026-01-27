export interface Vault {
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
 * PlanItem for UI display (wei values for precision)
 * Stores raw wei amounts as strings for precision calculations
 * Wei members use native token decimals (e.g., 18 for ETH, 8 for WBTC)
 * USD values are calculated on-the-fly from wei amounts and oracle prices
 */
export interface PlanItem {
  assetAddress: string;
  symbol: string;
  depositAmountWei: string;              // Deposit amount in wei (native token decimals)
  mintAmountWei: string;                 // Mint amount in wei (18 decimals for USDST)
  stabilityFeeRateWei: string;           // Annual stability fee rate in wei (18 decimals, e.g., 0.05e18 = 5%)
  existingCollateralWei: string;         // Existing collateral in vault in wei (native token decimals)
  userBalanceWei: string;                // User's available balance in wei (native token decimals)
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

/**
 * CDP (Collateralized Debt Position) Type Definitions
 * 
 * This file contains all data structures, interfaces, and types related to CDP operations.
 */

// ============================================================================
// Vault Data Structures
// ============================================================================

/**
 * Vault data returned from the backend API
 */
export interface VaultData {
  asset: string;                               // Collateral asset address
  symbol: string;                              // Asset symbol (e.g., "ETH", "WBTC")
  collateralAmount: string;                    // Raw integer string (wei format)
  collateralAmountDecimals: number;            // Decimals for proper formatting
  collateralValueUSD: string;                  // Raw integer string (18 decimals)
  debtAmount: string;                          // Raw integer string (18 decimals)
  debtValueUSD: string;                        // Raw integer string (18 decimals)
  collateralizationRatio: number;              // Ratio of collateral to debt (percentage)
  liquidationRatio: number;                    // Minimum required collateralization ratio
  healthFactor: number;                        // Vault health (CR / liquidationRatio)
  stabilityFeeRate: number;                    // Annual interest rate (percentage)
  health: "healthy" | "warning" | "danger";    // Health status indicator
  borrower?: string;                           // Borrower address (for liquidatable positions)
  // Raw data for precision calculations
  scaledDebt: string;                          // Raw scaled debt (wei format)
  rateAccumulator: string;                     // Current rate accumulator (RAY format)
}

/**
 * Asset configuration for CDP operations
 */
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

/**
 * Vault candidate for mint planning (from backend API)
 * Represents both existing vaults and potential vaults that can be opened
 */
export interface VaultCandidate {
  assetAddress: string;
  symbol: string;
  collateralAmount: string; // raw integer string
  collateralAmountDecimals: number;
  scaledDebt: string; // raw integer string
  rateAccumulator: string; // RAY format
  userNonCollateralBalance: string; // raw integer string
  oraclePrice: string; // raw integer string (18 decimals)
  currentTotalDebt: string; // raw integer string (18 decimals)
  liquidationRatio: number; // percentage
  minCR: number; // percentage
  stabilityFeeRate: number; // annual percentage
  debtFloor: string;
  debtCeiling: string;
  unitScale: string;
  isPaused: boolean;
  isSupported: boolean;
}

/**
 * Vault candidate input for mint planning algorithm
 * Same structure as VaultCandidate, used as input to the planning algorithm
 */
export interface VaultCandidateInput {
  assetAddress: string;
  symbol: string;
  collateralAmount: string;
  collateralAmountDecimals: number;
  scaledDebt: string;
  rateAccumulator: string;
  userNonCollateralBalance: string;
  oraclePrice: string;
  currentTotalDebt: string;
  liquidationRatio: number;
  minCR: number;
  stabilityFeeRate: number;
  debtFloor: string;
  debtCeiling: string;
  unitScale: string;
  isPaused: boolean;
  isSupported: boolean;
}

/**
 * Vault input for mint planning algorithm
 * Internal representation used by the planning algorithm with BigInt values
 */
export interface VaultInput {
  assetAddress: string;
  liquidationRatioWad: bigint;
  minCRWad: bigint;
  stabilityFeeRateRay: bigint;
  stabilityFeeRateAnnual: number;
  debtFloorUSD: bigint;
  debtCeilingUSD: bigint;
  unitScale: bigint;
  rateAccumulatorRay: bigint;
  totalScaledDebt: bigint;
  userVaultCollateral: bigint;
  userVaultScaledDebt: bigint;
  userAssetBalance: bigint;
  oraclePrice: bigint;
}

// ============================================================================
// Mint Planning Types
// ============================================================================

/**
 * Planned transaction for mint operations
 */
export type PlannedTransaction =
  | {
      type: "DEPOSIT";
      assetAddress: string;
      amountCollateral: bigint;
    }
  | {
      type: "MINT";
      assetAddress: string;
      amountUSD: bigint;
    };

/**
 * Result of mint planning algorithm
 */
export interface MintPlanResult {
  transactions: PlannedTransaction[];
  totalPlannedMintUSD: bigint;
  targetMintUSD: bigint;
  perAssetSummary: {
    [assetAddress: string]: {
      plannedDeposit: bigint;
      plannedMint: bigint;
      effectiveTargetCRWad: bigint;
      stabilityFeeRateRay: bigint;
    };
  };
}

/**
 * Allocation result from optimal mint planning
 * Represents the planned allocation for a specific asset
 */
export interface Allocation {
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

// ============================================================================
// Transaction & Response Types
// ============================================================================

/**
 * Transaction response from backend API
 */
export interface TransactionResponse {
  status: string;                         // Transaction status (e.g., "success")
  hash: string;                           // Transaction hash
}

// ============================================================================
// Protocol State Types
// ============================================================================

/**
 * Bad debt information for an asset
 */
export interface BadDebt {
  asset: string;                          // Asset address
  badDebt: string;                        // Raw integer string (wei format, 18 decimals)
  symbol?: string;                        // Token symbol (e.g., "WBTC", "ETHST")
}

/**
 * Junior note information for CDP protocol
 */
export interface JuniorNote {
  owner: string;                          // Account that owns the note
  capUSDST: string;                       // Remaining payout cap in wei (18 decimals)
  entryIndex: string;                     // Earning baseline (RAY format, 27 decimals)
  claimableAmount: string;                // Real-time claimable amount calculated via gas-free Cirrus queries
}

export type UNITS = bigint;
export type USD = number;
export type DECIMAL = number;
export type ADDRESS = string;

export interface Allocation {
  assetAddress: ADDRESS;
  depositAmount: UNITS;
  mintAmount: UNITS;
}

export interface VaultCandidate {
  vaultConfig: VaultConfig;
  oraclePrice: UNITS;
  currentCollateral: UNITS;
  potentialCollateral: UNITS;
  currentDebt: UNITS;
  globalDebt: UNITS;
  allocation?: Allocation;
}

interface VaultConfig {
  assetAddress: ADDRESS;
  symbol: string;
  unitScale: UNITS;
  minCR: UNITS;
  liquidationRatio: UNITS;
  stabilityFeeRate: UNITS;
  debtFloor: UNITS;
  debtCeiling: UNITS;
}

export interface PositionMetrics {
  totalMinted: number;
  weightedAverageFee: number;
  totalCollateralUSD: number;
  overallHealthFactor: number;
}

export interface EarningsInfo {
  pts: number;
  display: string;
  change?: number;
}

export type RiskLevel = 'Low Risk' | 'Moderate Risk' | 'High Risk';

export interface RiskInfo {
  level: RiskLevel;
  color: string;
  factor: number;
}

export interface FeeCalculation {
  transactionCount: number;
  totalFees: number;
  depositFees: number;
  mintFees: number;
}

export interface MintCalculation {
  unitScale: UNITS;
  mintAmount: UNITS;
  mintAmountUSD: USD;
  availableToMint: UNITS;
  totalMaxMint: UNITS;
  weightedAverageAPR: number;
}

// // Transaction types
// export type TransactionType = 'deposit' | 'mint' | 'withdraw' | 'repay';

// export interface Transaction {
//   type: TransactionType;
//   asset: ADDRESS;
//   amount: string;
//   symbol: string;
// }

// export interface TransactionProgress {
//   symbol: string;
//   type: 'deposit' | 'mint';
//   amount: string;
//   status: 'pending' | 'processing' | 'completed' | 'error';
//   hash?: string;
//   error?: string;
// }

// // ============================================================================
// // Vault Data Types
// // ============================================================================

// export interface Vault {
//   asset: ADDRESS;
//   symbol: string;
//   collateralAmountWei: string;
//   collateralAmountDecimals: number;
//   collateralValueUSDWei: string;
//   debtAmountWei: string;
//   collateralizationRatio: number;
//   liquidationRatio: number;
//   healthFactor: number;
//   stabilityFeeRate: number;
//   borrower?: ADDRESS;
//   scaledDebtWei: string;
//   rateAccumulator: string;
// }
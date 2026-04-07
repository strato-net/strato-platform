export type UNITS = bigint;
export type WAD = bigint;
export type USD = number;
export type DECIMAL = number;
export type RAY = bigint;
export type WEI = bigint;
export type ADDRESS = string;
export interface VaultCandidate {
  vaultConfig: VaultConfig;
  oraclePrice: WEI;
  currentCollateral: UNITS;
  potentialCollateral: UNITS;
  currentDebt: WEI;
  globalDebt: WEI;
  allocation?: Allocation;
}

export interface Allocation {
  assetAddress: ADDRESS;
  depositAmount: UNITS;
  mintAmount: WEI;
}

interface VaultConfig {
  assetAddress: ADDRESS;
  symbol: string;
  unitScale: UNITS;
  minCR: WAD;
  liquidationRatio: WAD;
  stabilityFeeRate: RAY;
  debtFloor: WEI;
  debtCeiling: WEI;
}

export interface PositionMetrics {
  totalDebt: USD;
  weightedAverageFee: number;
  totalCollateralUSD: USD;
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
  mintAmount: WEI;
  mintAmountUSD: USD;
  availableToMint: WEI;
  totalMaxMint: WEI;
  weightedAverageAPR: number;
}

// Transaction types
export type TransactionType = 'deposit' | 'mint' | 'withdraw' | 'repay';

export interface Transaction {
  type: TransactionType;
  asset: ADDRESS;
  amount: string;
  symbol: string;
}

export interface TransactionProgress {
  symbol: string;
  type: 'deposit' | 'mint';
  amount: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  hash?: string;
  error?: string;
}

// // ============================================================================
// // Vault Data Types
// // ============================================================================

// export interface Vault {
//   asset: ADDRESS;
//   symbol: string;
//   collateralAmountUnits: string;
//   collateralAmountDecimals: number;
//   collateralValueUSDUnits: string;
//   debtAmountUnits: string;
//   collateralizationRatio: number;
//   liquidationRatio: number;
//   healthFactor: number;
//   stabilityFeeRate: number;
//   borrower?: ADDRESS;
//   scaledDebtUnits: string;
//   rateAccumulator: string;
// }
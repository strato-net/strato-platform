import type { PlanItem } from '@/services/cdpTypes';
import type { VaultCandidate } from '@/services/mintPlanService';

// Transaction types
export type TransactionType = 'deposit' | 'mint' | 'withdraw' | 'repay';

export interface Transaction {
  type: TransactionType;
  asset: string;
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

// Allocation types
export interface AllocationInput {
  assetAddress: string;
  depositAmount: bigint;
  mintAmount: bigint;
}

export interface AllocationAmounts {
  depositAmounts: Record<string, string>;
  mintAmounts: Record<string, string>;
}

// Position types
export interface PositionMetrics {
  totalMinted: number;
  weightedAverageFee: number;
  totalCollateralUSD: number;
  overallHealthFactor: number;
}

// Earnings types
export interface EarningsInfo {
  pts: number;
  display: string;
  change?: number;
}

// Risk types
export type RiskLevel = 'Low Risk' | 'Moderate Risk' | 'High Risk';

export interface RiskInfo {
  level: RiskLevel;
  color: string;
  factor: number;
}

// Fee calculation types
export interface FeeCalculation {
  transactionCount: number;
  totalFees: number;
  depositFees: number;
  mintFees: number;
}

// Mint calculation types
export interface MintCalculation {
  mintAmount: number;
  mintAmountWei: bigint;
  availableToMint: string;
  totalMaxMintWei: bigint;
  weightedAverageAPR: number;
}

// Re-export commonly used types
export type { PlanItem, VaultCandidate };


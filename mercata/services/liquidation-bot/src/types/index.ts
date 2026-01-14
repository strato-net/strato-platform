export interface LiquidatablePosition {
  user: string;
  asset: string;
  collateralAmount: string;
  debtAmount: string;
  collateralizationRatio: string;
  liquidationRatio: string;
  estimatedProfit: string;
  positionType: 'CDP' | 'LENDING';
}

export interface LiquidationResult {
  success: boolean;
  positionId: string;
  user: string;
  asset: string;
  debtRepaid: string;
  collateralSeized: string;
  profit: string;
  txHash?: string;
  error?: string;
}

export interface VaultInvestor {
  address: string;
  shares: string;
  investedAmount: string;
  currentValue: string;
  joinedAt: number;
}

export interface VaultMetrics {
  totalShares: string;
  totalValue: string;
  totalInvestors: number;
  totalLiquidations: number;
  totalProfits: string;
  performanceFee: string;
  roi: number;
}

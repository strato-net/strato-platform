export type LoopRouteType = "cdp_loop";

export interface CDPAssetConfig {
  address: string;
  decimals: number;
  price: string;
  minCR: number;
  liquidationRatio: number;
  stabilityFeeRate: number;
  debtFloor: string;
  debtCeiling: string;
}

export interface CDPBootstrapData {
  stabilityAPR: number;
  minCR: number;
  liquidationRatio: number;
  assets: CDPAssetConfig[];
}

export interface LoopRouteOpportunity {
  asset: string;
  symbol: string;
  baseYieldAPR: number;
  swapPoolUSDSTLiquidity: string;
  swapFeeBps: number;
}

export interface LoopBootstrapResponse {
  swapFeeBps: number;
  routes: {
    cdp: CDPBootstrapData;
  };
  opportunities: LoopRouteOpportunity[];
}

export interface LoopExecuteRequest {
  routeType: LoopRouteType;
  asset: string;
  amount: string;
  targetLeverage: number;
  maxSlippageBps?: number;
}

export interface LoopExecuteResponse {
  txHash?: string;
}

export interface LoopPositionEntry {
  asset: string;
  symbol: string;
  collateral: string;
  collateralUSD: string;
  debt: string;
  healthFactor: number;
  effectiveLTV: number;
  leverage: number;
  estimatedCarryAPR: number;
  collateralizationRatio: number;
}

export interface LoopPositionResponse {
  cdp: LoopPositionEntry[];
}

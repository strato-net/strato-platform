export type LoopRouteType = "cdp_loop";

export interface CarryMetrics {
  exposureMultiple: number;
  effectiveLTV: number;
  grossCarryAPR: number;
  feeDrag: number;
  netCarryAPR: number;
  swapImpactPct: number;
  netCarryWithImpactAPR: number;
  healthFactor: number;
}

export interface LoopRouteOpportunity {
  asset: string;
  symbol: string;
  baseYieldAPR: number;
  swapPoolAddress: string;
  swapPoolUSDSTLiquidity: string;
  swapFeeRate: number;
  maxSwapPerLeg: string;
  cdpCarry: CarryMetrics | null;
}

export interface LoopBootstrapResponse {
  version: string;
  timestamp: string;
  networkId: string;
  gasFeePerStep: string;
  swapFeeBps: number;
  routes: {
    cdp: {
      usdstAddress: string;
      stabilityAPR: number;
      minCR: number;
      liquidationRatio: number;
      assets: Array<{
        address: string;
        symbol: string;
        decimals: number;
        price: string;
        minCR: number;
        liquidationRatio: number;
        stabilityFeeRate: number;
        debtFloor: string;
        debtCeiling: string;
        unitScale: string;
        isPaused: boolean;
      }>;
    };
  };
  opportunities: LoopRouteOpportunity[];
}

export interface LoopExecuteRequest {
  routeType: LoopRouteType;
  asset: string;
  amount: string;
  targetLeverage: number;
  maxSlippageBps?: number;
  minHealthFactor?: number;
  clientQuoteHash?: string;
}

export interface LoopExecuteResponse {
  txHash?: string;
  error?: string;
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

export type LoopRouteType = "lending_loop" | "cdp_loop";
export type LoopUnwindMode = "partial" | "full";

export interface LoopRouteOpportunity {
  asset: string;
  symbol: string;
  baseYieldAPR: number;
  swapPoolAddress: string;
  swapPoolUSDSTLiquidity: string;
  swapFeeRate: number;
  maxSwapPerLeg: string;
  lendingCarry: {
    exposureMultiple: number;
    effectiveLTV: number;
    grossCarryAPR: number;
    feeDrag: number;
    netCarryAPR: number;
    swapImpactPct: number;
    netCarryWithImpactAPR: number;
    healthFactor: number;
  } | null;
  cdpCarry: {
    exposureMultiple: number;
    effectiveLTV: number;
    grossCarryAPR: number;
    feeDrag: number;
    netCarryAPR: number;
    swapImpactPct: number;
    netCarryWithImpactAPR: number;
    healthFactor: number;
  } | null;
}

export interface LoopBootstrapResponse {
  version: string;
  timestamp: string;
  networkId: string;
  gasFeePerStep: string;
  maxLoops: number;
  swapFeeBps: number;
  routes: {
    lending: {
      borrowableAsset: string;
      borrowableSymbol: string;
      borrowAPR: number;
      ltvBps: number;
      liquidationThresholdBps: number;
      assets: Array<{ address: string; symbol: string; decimals: number; isPaused: boolean }>;
    };
    cdp: {
      usdstAddress: string;
      stabilityAPR: number;
      minCR: number;
      liquidationRatio: number;
      assets: Array<{ address: string; symbol: string; decimals: number; isPaused: boolean }>;
    };
  };
  opportunities: LoopRouteOpportunity[];
}

export interface LoopExecuteRequest {
  routeType: LoopRouteType;
  asset: string;
  amount: string;
  loops: number;
  minHealthFactor?: number;
  clientQuoteHash?: string;
  dryRun?: boolean;
}

export interface LoopExecuteResponse {
  requestId: string;
  routeType: LoopRouteType;
  bootstrapVersion: string;
  plannedSteps: number;
  executedSteps: Array<{
    step: number;
    action: string;
    status: "success" | "failed" | "skipped";
    txHash?: string;
    error?: string;
  }>;
  terminalState: {
    totalCollateral: string;
    totalDebt: string;
    effectiveLeverage: string;
    healthFactor: string;
  };
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
}

export interface LoopPositionResponse {
  lending: LoopPositionEntry[];
  cdp: Array<LoopPositionEntry & { collateralizationRatio: number }>;
}

export interface LoopUnwindRequest {
  routeType: LoopRouteType;
  asset: string;
  steps: number | "all";
  minHealthFactor?: number;
}

export interface LoopHistoryItem {
  requestId: string;
  routeType: LoopRouteType;
  asset: string;
  amount: string;
  loops: number;
  status: "success" | "partial" | "failed";
  txHashes: string[];
  timestamp: string;
}

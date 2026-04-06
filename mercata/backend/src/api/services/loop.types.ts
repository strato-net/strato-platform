export type LoopRouteType = "lending_loop" | "cdp_loop";

export interface LoopExecuteRequest {
  routeType: LoopRouteType;
  asset: string;
  amount: string;
  loops: number;
  minHealthFactor?: number;
  clientQuoteHash?: string;
  idempotencyKey?: string;
  dryRun?: boolean;
}

export interface LoopStepResult {
  step: number;
  action: string;
  status: "success" | "failed" | "skipped";
  txHash?: string;
  error?: string;
}

export interface LoopExecuteResponse {
  requestId: string;
  routeType: LoopRouteType;
  bootstrapVersion: string;
  plannedSteps: number;
  executedSteps: LoopStepResult[];
  terminalState: {
    totalCollateral: string;
    totalDebt: string;
    effectiveLeverage: string;
    healthFactor: string;
  };
}

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

export interface LendingBootstrapData {
  borrowableAsset: string;
  borrowableSymbol: string;
  borrowAPR: number;
  ltvBps: number;
  liquidationThresholdBps: number;
  assets: {
    address: string;
    symbol: string;
    decimals: number;
    price: string;
    ltv: number;
    liquidationThreshold: number;
    isPaused: boolean;
  }[];
  exchangeRate: string;
  availableLiquidity: string;
}

export interface CDPBootstrapData {
  usdstAddress: string;
  stabilityAPR: number;
  minCR: number;
  liquidationRatio: number;
  assets: {
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
  }[];
}

export interface LoopBootstrapResponse {
  version: string;
  timestamp: string;
  networkId: string;
  gasFeePerStep: string;
  maxLoops: number;
  swapFeeBps: number;
  routes: {
    lending: LendingBootstrapData;
    cdp: CDPBootstrapData;
  };
  opportunities: LoopRouteOpportunity[];
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
  cdp: (LoopPositionEntry & { collateralizationRatio: number })[];
}

export interface LoopUnwindRequest {
  routeType: LoopRouteType;
  asset: string;
  steps: number | "all";
  minHealthFactor?: number;
  idempotencyKey?: string;
}

export interface LoopHistoryEntry {
  requestId: string;
  routeType: LoopRouteType;
  asset: string;
  amount: string;
  loops: number;
  status: "success" | "partial" | "failed";
  txHashes: string[];
  timestamp: string;
}

export const LOOP_CONSTANTS = {
  MAX_LOOPS: 5,
  MIN_HEALTH_FACTOR: 1.15,
  DEFAULT_HEALTH_FACTOR: 1.5,
} as const;

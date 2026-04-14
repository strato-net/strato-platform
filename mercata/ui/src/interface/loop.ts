export type LoopRouteType = "cdp" | "lending";
export type LoopUnwindMode = "partial" | "full";

export interface LoopBootstrapRequest {
  routeType: LoopRouteType;
  asset: string;
  collateralAmount: string;
  leverage: number;
  iterations: number;
}

export interface LoopStepPreview {
  key?: string;
  label: string;
  description?: string;
  txCount?: number;
  estimatedFeeUsdst?: string;
}

export interface LoopBootstrapResponse {
  routeType?: LoopRouteType;
  asset?: string;
  leverage?: number;
  iterations?: number;
  estimatedCarryApr?: number | string;
  adjustedCarryApr?: number | string;
  healthFactor?: number | string;
  liquidationBufferPct?: number | string;
  collateralValueUsd?: number | string;
  debtValueUsd?: number | string;
  totalTxCount?: number;
  estimatedTxCostUsdst?: number | string;
  warnings?: string[];
  steps?: LoopStepPreview[];
}

export interface LoopExecuteResponse {
  status?: string;
  message?: string;
  jobId?: string;
  txHashes?: string[];
}

export interface LoopPositionResponse {
  routeType?: LoopRouteType;
  asset?: string;
  isOpen?: boolean;
  leverage?: number | string;
  healthFactor?: number | string;
  liquidationBufferPct?: number | string;
  collateralValueUsd?: number | string;
  debtValueUsd?: number | string;
  netCarryApr?: number | string;
  updatedAt?: string;
}

export interface LoopUnwindRequest {
  routeType: LoopRouteType;
  asset: string;
  mode: LoopUnwindMode;
  unwindPercent?: number;
}

export interface LoopHistoryItem {
  id?: string;
  status?: string;
  routeType?: LoopRouteType;
  asset?: string;
  action?: string;
  leverage?: number | string;
  iterations?: number;
  txCount?: number;
  timestamp?: string;
  summary?: string;
}

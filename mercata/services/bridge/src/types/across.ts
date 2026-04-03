// -------------------- Chain & Token Config --------------------

export interface AcrossTokenConfig {
  address: string;
  symbol: string;
  decimals: number;
}

export interface AcrossChainTokens {
  [symbol: string]: AcrossTokenConfig;
}

// -------------------- API: /suggested-fees --------------------

export interface AcrossQuoteParams {
  inputToken: string;
  outputToken: string;
  originChainId: number;
  destinationChainId: number;
  amount: string;
}

export interface AcrossTokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
}

export interface AcrossFeeBreakdown {
  pct: string;
  total: string;
}

export interface AcrossLimits {
  minDeposit: string;
  maxDeposit: string;
  maxDepositInstant: string;
  maxDepositShortDelay: string;
  recommendedDepositInstant: string;
}

export interface AcrossQuoteResponse {
  estimatedFillTimeSec: number;
  timestamp: string;
  exclusiveRelayer: string;
  exclusivityDeadline: number;
  spokePoolAddress: string;
  destinationSpokePoolAddress: string;
  fillDeadline: string;
  outputAmount: string;
  totalRelayFee: AcrossFeeBreakdown;
  relayerCapitalFee: AcrossFeeBreakdown;
  relayerGasFee: AcrossFeeBreakdown;
  lpFee: AcrossFeeBreakdown;
  limits: AcrossLimits;
  inputToken: AcrossTokenInfo;
  outputToken: AcrossTokenInfo;
  isAmountTooLow: boolean;
}

// -------------------- API: /limits --------------------

export type AcrossLimitsResponse = AcrossLimits;

// -------------------- API: /available-routes --------------------

export interface AcrossRoute {
  originChainId: number;
  originToken: string;
  destinationChainId: number;
  destinationToken: string;
  originTokenSymbol: string;
  destinationTokenSymbol: string;
  isNative: boolean;
}

// -------------------- API: /deposit/status --------------------

export interface AcrossDepositStatusParams {
  originChainId: number;
  depositTxHash: string;
}

export interface AcrossDepositStatusResponse {
  status: "pending" | "filled";
  fillTx?: string;
  destinationChainId?: number;
}

// -------------------- depositV3 --------------------

export interface AcrossDepositParams {
  originChainId: number;
  destinationChainId: number;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  recipient: string;
  message?: string;
}

export interface AcrossDepositResult {
  txHash: string;
  originChainId: number;
  destinationChainId: number;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  outputAmount: string;
  recipient: string;
  depositor: string;
  quoteTimestamp: number;
  fillDeadline: number;
}

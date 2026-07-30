/** Config returned by GET /api/credit-card/watcher-config */
export interface WatcherConfig {
  id: string;
  userAddress: string;
  destinationChainId: string;
  externalToken: string;
  cardWalletAddress: string;
  thresholdAmount: string;
  topUpAmount: string;
  cooldownMinutes: number;
  enabled: boolean;
  lastTopUpAt?: string;
}

/** Body for POST /api/credit-card/execute-top-up */
export interface ExecuteTopUpParams {
  userAddress: string;
  stratoTokenAmount: string;
  externalChainId: string;
  externalRecipient: string;
  externalToken: string;
}

import { createContext } from "react";

export type YieldVaultInfo = {
  key: string;
  configured: boolean;
  deployed: boolean;
  vaultAddress: string;
  assetAddress: string;
  assetSymbol: string;
  shareSymbol: string;
  name: string;
  decimals: number;
  totalAssets: string;
  idleAssets: string;
  deployedAssets: string;
  totalShares: string;
  exchangeRate: string;
  assetPriceWad: string;
  tvlUsd: string;
  apy: string;
  paused: boolean;
  minIdleBps: string;
  totalQueuedShares: string;
  totalClaimableAssets: string;
  strategyHoldings: {
    strategyAddress: string;
    deployedAssets: string;
    composition: {
      tokenAddress: string;
      tokenSymbol: string;
      decimals: number;
      amount: string;
    }[];
    usdstDebt: string;
    baseApyPct: number | null;
    offChainUsdWad: string;
    recentOutflows: {
      tokenAddress: string;
      tokenSymbol: string;
      decimals: number;
      amount: string;
      timestampMs: number;
    }[];
  }[];
  maxDeploy: string;
  minIdleRequirement: string;
  deployBlockedReason: string | null;
};

export type YieldVaultPendingWithdrawal = {
  requestId: string;
  shares: string;
  estimatedAssets: string;
  receiver: string;
};

export type YieldVaultUserInfo = YieldVaultInfo & {
  walletAssets: string;
  userShares: string;
  redeemableAssets: string;
  positionUsd: string;
  maxDeposit: string;
  maxRedeem: string;
  maxWithdraw: string;
  claimableAssets: string;
  activeRequestId: string;
  pendingWithdrawal: YieldVaultPendingWithdrawal | null;
};

export type YieldVaultContextType = {
  vaults: Record<string, YieldVaultInfo | null>;
  userVaults: Record<string, YieldVaultUserInfo | null>;
  loading: boolean;
  refreshVaults: () => Promise<void>;
  getVaultInfo: (key: string) => YieldVaultInfo | null;
  getUserVaultInfo: (key: string) => YieldVaultUserInfo | null;
};

export const VAULT_KEYS = ["eth-carry", "wbtc-carry", "usdc-yield"] as const;

export const YieldVaultContext = createContext<YieldVaultContextType | undefined>(undefined);

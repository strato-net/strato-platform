import { BridgeToken, BridgeTransactionResponse, BridgeTransactionTab, WithdrawalRequestParams, DepositActionRequestParams, TransactionResponse, WithdrawalSummaryResponse } from "@mercata/shared-types";

export interface BalanceResponse {
  balance: string;
}

export interface BridgeResponse {
  success: boolean;
  data?: TransactionResponse;
}

export type NetworkSummary = {
  chainId: string;
  chainName: string;
  enabled: boolean;
  depositRouter: string;
};

export type BridgeContextType = {
  loading: boolean;
  error: string | null;
  availableNetworks: NetworkSummary[];
  bridgeableTokens: BridgeToken[]; // All route tokens for the selected network (filter by isDefaultRoute)
  selectedNetwork: string | null;
  selectedToken: BridgeToken | null;
  // Navigation state for bridge transactions
  targetTransactionTab: BridgeTransactionTab | null;
  setTargetTransactionTab: (tab: BridgeTransactionTab | null) => void;
  requestWithdrawal: (params: WithdrawalRequestParams) => Promise<BridgeResponse>;
  requestDepositAction: (params: DepositActionRequestParams) => Promise<TransactionResponse>;
  useBalance: (tokenAddress: string | null) => {
    data: { 
      balance: string; 
      formatted: string;
    } | null;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
  };
  setSelectedNetwork: (networkName: string) => void;
  setSelectedToken: (token: BridgeToken | null) => void;
  loadNetworksAndTokens: () => Promise<void>;
  // Bridge transaction functions
  fetchDepositTransactions: (rawParams?: Record<string, string | undefined>, context?: string) => Promise<BridgeTransactionResponse>;
  fetchWithdrawTransactions: (rawParams?: Record<string, string | undefined>, context?: string) => Promise<BridgeTransactionResponse>;
  // Withdrawal summary
  withdrawalSummary: WithdrawalSummaryResponse | null;
  loadingWithdrawalSummary: boolean;
  fetchWithdrawalSummary: (showLoading?: boolean) => Promise<void>;
  // Deposit refresh trigger
  depositRefreshKey: number;
  triggerDepositRefresh: () => void;
  // Withdrawal refresh trigger
  withdrawalRefreshKey: number;
  triggerWithdrawalRefresh: () => void;
};

export interface ContractValidationResult {
  isValid: boolean;
  error?: string;
  isAllowed?: boolean;
  minAmount?: string;
  depositAmount?: string;
}

// Transaction Detail Interfaces
export interface DepositTransaction {
  block_timestamp: string;
  chainId?: number;
  from: string;
  to: string;
  amount: string;
  txHash?: string;
  token?: string;
  key?: string;
  depositStatus?: string;
  tokenSymbol?: string;
  ethTokenName?: string;
  ethTokenSymbol?: string;
  ethTokenAddress?: string;
}

export interface WithdrawTransaction {
  block_timestamp: string;
  from: string;
  to: string;
  destChainId?: number;
  amount: string;
  txHash?: string;
  token?: string;
  key?: string;
  withdrawalStatus?: string;
  tokenSymbol?: string;
  ethTokenSymbol?: string;
  ethTokenAddress?: string;
}

export interface TokenParams {
  tokenAddress: string;
  userAddress: string;
  chainId: string;
  decimals?: string;
}

export interface ValidationParams {
  depositRouterAddress: string;
  amount: string;
  decimals: string;
  chainId: string;
  tokenAddress: string;
  targetStratoToken: string;
}

export interface Permit2ApprovalResult {
  isApproved: boolean;
  currentAllowance: bigint;
}

export interface Permit2Params {
  token: string;
  owner: string;
  amount: bigint;
  chainId: string;
}

export interface Permit2Domain {
  name: string;
  chainId: number;
  verifyingContract: `0x${string}`;
}

export interface Permit2Types {
  [key: string]: Array<{ name: string; type: string }>;
}

// Chain Management Types
export interface ChainHints {
  name?: string;
  rpcUrl?: string;
  blockExplorerUrl?: string;
  nativeSymbol?: string;
  nativeName?: string;
  decimals?: number;
}

export type SupportedChainId =
  | 1
  | 11155111
  | 137
  | 80002
  | 10
  | 8453
  | 84532
  | 42161
  | 42170
  | 56
  | 43114;

// Error handling types
export interface BridgeError {
  code?: string;
  reason?: string;
  data?: `0x${string}`;
  message: string;
  userMessage: string;
}

export interface BridgeContext {
  selectedToken: BridgeToken;
  selectedNetwork: string;
  amount: string;
  userAddress: string;
  address: string;
  activeChainId: string;
  depositRouter: string;
  depositAmount: bigint;
  isNative: boolean;
}

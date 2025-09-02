// Bridge Types
export interface Token {
  stratoToken: string;           // Key: address of the STRATO token
  stratoTokenName: string;       // From TokenFactory (not in AssetInfo)
  stratoTokenSymbol: string;     // From TokenFactory (not in AssetInfo)
  externalChainId: string;       // Matches AssetInfo.externalChainId
  permissions: number;           // Matches AssetInfo.permissions
  externalName: string;          // Matches AssetInfo.externalName
  externalToken: string;         // Matches AssetInfo.externalToken
  externalSymbol: string;        // Matches AssetInfo.externalSymbol
  externalDecimals: string;      // Matches AssetInfo.externalDecimals
  maxPerTx: string;              // Matches AssetInfo.maxPerTx
}

export interface NetworkConfig {
  chainId: string;
  chainName: string;
  rpcUrl: string;
  explorer: string;
  depositRouter: string;
}

// Bridge Context Types
export interface BridgeOutParams {
  stratoTokenAmount: string;
  externalRecipient: string;
  stratoToken: string;
  externalChainId: string;
}

export interface BalanceResponse {
  balance: string;
  tokenLimit?: {
    maxPerTx: string;
    isUnlimited: boolean;
  };
}

export interface BridgeResponse {
  success: boolean;
  data?: unknown;
}

export interface NetworkConfigFromAPI {
  externalChainId: number;
  chainInfo: {
    custody: string;
    enabled: boolean;
    chainName: string;
    depositRouter: string;
    lastProcessedBlock: string;
  };
}

export type NetworkSummary = {
  chainId: string;
  chainName: string;
  enabled: boolean;
  depositRouter: string;
};

// Bridge Transaction Types
export interface BridgeTransaction {
  transaction_hash: string;
  block_timestamp: string;
  chainId?: number;
  from: string;
  to: string;
  amount: string;
  txHash?: string;
  token?: string;
  key?: string;
  depositStatus?: string;
  withdrawalStatus?: string;
  tokenSymbol?: string;
  ethTokenName?: string;
  ethTokenSymbol?: string;
  ethTokenAddress?: string;
}

export interface BridgeTransactionResponse {
  data: BridgeTransaction[];
  totalCount: number;
}

export type BridgeContextType = {
  loading: boolean;
  error: string | null;
  availableNetworks: NetworkSummary[];
  bridgeableTokens: Token[];
  selectedNetwork: string | null;
  selectedToken: Token | null;
  bridgeOut: (params: BridgeOutParams) => Promise<BridgeResponse>;
  redeemOut: (params: BridgeOutParams) => Promise<BridgeResponse>;
  useBalance: (tokenAddress: string | null) => {
    data: { 
      balance: string; 
      formatted: string;
      tokenLimit?: {
        maxPerTx: string;
        isUnlimited: boolean;
      };
    } | null;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
  };
  setSelectedNetwork: (networkName: string) => void;
  setSelectedToken: (token: Token | null) => void;
  loadNetworksAndTokens: () => Promise<void>;
  // Bridge transaction functions
  fetchDepositTransactions: (rawParams?: Record<string, string | undefined>) => Promise<BridgeTransactionResponse>;
  fetchWithdrawTransactions: (rawParams?: Record<string, string | undefined>) => Promise<BridgeTransactionResponse>;
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
  transaction_hash: string;
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
  transaction_hash: string;
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
  selectedToken: Token;
  selectedNetwork: string;
  amount: string;
  userAddress: string;
  address: string;
  activeChainId: string;
  depositRouter: string;
  depositAmount: bigint;
  isNative: boolean;
}

// Bridge Types
export interface Token {
  stratoTokenAddress: string;
  stratoTokenName: string;
  stratoTokenSymbol: string;
  chainId: string;
  enabled: boolean;
  extName: string;
  extToken: string;
  extSymbol: string;
  extDecimals: string;
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
  amount: string;
  destAddress: string;
  token: string;
  destChainId: string;
}

export interface BalanceResponse {
  balance: string;
}

export interface BridgeResponse {
  success: boolean;
  data?: unknown;
}

export interface NetworkConfigFromAPI {
  chainId: string;
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

export type BridgeContextType = {
  loading: boolean;
  error: string | null;
  availableNetworks: NetworkSummary[];
  bridgeableTokens: Token[];
  selectedNetwork: string | null;
  selectedToken: Token | null;
  bridgeOut: (params: BridgeOutParams) => Promise<BridgeResponse>;
  getBalance: (tokenAddress: string) => Promise<BalanceResponse>;
  getTokenLimit: (tokenAddress: string) => Promise<any>;
  setSelectedNetwork: (networkName: string) => void;
  setSelectedToken: (token: Token | null) => void;
  loadNetworksAndTokens: () => Promise<void>;
};

export interface ContractValidationResult {
  isValid: boolean;
  error?: string;
  isAllowed?: boolean;
  minAmount?: string;
  depositAmount?: string;
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

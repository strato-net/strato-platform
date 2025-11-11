// ---------------- Utility Types ----------------
export type NonEmptyArray<T> = [T, ...T[]];

// ---------------- Transaction Types ----------------
export type TxPayloadArgs = Record<string, any>;

export interface FunctionTx {
  payload: {
    contractName: string;
    contractAddress: string;
    method: string;
    args: TxPayloadArgs;
  };
  type: "FUNCTION";
}

export interface BuiltTx {
  txs: FunctionTx[];
  txParams: {
    gasLimit: number;
    gasPrice: number;
  };
}

export interface FunctionInput {
  contractName: string;
  contractAddress: string;
  method: string;
  args: TxPayloadArgs;
}

// ---------------- Strato Helper Types ----------------
export interface TxResult {
  status: string;
  hash: string;
  txResult?: { message?: string };
  error?: string;
  message?: string;
}

export interface TxResponse {
  status: "Success" | "Failure" | "Pending";
  hash: string;
}

// ---------------- API Types ----------------
export interface RetryConfig {
  maxAttempts?: number;
  logPrefix?: string;
}

export interface ClientOptions {
  authenticated?: boolean;
  timeout?: number;
  logPrefix?: string;
}

export interface ApiClient {
  get<T = any>(url: string, config?: any): Promise<T>;
  post<T = any>(url: string, data?: any, config?: any): Promise<T>;
}

// ---------------- Safe Service Types ----------------
export type TxType = "eth" | "erc20";

export interface SafeTransactionResult {
  safeTxHash: string;
}

// Clear types for Safe transaction data
export interface SafeTransactionData {
  safeAddress: string;
  safeTransactionData: any;
  safeTxHash: string;
  senderAddress: string;
  senderSignature: any;
  nonce: number;
  externalChainId: number;
}

export interface PreparedWithdrawal {
  externalTokenAmount: string;
  externalRecipient: string;
  type: TxType;
  externalToken: string;
  externalChainId: number;
  withdrawalId: string;
}

export interface DepositArgs {
  externalChainId: string | number;
  externalSender: string;
  externalToken: string;
  externalTokenAmount: string;
  externalTxHash: string;
  stratoRecipient: string;
}

export interface ConfirmDepositArgs {
  externalChainId: string | number;
  externalTxHash: string;
  stratoRecipient: string;
  verified: boolean;
}

export interface DepositInfo {
  bridgeStatus: string; // NONE / INITIATED / COMPLETED / ABORTED
  externalSender: string;
  externalToken: string;
  requestedAt: string;
  stratoRecipient: string;
  stratoToken: string;
  stratoTokenAmount: string;
  timestamp: string;

  externalChainId: string | number;
  externalTxHash: string;
  externalDecimals: number;
  depositRouter: string;
}


export interface WithdrawalInfo {
  bridgeStatus: string; // NONE / INITIATED / COMPLETED / ABORTED
  custodyTxHash: string;
  externalChainId: string | number;
  externalRecipient: string;
  externalToken: string;
  externalTokenAmount: string;
  requestedAt: string;
  stratoSender: string;
  stratoToken: string;
  stratoTokenAmount: string;
  timestamp: string;

  withdrawalId: string;
}

export interface ChainInfo {
  externalChainId: number;
  depositRouter: string;
  lastProcessedBlock: number;
  enabled: boolean;
  custody: string;
  chainName: string;
}

export interface AssetInfo {
  enabled: boolean;
  stratoToken: string;
  externalName: string;
  externalToken: string;
  externalSymbol: string;
  externalChainId: number;
  externalDecimals: number;
  maxPerWithdrawal: number;
}

export interface BridgeInfo {
  DECIMAL_PLACES: number;
  USDST_ADDRESS: string;
  WITHDRAWAL_ABORT_DELAY: number;
  _owner: string;
  depositsPaused: boolean;
  tokenFactory: string;
  withdrawalCounter: number;
  withdrawalsPaused: boolean;
}

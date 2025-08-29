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

export interface AssetInfo {
  externalToken: string;
  externalDecimals: number;
  enabled: boolean;
  externalChainId: string;

  //TODO: remove these
  extToken: string;
  extDecimals: number;
  chainId: string;
}

export interface PreparedWithdrawal {
  externalTokenAmount: string;
  externalRecipient: string;
  type: TxType;
  externalToken: string;
  externalChainId: number;
}

export interface Deposit {
  externalChainId: string | number;
  externalTxHash: string;
  stratoToken: string;
  stratoRecipient: string;
  stratoTokenAmount: string;
  externalSender: string;
  externalToken: string;
  externalTokenAmount: string;
  externalDecimals: number;
  depositId: string;
  mintUSDST: boolean;
  depositRouter: string;
}

export interface Withdrawal {

  withdrawalId?: string;
  safeTxHash?: string;
  // NEW:
  externalChainId: string | number;   // Chain where Custody resides
  externalRecipient: string; // External recipient address
  stratoToken: string;       // Token to burn
  stratoTokenAmount: string; // Escrowed amount of stratoToken
  stratoSender: string;      // STRATO sender
  bridgeStatus: string; // NONE / INITIATED / PENDING_REVIEW / ...
  mintUSDST: boolean;           // true = burn USDST, false = unwrap token
  timestamp: string;        // timestamp of the withdrawal
  requestedAt: string;      // timestamp of the withdrawal request (for abort accuracy)
}

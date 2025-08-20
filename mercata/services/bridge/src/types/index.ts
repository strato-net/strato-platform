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
  extToken: string;
  extDecimals: number;
  enabled: boolean;
  chainId: string;
}

export interface PreparedWithdrawal {
  amount: string;
  toAddress: string;
  type: TxType;
  tokenAddress: string;
  chainId: number;
}

export interface Deposit {
  srcChainId: string | number;
  srcTxHash: string;
  token: string;
  amount: string;
  user: string;
  from: string;
}

export interface Withdrawal {
  destChainId: string | number;
  token: string;
  dest?: string;
  destAddress?: string;
  amount: string | bigint;
  id?: string;
  withdrawalId?: string;
  safeTxHash?: string;
}

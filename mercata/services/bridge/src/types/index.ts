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

export type PollingPredicate<T> = (result: T) => boolean;
export type PollingAction<T> = () => Promise<T>;

export interface PollingOptions {
  timeout?: number;
  interval?: number;
}

// ---------------- Bridge Event Types ----------------
export interface BridgeInEvent {
  type: string;
  data: {
    transactionHash: string;
    from: string;
    to: string;
    value: string;
  };
}

export interface BridgeOutEvent {
  type: string;
  data: {
    transactionHash: string;
    from: string;
    to: string;
    value: string;
  };
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

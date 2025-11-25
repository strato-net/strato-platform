export type NonEmptyArray<T> = [T, ...T[]];

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

export interface ProtocolEvent {
  contractAddress: string;
  eventName: string;
  user: string;
  amount: string;
  blockNumber?: number;
  txHash?: string;
  timestamp?: string;
}

export interface RewardsAction {
  activityId: number;
  user: string;
  amount: string;
  actionType: "deposit" | "withdraw" | "occurred";
}

export interface ActivityInfo {
  activityId: number;
  name: string;
  activityType: "Position" | "OneTime";
  emissionRate: string;
  allowedCaller: string;
}

export interface EventMapping {
  contractAddress: string;
  eventName: string;
  activityId: number;
  actionType: "deposit" | "withdraw" | "occurred";
}

export interface CirrusEvent {
  id: number;
  address: string;
  block_hash: string;
  block_timestamp: string;
  block_number: string;
  transaction_sender: string;
  event_index: number;
  event_name: string;
  attributes: Record<string, any>;
}


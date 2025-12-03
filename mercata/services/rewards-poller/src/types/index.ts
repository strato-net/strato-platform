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
  address: string;
  event_name: string;
  block_number: number;
  event_index: number;
  transaction_sender: string;
  amount: string;
}

export interface RewardsAction {
  sourceContract: string;
  eventName: string;
  user: string;
  amount: string;
  blockNumber: number;
  eventIndex: number;
}

export interface EventCursor {
  blockNumber: number;
  eventIndex: number;
}

export interface CirrusEvent {
  address: string;
  block_number: string;
  block_timestamp: string;
  event_index: number;
  event_name: string;
  transaction_sender: string;
  attributes: Record<string, any>;
}


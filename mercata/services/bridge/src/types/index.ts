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

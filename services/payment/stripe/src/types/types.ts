// ---------------- Oauth Types ----------------
export interface TokenCache {
  serviceToken?: string;
  expiresAt?: number;
}

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

export interface DeployTx {
  payload: {
    contract: string;
    src: string | Record<string, string>;
    args: TxPayloadArgs;
  };
  type: "CONTRACT";
}

export interface BuiltTx {
  txs: (DeployTx | FunctionTx)[];
  txParams: {
    gasLimit: number;
    gasPrice: number;
  };
}

export interface DeployInput {
  contractName: string;
  source: Record<string, string>;
  args: TxPayloadArgs;
}

export interface FunctionInput {
  contractName: string;
  contractAddress: string;
  method: string;
  args: TxPayloadArgs;
}
export type TxInput = DeployInput | FunctionInput;

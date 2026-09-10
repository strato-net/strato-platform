// ---------------- Oauth Types ----------------
export interface TokenCache {
  serviceToken?: string;
  expiresAt?: number;
}

export interface StratoKeyResponse {
  address?: string;
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
  source: string;
  args: TxPayloadArgs;
}

export interface FunctionInput {
  contractName: string;
  contractAddress: string;
  method: string;
  args: TxPayloadArgs;
}
export type TxInput = DeployInput | FunctionInput;

export type EdgeKind =
  | "SWAP"
  | "PSM_MINT"
  | "FORGE"
  | "SAVE"
  | "YIELD_VAULT_DEPOSIT";

export interface RouteEdge {
  kind: EdgeKind;
  tokenIn: string;
  tokenOut: string;
  target?: string;
  feeBps?: number;
  maxBalance?: string;
  mintCap?: string;
  totalMinted?: string;
  priceIn?: string;
  priceOut?: string;
  vaultDeposit?: VaultDepositState;
  outputName?: string;
  outputSymbol?: string;
  outputDecimals?: number;
}

export interface RouteTopologyCache {
  key: string;
  expiresAt: number;
  edges: Promise<RouteEdge[]>;
}

export interface VaultDepositState {
  totalShares: string;
  pricingAssets: string;
  maxDeposit: string;
}

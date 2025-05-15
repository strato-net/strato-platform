// txBuilder.ts
import { DeployInput, FunctionInput, BuiltTx } from "../types/types";

const DEFAULT_GAS_PARAMS = {
  gasLimit: 32_100_000_000,
  gasPrice: 1,
};

export function buildDeployTx({
  contractName,
  source,
  args,
}: DeployInput): BuiltTx {
  const tx = {
    type: "CONTRACT" as const,
    payload: { contract: contractName, src: source, args },
  };

  return {
    txs: [tx],
    txParams: DEFAULT_GAS_PARAMS,
  };
}

export function buildFunctionTx({
  contractName,
  contractAddress,
  method,
  args,
}: FunctionInput): BuiltTx {
  const tx = {
    type: "FUNCTION" as const,
    payload: { contractName, contractAddress, method, args },
  };

  return {
    txs: [tx],
    txParams: DEFAULT_GAS_PARAMS,
  };
}
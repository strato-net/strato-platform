// txBuilder.ts
import { FunctionInput, BuiltTx } from "../types";

const DEFAULT_GAS_PARAMS = {
  gasLimit: 32_100_000_000,
  gasPrice: 1,
};

export function buildFunctionTx(
  inputs: FunctionInput | FunctionInput[]
): BuiltTx {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];
  
  const txs = inputArray.map(input => ({
    type: "FUNCTION" as const,
    payload: {
      contractName: input.contractName,
      contractAddress: input.contractAddress,
      method: input.method,
      args: input.args,
    },
  }));

  return {
    txs,
    txParams: DEFAULT_GAS_PARAMS,
  };
}

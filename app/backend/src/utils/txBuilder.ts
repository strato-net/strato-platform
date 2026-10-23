// txBuilder.ts
import { DeployInput, FunctionInput, BuiltTx } from "../types/types";
import { ensureFeeCoverage } from "../api/services/fees.service";

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

export async function buildFunctionTx(
  inputs: FunctionInput | FunctionInput[],
  userAddress?: string,
  accessToken?: string
): Promise<BuiltTx> {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];

  if (!inputArray.length) {
    throw new Error("At least one transaction input is required");
  }

  if (userAddress && accessToken) {
    await ensureFeeCoverage(inputArray.length, accessToken, userAddress);
  }

  const txs = inputArray.map((input) => ({
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

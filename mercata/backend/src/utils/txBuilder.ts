// txBuilder.ts
import { DeployInput, FunctionInput, BuiltTx } from "../types/types";
import { constants } from "../config/constants";
import { cirrus } from "./mercataApiHelper";

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
  
  if (inputArray.length === 0) {
    throw new Error('At least one transaction input is required');
  }
  
  if (userAddress && accessToken) {
    const requiredFee = constants.GAS_FEE_WEI * BigInt(inputArray.length);
    
    const response = await cirrus.get(
      accessToken,
      `/${constants.Token}-_balances`,
      {
        params: {
          address: `eq.${constants.USDST}`,
          key: `eq.${userAddress}`,
          value: `gte.${requiredFee.toString()}`
        }
      }
    );
    
    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
      const requiredUSD = Number(requiredFee) / 1e18;
      throw new Error(`Insufficient USDST balance (required: ${requiredUSD} USDST for transaction)`);
    }
  }
  
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
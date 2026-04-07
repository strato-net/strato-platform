import { logError } from "../utils/logger";
import { config } from "../config";
import { execute } from "../utils/stratoHelper";

export interface DepositActionRequestParams {
  userAddress: string;
  externalChainId: string;
  externalTxHash: string;
  action: number;
  targetToken: string;
}

export const requestDepositAction = async (
  params: DepositActionRequestParams,
) => {
  try {
    return await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "requestDepositAction",
      args: {
        user: params.userAddress,
        externalChainId: params.externalChainId,
        externalTxHash: params.externalTxHash,
        action: params.action,
        targetToken: params.targetToken,
      },
    });
  } catch (error) {
    logError("DepositActionService", error as Error);
    throw error;
  }
};

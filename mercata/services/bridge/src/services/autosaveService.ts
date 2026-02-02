import { logError } from "../utils/logger";
import { config } from "../config";
import { execute } from "../utils/stratoHelper";

export interface AutoSaveRequestParams {
  userAddress: string;
  externalChainId: string;
  externalTxHash: string;
}

export const requestAutoSave = async (
  params: AutoSaveRequestParams,
) => {
  try {
    return await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "requestAutoSave",
      args: {
        user: params.userAddress,
        externalChainId: params.externalChainId,
        externalTxHash: params.externalTxHash,
      },
    });
  } catch (error) {
    logError("AutoSaveService", error as Error);
    throw error;
  }
};
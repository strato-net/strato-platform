import { config } from "../config";
import { execute } from "../utils/stratoHelper";
import { logError } from "../utils/logger";
import { retryWithBackoff } from "../utils/retry";
import { NonEmptyArray, RewardsAction, FunctionInput } from "../types";

const ACTION_TYPE_MAP: Record<"deposit" | "withdraw" | "occurred", number> = {
  deposit: 0,
  withdraw: 1,
  occurred: 2,
};

export const batchHandleAction = async (
  actions: NonEmptyArray<RewardsAction>,
): Promise<void> => {
  const contractActions = actions.map((action) => ({
    activityId: action.activityId,
    user: action.user,
    amount: action.amount,
    actionType: ACTION_TYPE_MAP[action.actionType],
  }));

  const input: FunctionInput = {
    contractName: "Rewards",
    contractAddress: config.rewards.address!,
    method: "batchHandleAction",
    args: {
      actions: contractActions,
    },
  };

  try {
    await retryWithBackoff(
      () => execute(input),
      "RewardsService-batchHandleAction",
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    if (errorMessage.includes("dup key") || errorMessage.includes("already processed")) {
      return;
    }
    
    logError("RewardsService", error as Error, {
      operation: "batchHandleAction",
      actionCount: actions.length,
    });
    throw error;
  }
};


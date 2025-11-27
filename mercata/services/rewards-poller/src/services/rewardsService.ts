import { config } from "../config";
import { execute } from "../utils/stratoHelper";
import { retryWithBackoff } from "../utils/retry";
import { NonEmptyArray, RewardsAction, FunctionInput } from "../types";

export const batchHandleAction = async (
  actions: NonEmptyArray<RewardsAction>,
): Promise<void> => {
  const contractActions = actions.map((action) => ({
    sourceContract: action.sourceContract,
    eventName: action.eventName,
    user: action.user,
    amount: action.amount,
    blockNumber: action.blockNumber,
    eventIndex: action.eventIndex,
  }));

  const input: FunctionInput = {
    contractName: "Rewards",
    contractAddress: config.rewards.address!,
    method: "batchHandleAction",
    args: {
      actions: contractActions,
    },
  };

  await retryWithBackoff(
    () => execute(input),
    "RewardsService-batchHandleAction",
  );
};


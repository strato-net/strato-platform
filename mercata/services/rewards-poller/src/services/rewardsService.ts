import { config } from "../config";
import { execute } from "../utils/stratoHelper";
import { retryWithBackoff } from "../utils/retry";
import { NonEmptyArray, RewardsAction, FunctionInput } from "../types";

export const batchHandleAction = async (
  actions: NonEmptyArray<RewardsAction>
): Promise<void> => {
  const sourceContracts = actions.map((action) => action.sourceContract);
  const eventNames = actions.map((action) => action.eventName);
  const users = actions.map((action) => action.user);
  const amounts = actions.map((action) => action.amount);
  const blockNumbers = actions.map((action) => action.blockNumber);
  const eventIndexes = actions.map((action) => action.eventIndex);

  const input: FunctionInput = {
    contractName: "Rewards",
    contractAddress: config.rewards.address!,
    method: "batchHandleAction",
    args: {
      sourceContracts,
      eventNames,
      users,
      amounts,
      blockNumbers,
      eventIndexes,
    },
  };

  await retryWithBackoff(
    () => execute(input),
    "RewardsService-batchHandleAction"
  );
};

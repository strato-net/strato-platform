import { config } from "../config";
import { execute } from "../utils/stratoHelper";
import { retryWithBackoff } from "../utils/retry";
import { NonEmptyArray, RewardsAction, BonusCredit, FunctionInput } from "../types";

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

export const batchAddBonus = async (
  credits: NonEmptyArray<BonusCredit>
): Promise<void> => {
  const users = credits.map((c) => c.user);
  const amounts = credits.map((c) => c.amount);

  const input: FunctionInput = {
    contractName: "Rewards",
    contractAddress: config.rewards.address!,
    method: "batchAddBonus",
    args: { users, amounts },
  };

  await retryWithBackoff(
    () => execute(input),
    "RewardsService-batchAddBonus"
  );
};

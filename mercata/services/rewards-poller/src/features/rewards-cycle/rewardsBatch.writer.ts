import { config } from "../../infra/config/runtimeConfig";
import { execute } from "../../infra/http/strato.client";
import { retryWithBackoff } from "../../infra/http/retry.policy";
import { NonEmptyArray, RewardsAction, BonusCredit, FunctionInput } from "../../shared/types";

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
  const sourceContracts = credits.map((c) => c.sourceContract);
  const eventNames = credits.map((c) => c.eventName);
  const users = credits.map((c) => c.user);
  const amounts = credits.map((c) => c.amount);
  const blockNumbers = credits.map((c) => c.blockNumber);
  const eventIndexes = credits.map((c) => c.eventIndex);

  const input: FunctionInput = {
    contractName: "Rewards",
    contractAddress: config.rewards.address!,
    method: "batchHandleAction",
    args: { sourceContracts, eventNames, users, amounts, blockNumbers, eventIndexes },
  };

  await execute(input);
};

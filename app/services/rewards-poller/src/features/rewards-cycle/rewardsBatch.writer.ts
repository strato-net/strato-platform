import { config } from "../../infra/config/runtimeConfig";
import { execute } from "../../infra/http/strato.client";
import { retryWithBackoff } from "../../infra/http/retry.policy";
import { NonEmptyArray, RewardsAction, BonusCredit, FunctionInput } from "../../shared/types";

// A Rewards batch handler run through the AdminRegistry, which executes it at once for this
// whitelisted poller. castVoteOnIssue's variadic args carry no ABI, so each is hinted with its type
const rewardsCall = (method: string, typedArgs: [string, unknown[]][]): FunctionInput => ({
  contractName: "AdminRegistry",
  contractAddress: config.adminRegistry.address,
  method: "castVoteOnIssue",
  args: {
    _target: config.rewards.address!,
    _func: method,
    _args: typedArgs.map(([type, value]) => ({ type, value })),
  },
});

export const batchHandleAction = async (
  actions: NonEmptyArray<RewardsAction>
): Promise<void> => {
  const sourceContracts = actions.map((action) => action.sourceContract);
  const eventNames = actions.map((action) => action.eventName);
  const users = actions.map((action) => action.user);
  const amounts = actions.map((action) => action.amount);
  const blockNumbers = actions.map((action) => action.blockNumber);
  const eventIndexes = actions.map((action) => action.eventIndex);

  const input = rewardsCall("batchHandleAction", [
    ["address[]", sourceContracts],
    ["string[]", eventNames],
    ["address[]", users],
    ["uint256[]", amounts],
    ["uint256[]", blockNumbers],
    ["uint256[]", eventIndexes],
  ]);

  await retryWithBackoff(
    () => execute(input),
    "RewardsService-batchHandleAction"
  );
};

export const batchHandleTransfer = async (
  actions: NonEmptyArray<RewardsAction>
): Promise<void> => {
  const input = rewardsCall("batchHandleTransfer", [
    ["address[]", actions.map((action) => action.sourceContract)],
    ["string[]", actions.map((action) => action.eventName)],
    ["address[]", actions.map((action) => action.user)],
    ["address[]", actions.map((action) => action.recipient)],
    ["uint256[]", actions.map((action) => action.amount)],
    ["uint256[]", actions.map((action) => action.blockNumber)],
    ["uint256[]", actions.map((action) => action.eventIndex)],
  ]);

  await retryWithBackoff(
    () => execute(input),
    "RewardsService-batchHandleTransfer"
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

  const input = rewardsCall("batchHandleAction", [
    ["address[]", sourceContracts],
    ["string[]", eventNames],
    ["address[]", users],
    ["uint256[]", amounts],
    ["uint256[]", blockNumbers],
    ["uint256[]", eventIndexes],
  ]);

  await execute(input);
};

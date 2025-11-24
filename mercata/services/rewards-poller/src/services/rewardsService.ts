import { config } from "../config";
import { execute } from "../utils/stratoHelper";
import { logInfo, logError } from "../utils/logger";
import { retryWithBackoff } from "../utils/retry";
import { NonEmptyArray, RewardsAction, FunctionInput } from "../types";

export const depositBatch = async (
  actions: NonEmptyArray<RewardsAction>,
): Promise<void> => {
  const inputs: FunctionInput[] = actions.map((action) => ({
    contractName: "Rewards",
    contractAddress: config.rewards.address!,
    method: "deposit",
    args: {
      activityId: action.activityId,
      user: action.user,
      amount: action.amount,
    },
  }));

  try {
    await retryWithBackoff(
      () => execute(inputs),
      "RewardsService-deposit",
    );

    logInfo(
      "RewardsService",
      `Successfully deposited ${actions.length} actions`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    if (errorMessage.includes("dup key") || errorMessage.includes("already processed")) {
      logInfo(
        "RewardsService",
        `Actions already processed by another server: ${actions.length} actions`,
      );
      return;
    }
    
    logError("RewardsService", error as Error, {
      operation: "depositBatch",
      actionCount: actions.length,
    });
    throw error;
  }
};

export const withdrawBatch = async (
  actions: NonEmptyArray<RewardsAction>,
): Promise<void> => {
  const inputs: FunctionInput[] = actions.map((action) => ({
    contractName: "Rewards",
    contractAddress: config.rewards.address!,
    method: "withdraw",
    args: {
      activityId: action.activityId,
      user: action.user,
      amount: action.amount,
    },
  }));

  try {
    await retryWithBackoff(
      () => execute(inputs),
      "RewardsService-withdraw",
    );

    logInfo(
      "RewardsService",
      `Successfully withdrew ${actions.length} actions`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    if (errorMessage.includes("dup key") || errorMessage.includes("already processed")) {
      logInfo(
        "RewardsService",
        `Actions already processed by another server: ${actions.length} actions`,
      );
      return;
    }
    
    logError("RewardsService", error as Error, {
      operation: "withdrawBatch",
      actionCount: actions.length,
    });
    throw error;
  }
};

export const occurredBatch = async (
  actions: NonEmptyArray<RewardsAction>,
): Promise<void> => {
  const inputs: FunctionInput[] = actions.map((action) => ({
    contractName: "Rewards",
    contractAddress: config.rewards.address!,
    method: "occurred",
    args: {
      activityId: action.activityId,
      user: action.user,
      amount: action.amount,
    },
  }));

  try {
    await retryWithBackoff(
      () => execute(inputs),
      "RewardsService-occurred",
    );

    logInfo(
      "RewardsService",
      `Successfully recorded ${actions.length} occurred actions`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    if (errorMessage.includes("dup key") || errorMessage.includes("already processed")) {
      logInfo(
        "RewardsService",
        `Actions already processed by another server: ${actions.length} actions`,
      );
      return;
    }
    
    logError("RewardsService", error as Error, {
      operation: "occurredBatch",
      actionCount: actions.length,
    });
    throw error;
  }
};


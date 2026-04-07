import { getUserEmissionRates } from "../events-read/emissionRates.reader";
import { computeStakeUsdForActivities } from "../events-read/stakeUsd.provider";
import {
  BonusBalanceSnapshots,
  BonusCredit,
  BonusEligibleUser,
  BonusTokenBalance,
  BonusTokenConfig,
} from "../../shared/types";
import { logInfo, logError } from "../../infra/observability/logger";
import { buildBonusRuleByToken, normalizeAddressValue } from "../events-read/addressNormalization";
import { normalizeAddressNoPrefix } from "../../shared/core/address";

export const MAX_BONUS_INTERVAL_SECONDS = 24 * 60 * 60;
export const BONUS_SNAPSHOT_WINDOW = 28;
const BPS_DENOMINATOR = 10000n;
const DIRECT_PAYOUT_BLOCK_NUMBER = 1;
const DIRECT_PAYOUT_EVENT_INDEX = 1;

const buildCurrentBalanceMap = (
  currentBalances: BonusTokenBalance[],
): Map<string, Map<string, string>> => {
  const balanceMap = new Map<string, Map<string, string>>();

  for (const { sourceContract, user, balance } of currentBalances) {
    const tokenKey = normalizeAddressNoPrefix(sourceContract);
    const userKey = normalizeAddressValue(user);
    const tokenBalances = balanceMap.get(tokenKey) ?? new Map<string, string>();
    tokenBalances.set(userKey, balance);
    balanceMap.set(tokenKey, tokenBalances);
  }

  return balanceMap;
};

export const appendBalanceSnapshot = (
  snapshots: string[] | undefined,
  currentBalance: string,
): string[] => {
  const nextSnapshots = [...(snapshots ?? []), currentBalance];
  return nextSnapshots.length > BONUS_SNAPSHOT_WINDOW
    ? nextSnapshots.slice(nextSnapshots.length - BONUS_SNAPSHOT_WINDOW)
    : nextSnapshots;
};

export const calculateAverageBalance = (snapshots: string[]): bigint => {
  if (snapshots.length === 0) return 0n;

  const total = snapshots.reduce((sum, snapshot) => sum + BigInt(snapshot), 0n);
  return total / BigInt(snapshots.length);
};

const isZeroOnlySnapshotWindow = (snapshots: string[]): boolean =>
  snapshots.every((snapshot) => BigInt(snapshot) === 0n);

export const calculateBoostCapUsd = (
  currentBalance: bigint,
  snapshots: string[],
  conversionNumerator: bigint,
  conversionDenominator: bigint,
): bigint => {
  if (currentBalance <= 0n || snapshots.length === 0 || conversionDenominator <= 0n) {
    return 0n;
  }

  const averageBalance = calculateAverageBalance(snapshots);
  const effectiveBalance = currentBalance < averageBalance ? currentBalance : averageBalance;
  if (effectiveBalance <= 0n) return 0n;

  return (effectiveBalance * conversionNumerator) / conversionDenominator;
};

export const isPositionActivity = (activityType: string): boolean =>
  activityType !== "1";

export const buildBonusUsers = (
  tokenConfigs: BonusTokenConfig[],
  currentBalances: BonusTokenBalance[],
  previousSnapshots: BonusBalanceSnapshots,
): {
  bonusUsers: BonusEligibleUser[];
  balanceSnapshots: BonusBalanceSnapshots;
} => {
  const ruleByToken = buildBonusRuleByToken(tokenConfigs);
  const currentBalanceMap = buildCurrentBalanceMap(currentBalances);
  const userBonusMap = new Map<string, BonusEligibleUser>();
  const balanceSnapshots: BonusBalanceSnapshots = {};

  for (const [tokenKey, rule] of ruleByToken.entries()) {
    const currentTokenBalances = currentBalanceMap.get(tokenKey) ?? new Map<string, string>();
    const previousTokenSnapshots = previousSnapshots[tokenKey] ?? {};
    const allUsers = new Set<string>([
      ...Object.keys(previousTokenSnapshots),
      ...currentTokenBalances.keys(),
    ]);
    const nextTokenSnapshots: Record<string, string[]> = {};

    for (const user of allUsers) {
      const currentBalance = currentTokenBalances.get(user) ?? "0";
      const nextSnapshots = appendBalanceSnapshot(previousTokenSnapshots[user], currentBalance);
      if (!isZeroOnlySnapshotWindow(nextSnapshots)) {
        nextTokenSnapshots[user] = nextSnapshots;
      }

      const boostCapUsd = calculateBoostCapUsd(
        BigInt(currentBalance),
        nextSnapshots,
        rule.conversionNumerator,
        rule.conversionDenominator,
      );
      if (boostCapUsd <= 0n) continue;

      const current = userBonusMap.get(user);
      if (!current || BigInt(current.boostCapUsd) < boostCapUsd) {
        userBonusMap.set(user, {
          sourceContract: rule.sourceContract,
          user,
          boostCapUsd: boostCapUsd.toString(),
        });
      }
    }

    balanceSnapshots[tokenKey] = nextTokenSnapshots;
  }

  return {
    bonusUsers: [...userBonusMap.values()],
    balanceSnapshots,
  };
};

export const calculateBonusCreditsForUsers = async (
  bonusUsers: BonusEligibleUser[],
  intervalSeconds: number,
  maxBonusBps: number,
): Promise<BonusCredit[]> => {
  if (bonusUsers.length === 0) return [];

  const users = bonusUsers.map((u) => u.user);
  const uniqueBonusTokens = [...new Set(bonusUsers.map((u) => u.sourceContract))];
  const { activityBreakdownByUser, bonusEventByToken } = await getUserEmissionRates(
    users,
    uniqueBonusTokens
  );
  const interval = BigInt(Math.max(1, Math.floor(intervalSeconds)));
  const maxBps = BigInt(maxBonusBps);

  const credits: BonusCredit[] = [];
  let skippedMissingInitialization = 0;

  for (const { sourceContract, user, boostCapUsd } of bonusUsers) {
    const eventName = bonusEventByToken.get(normalizeAddressNoPrefix(sourceContract));
    if (!eventName) {
      skippedMissingInitialization += 1;
      continue;
    }

    const allActivities = activityBreakdownByUser.get(user) ?? [];
    const eligible = allActivities.filter((a) => isPositionActivity(a.activityType));
    if (eligible.length === 0) continue;

    let stakeUsdMap: Map<string, bigint>;
    try {
      stakeUsdMap = await computeStakeUsdForActivities(eligible);
    } catch (error) {
      logError("BonusUtils", error as Error, {
        operation: "computeStakeUsd",
        user,
      });
      continue;
    }
    let eligibleActivityUsd = 0n;
    for (const a of eligible) {
      eligibleActivityUsd += stakeUsdMap.get(a.activityId) ?? a.userStake;
    }
    if (eligibleActivityUsd <= 0n) continue;

    const boostCapUsdBig = BigInt(boostCapUsd);
    const boostedFractionBps = (boostCapUsdBig * BPS_DENOMINATOR) / eligibleActivityUsd;
    const dynamicBonusBps = boostedFractionBps > maxBps ? maxBps : boostedFractionBps;
    if (dynamicBonusBps <= 0n) continue;

    let eligibleEmissionRate = 0n;
    for (const a of eligible) {
      eligibleEmissionRate += a.personalEmissionRate;
    }
    if (eligibleEmissionRate <= 0n) continue;

    const bonusAmount = (eligibleEmissionRate * interval * dynamicBonusBps) / BPS_DENOMINATOR;
    if (bonusAmount <= 0n) continue;

    credits.push({
      sourceContract,
      eventName,
      user,
      amount: bonusAmount.toString(),
      blockNumber: DIRECT_PAYOUT_BLOCK_NUMBER,
      eventIndex: DIRECT_PAYOUT_EVENT_INDEX,
    });
  }

  logInfo("BonusUtils", `Calculated bonus credits for ${credits.length}/${bonusUsers.length} users`);
  if (skippedMissingInitialization > 0) {
    logInfo(
      "BonusUtils",
      `Skipped ${skippedMissingInitialization} users because bonus token direct payout is not initialized`
    );
  }
  return credits;
};

export const getCronIntervalSeconds = (cronExpr: string): number => {
  const hourField = cronExpr.trim().split(/\s+/)[1] || "*";
  let runsPerDay: number;
  if (hourField === "*") {
    runsPerDay = 24;
  } else if (hourField.startsWith("*/")) {
    runsPerDay = Math.floor(24 / Number(hourField.slice(2)));
  } else {
    runsPerDay = hourField.split(",").length;
  }
  return Math.floor((24 * 60 * 60) / Math.max(1, runsPerDay));
};

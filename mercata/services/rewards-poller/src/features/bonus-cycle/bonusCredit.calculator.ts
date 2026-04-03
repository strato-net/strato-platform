import { getUserEmissionRates } from "../events-read/emissionRates.reader";
import {
  BonusBalanceSnapshots,
  BonusCredit,
  BonusEligibleUser,
  BonusTokenBalance,
  BonusTokenConfig,
} from "../../shared/types";
import { logInfo } from "../../infra/observability/logger";
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

export const calculateDynamicBonusBps = (
  currentBalance: bigint,
  snapshots: string[],
  maxBonusBps: number,
  balanceForMaxBoost: bigint,
): number => {
  if (currentBalance <= 0n || snapshots.length === 0 || maxBonusBps <= 0 || balanceForMaxBoost <= 0n) {
    return 0;
  }

  const averageBalance = calculateAverageBalance(snapshots);
  const effectiveBalance = currentBalance < averageBalance ? currentBalance : averageBalance;
  if (effectiveBalance <= 0n) return 0;

  const rawBonusBps = (effectiveBalance * BigInt(maxBonusBps)) / balanceForMaxBoost;
  if (rawBonusBps <= 0n) return 0;

  const cappedBonusBps = rawBonusBps > BigInt(maxBonusBps) ? BigInt(maxBonusBps) : rawBonusBps;
  return Number(cappedBonusBps);
};

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

      const dynamicBonusBps = calculateDynamicBonusBps(
        BigInt(currentBalance),
        nextSnapshots,
        rule.maxBonusBps,
        rule.balanceForMaxBoost,
      );
      if (dynamicBonusBps <= 0) continue;

      const currentBonus = userBonusMap.get(user);
      if (!currentBonus || dynamicBonusBps > currentBonus.bonusBps) {
        userBonusMap.set(user, {
          sourceContract: rule.sourceContract,
          user,
          bonusBps: dynamicBonusBps,
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
  intervalSeconds: number
): Promise<BonusCredit[]> => {
  if (bonusUsers.length === 0) return [];

  const users = bonusUsers.map((u) => u.user);
  const uniqueBonusTokens = [...new Set(bonusUsers.map((u) => u.sourceContract))];
  const { rateByUser, bonusEventByToken } = await getUserEmissionRates(
    users,
    uniqueBonusTokens
  );
  const interval = BigInt(Math.max(1, Math.floor(intervalSeconds)));

  const credits: BonusCredit[] = [];
  let skippedMissingInitialization = 0;
  for (const { sourceContract, user, bonusBps } of bonusUsers) {
    const eventName = bonusEventByToken.get(normalizeAddressNoPrefix(sourceContract));
    if (!eventName) {
      skippedMissingInitialization += 1;
      continue;
    }

    const emissionRate = rateByUser.get(user);
    if (!emissionRate || emissionRate <= 0n || bonusBps <= 0) continue;

    const bonusAmount = (emissionRate * interval * BigInt(bonusBps)) / BPS_DENOMINATOR;
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

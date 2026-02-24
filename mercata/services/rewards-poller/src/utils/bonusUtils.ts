import { getUserEmissionRates } from "../services/cirrusService";
import { BonusCredit, BonusEligibleUser } from "../types";
import { logInfo } from "./logger";

export const MAX_BONUS_INTERVAL_SECONDS = 24 * 60 * 60;

export const calculateBonusCreditsForUsers = async (
  bonusUsers: BonusEligibleUser[],
  intervalSeconds: number
): Promise<BonusCredit[]> => {
  if (bonusUsers.length === 0) return [];

  const users = bonusUsers.map((u) => u.user);
  const rateByUser = await getUserEmissionRates(users);
  const interval = BigInt(Math.max(1, Math.floor(intervalSeconds)));

  const credits: BonusCredit[] = [];
  for (const { user, bonusPercentage } of bonusUsers) {
    const emissionRate = rateByUser.get(user);
    if (!emissionRate || emissionRate <= 0n || bonusPercentage <= 0) continue;

    const bonusAmount = (emissionRate * interval * BigInt(bonusPercentage)) / 100n;
    if (bonusAmount <= 0n) continue;

    credits.push({ user, amount: bonusAmount.toString() });
  }

  logInfo("BonusUtils", `Calculated bonus credits for ${credits.length}/${bonusUsers.length} users`);
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

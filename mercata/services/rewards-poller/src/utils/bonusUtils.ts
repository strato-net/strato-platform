import { getUserEmissionRates } from "../services/cirrusService";
import { BonusCredit, BonusEligibleUser } from "../types";
import { logInfo } from "./logger";

export const MAX_BONUS_INTERVAL_SECONDS = 24 * 60 * 60;
const BPS_DENOMINATOR = 10000n;
const DIRECT_PAYOUT_BLOCK_NUMBER = 1;
const DIRECT_PAYOUT_EVENT_INDEX = 1;

const normalizeAddress = (address: string): string =>
  address.toLowerCase().replace(/^0x/, "");

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
  for (const { sourceContract, user, bonusBps } of bonusUsers) {
    const eventName = bonusEventByToken.get(normalizeAddress(sourceContract));
    if (!eventName) {
      throw new Error(`Missing direct payout event mapping for bonus token ${sourceContract}`);
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

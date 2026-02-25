import { BonusCredit, BonusTokenConfig } from "../types";

export const parseBonusTokenConfigs = (raw: unknown): BonusTokenConfig[] => {
  if (!Array.isArray(raw)) {
    throw new Error("Invalid bonusTokenConfigs: expected array");
  }

  return raw.map((item: unknown, idx: number) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Invalid bonusTokenConfigs[${idx}]: expected object`);
    }

    const token = item as Record<string, unknown>;

    if (typeof token.address !== "string" || token.address.trim().length === 0) {
      throw new Error(`Invalid bonusTokenConfigs[${idx}].address: required non-empty string`);
    }

    const bonusBps = Number(token.bonusBps);
    if (!Number.isInteger(bonusBps) || bonusBps <= 0) {
      throw new Error(`Invalid bonusTokenConfigs[${idx}].bonusBps: required positive integer (basis points)`);
    }

    if (typeof token.minBalance !== "string" || token.minBalance.trim().length === 0) {
      throw new Error(`Invalid bonusTokenConfigs[${idx}].minBalance: required non-empty string`);
    }

    return {
      address: token.address.trim(),
      bonusBps,
      minBalance: token.minBalance,
    };
  });
};

export const isValidBonusCredit = (credit: BonusCredit): boolean => {
  if (
    typeof credit.sourceContract !== "string" || credit.sourceContract.length === 0 ||
    typeof credit.eventName !== "string" || credit.eventName.length === 0 ||
    typeof credit.user !== "string" || credit.user.length === 0 ||
    typeof credit.amount !== "string" || credit.amount.length === 0 ||
    !Number.isInteger(credit.blockNumber) || credit.blockNumber <= 0 ||
    !Number.isInteger(credit.eventIndex) || credit.eventIndex <= 0
  ) {
    return false;
  }

  try {
    return BigInt(credit.amount) > 0n;
  } catch {
    return false;
  }
};

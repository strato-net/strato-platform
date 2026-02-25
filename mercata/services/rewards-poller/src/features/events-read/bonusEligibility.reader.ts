import { cirrus } from "../../infra/http/api";
import { logInfo } from "../../infra/observability/logger";
import { retryWithBackoff } from "../../infra/http/retry.policy";
import { BonusTokenConfig, BonusEligibleUser } from "../../shared/types";
import { buildBonusRuleByToken, normalizeAddressValue } from "./addressNormalization";

const CIRRUS_RETRY_OPTS = { maxAttempts: 3, initialDelay: 5000, maxDelay: 5000 };

export const getBonusEligibleUsers = async (
  tokenConfigs: BonusTokenConfig[]
): Promise<BonusEligibleUser[]> => {
  if (tokenConfigs.length === 0) return [];

  const ruleByToken = buildBonusRuleByToken(tokenConfigs);
  const addresses = [...ruleByToken.keys()];
  const data = await retryWithBackoff(
    () => cirrus.get("/BlockApps-Token-_balances", {
      params: {
        address: `in.(${addresses.join(",")})`,
        select: "address,user:key,balance:value::text",
      },
    }),
    "CirrusService-getBonusEligibleUsers",
    CIRRUS_RETRY_OPTS
  );

  if (!Array.isArray(data) || data.length === 0) return [];

  const userBonusMap = new Map<string, BonusEligibleUser>();
  for (const row of data) {
    const rule = ruleByToken.get(normalizeAddressValue(row.address));
    if (!rule || BigInt(row.balance || "0") <= rule.minBalance) continue;

    const current = userBonusMap.get(row.user);
    if (!current || rule.bonusBps > current.bonusBps) {
      userBonusMap.set(row.user, {
        sourceContract: rule.sourceContract,
        user: row.user,
        bonusBps: rule.bonusBps,
      });
    }
  }

  const users = [...userBonusMap.values()];
  logInfo("CirrusService", `Loaded ${users.length} bonus-eligible users from ${addresses.length} bonus tokens`);
  return users;
};

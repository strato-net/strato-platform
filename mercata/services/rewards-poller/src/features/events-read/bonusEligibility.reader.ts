import { cirrus } from "../../infra/http/api";
import { logInfo } from "../../infra/observability/logger";
import { retryWithBackoff } from "../../infra/http/retry.policy";
import { BonusTokenBalance, BonusTokenConfig } from "../../shared/types";
import { buildBonusRuleByToken, normalizeAddressValue } from "./addressNormalization";

const CIRRUS_RETRY_OPTS = { maxAttempts: 3, initialDelay: 5000, maxDelay: 5000 };

export const getCurrentBonusTokenBalances = async (
  tokenConfigs: BonusTokenConfig[]
): Promise<BonusTokenBalance[]> => {
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
    "CirrusService-getCurrentBonusTokenBalances",
    CIRRUS_RETRY_OPTS
  );

  if (!Array.isArray(data) || data.length === 0) return [];

  const balanceByTokenUser = new Map<string, BonusTokenBalance>();
  for (const row of data) {
    const rule = ruleByToken.get(normalizeAddressValue(row.address));
    if (!rule) continue;

    const user = normalizeAddressValue(row.user);
    if (user.length === 0) continue;

    const balance = String(row.balance ?? "0").trim();
    let normalizedBalance: string;
    try {
      normalizedBalance = BigInt(balance || "0").toString();
    } catch {
      continue;
    }

    const mapKey = `${normalizeAddressValue(row.address)}:${user}`;
    const current = balanceByTokenUser.get(mapKey);
    if (!current || BigInt(normalizedBalance) > BigInt(current.balance)) {
      balanceByTokenUser.set(mapKey, {
        sourceContract: rule.sourceContract,
        user,
        balance: normalizedBalance,
      });
    }
  }

  const balances = [...balanceByTokenUser.values()];
  logInfo("CirrusService", `Loaded ${balances.length} current bonus balances from ${addresses.length} bonus tokens`);
  return balances;
};

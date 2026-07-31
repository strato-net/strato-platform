import { cirrus } from "../../infra/http/api";
import { config } from "../../infra/config/runtimeConfig";
import { logInfo, logError } from "../../infra/observability/logger";
import { retryWithBackoff } from "../../infra/http/retry.policy";
import { UserActivityInfo } from "../../shared/types";

const CIRRUS_RETRY_OPTS = { maxAttempts: 3, initialDelay: 5000, maxDelay: 5000 };
const Q = 10n ** 18n;

const getOraclePrices = async (): Promise<Map<string, bigint>> => {
  const priceMap = new Map<string, bigint>();
  const oracleAddress = config.priceOracle.address;
  if (!oracleAddress) return priceMap;

  try {
    const rows = await retryWithBackoff(
      () => cirrus.get("/BlockApps-PriceOracle-prices", {
        params: {
          address: `eq.${oracleAddress}`,
          select: "key,value::text",
        },
      }),
      "StakeUsd-getOraclePrices",
      CIRRUS_RETRY_OPTS
    );

    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row.key && row.value) {
          try {
            priceMap.set(String(row.key).toLowerCase(), BigInt(row.value));
          } catch { /* skip unparseable */ }
        }
      }
    }
  } catch (error) {
    logError("StakeUsd", error as Error, { operation: "getOraclePrices" });
  }

  return priceMap;
};

const getLpTokenPrice = async (
  sourceContract: string,
  oraclePrices: Map<string, bigint>,
): Promise<bigint | null> => {
  try {
    const [poolRows, tokenRows] = await Promise.all([
      retryWithBackoff(
        () => cirrus.get("/BlockApps-Pool", {
          params: {
            lpToken: `eq.${sourceContract}`,
            select: "tokenA,tokenB,tokenABalance::text,tokenBBalance::text",
            limit: 1,
          },
        }),
        "StakeUsd-getPool",
        CIRRUS_RETRY_OPTS
      ),
      retryWithBackoff(
        () => cirrus.get("/BlockApps-Token", {
          params: {
            address: `eq.${sourceContract}`,
            select: "_totalSupply::text",
            limit: 1,
          },
        }),
        "StakeUsd-getLpSupply",
        CIRRUS_RETRY_OPTS
      ),
    ]);

    const pool = Array.isArray(poolRows) && poolRows.length > 0 ? poolRows[0] : null;
    const token = Array.isArray(tokenRows) && tokenRows.length > 0 ? tokenRows[0] : null;
    if (!pool || !token) return null;

    const aBal = BigInt(pool.tokenABalance || "0");
    const bBal = BigInt(pool.tokenBBalance || "0");
    const supply = BigInt(token._totalSupply || "0");
    if (supply === 0n) return null;

    const priceA = oraclePrices.get(String(pool.tokenA).toLowerCase()) ?? 0n;
    const priceB = oraclePrices.get(String(pool.tokenB).toLowerCase()) ?? 0n;
    if (priceA === 0n || priceB === 0n) return null;

    return (aBal * priceA + bBal * priceB) / supply;
  } catch (error) {
    logError("StakeUsd", error as Error, { operation: "getLpTokenPrice", sourceContract });
    return null;
  }
};

const getVaultSharePrice = async (sourceContract: string): Promise<bigint | null> => {
  try {
    const vaultRows = await retryWithBackoff(
      () => cirrus.get("/BlockApps-SaveUSDSTVault", {
        params: {
          address: `eq.${sourceContract}`,
          select: "address,assetToken,_managedAssets::text,_totalSupply::text",
          limit: 1,
        },
      }),
      "StakeUsd-getVault",
      CIRRUS_RETRY_OPTS
    );

    const vault = Array.isArray(vaultRows) && vaultRows.length > 0 ? vaultRows[0] : null;
    if (!vault?.address || !vault?.assetToken) return null;

    const managedAssets = BigInt(vault._managedAssets || "0");
    const totalShares = BigInt(vault._totalSupply || "0");
    if (totalShares === 0n) return Q;

    const balanceRows = await retryWithBackoff(
      () => cirrus.get("/BlockApps-Token-_balances", {
        params: {
          address: `eq.${vault.assetToken}`,
          key: `eq.${vault.address}`,
          select: "value::text",
          limit: 1,
        },
      }),
      "StakeUsd-getVaultBalance",
      CIRRUS_RETRY_OPTS
    );

    const liveBalance = Array.isArray(balanceRows) && balanceRows.length > 0
      ? BigInt(balanceRows[0].value || "0")
      : managedAssets;

    const pricingAssets = liveBalance < managedAssets ? liveBalance : managedAssets;
    return (pricingAssets * Q) / totalShares;
  } catch (error) {
    logError("StakeUsd", error as Error, { operation: "getVaultSharePrice", sourceContract });
    return null;
  }
};

const isUsdNotional = (activityName: string): boolean => {
  const lower = activityName.toLowerCase();
  return lower.includes("cdp") || lower.includes("mint") || lower.includes("borrow");
};

const isLpActivity = (activityName: string): boolean =>
  activityName.toLowerCase().includes(" lp");

const isVaultActivity = (activityName: string): boolean => {
  const lower = activityName.toLowerCase();
  return lower.includes("save usdst") || lower.includes("saveusdst");
};

export const computeStakeUsdForActivities = async (
  activities: UserActivityInfo[]
): Promise<Map<string, bigint>> => {
  const result = new Map<string, bigint>();
  if (activities.length === 0) return result;

  const needsLpPrice = activities.some((a) => isLpActivity(a.activityName));
  const needsVaultPrice = activities.some((a) => isVaultActivity(a.activityName));

  const oraclePrices = needsLpPrice ? await getOraclePrices() : new Map<string, bigint>();

  const lpPriceCache = new Map<string, bigint | null>();
  const vaultPriceCache = new Map<string, bigint | null>();

  for (const activity of activities) {
    if (isUsdNotional(activity.activityName)) {
      result.set(activity.activityId, activity.userStake);
      continue;
    }

    if (isLpActivity(activity.activityName)) {
      const src = activity.sourceContract.toLowerCase();
      if (!lpPriceCache.has(src)) {
        lpPriceCache.set(src, await getLpTokenPrice(src, oraclePrices));
      }
      const price = lpPriceCache.get(src);
      if (price && price > 0n) {
        result.set(activity.activityId, (activity.userStake * price) / Q);
      } else {
        result.set(activity.activityId, activity.userStake);
      }
      continue;
    }

    if (isVaultActivity(activity.activityName)) {
      const src = activity.sourceContract.toLowerCase();
      if (!vaultPriceCache.has(src)) {
        vaultPriceCache.set(src, await getVaultSharePrice(src));
      }
      const price = vaultPriceCache.get(src);
      if (price && price > 0n) {
        result.set(activity.activityId, (activity.userStake * price) / Q);
      } else {
        result.set(activity.activityId, activity.userStake);
      }
      continue;
    }

    result.set(activity.activityId, activity.userStake);
  }

  const lpCount = [...lpPriceCache.values()].filter((p) => p !== null).length;
  const vaultCount = [...vaultPriceCache.values()].filter((p) => p !== null).length;
  if (needsLpPrice || needsVaultPrice) {
    logInfo("StakeUsd", `Priced ${lpCount} LP tokens, ${vaultCount} vault tokens for ${activities.length} activities`);
  }

  return result;
};

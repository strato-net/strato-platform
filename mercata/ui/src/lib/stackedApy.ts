import type { ApySource, Pool, TokenApyEntry } from "@mercata/shared-types";
import type { Activity } from "@/services/rewardsService";
import { mUsdstAddress } from "@/lib/constants";

const WAD = 10n ** 18n;
const CATA_PRICE_USD = 0.25;

type AssetLike = {
  address?: string | null;
  balance?: string | null;
  price?: string | null;
};

export type StackedApyBreakdown = {
  native: number;
  base: number;
  reward: number;
  total: number;
};

export const normalizeApyAddress = (value?: string | null): string =>
  (value || "").toLowerCase().replace(/^0x/, "");

export const parseApyValue = (value?: string | number | null): number => {
  if (value === null || value === undefined || value === "" || value === "-") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundApy = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
};

export const buildStackedApyBreakdown = (parts: {
  native?: string | number | null;
  base?: string | number | null;
  reward?: string | number | null;
}): StackedApyBreakdown => {
  const native = roundApy(parseApyValue(parts.native));
  const base = roundApy(parseApyValue(parts.base));
  const reward = roundApy(parseApyValue(parts.reward));
  return {
    native,
    base,
    reward,
    total: roundApy(native + base + reward),
  };
};

export const calculateRewardApy = (
  emissionRate?: string,
  totalStakeUsd?: string | null,
  rewardTokenPriceUsd = CATA_PRICE_USD,
): number => {
  try {
    if (!emissionRate || !totalStakeUsd) return 0;
    const tvlUsd = Number(BigInt(totalStakeUsd)) / 1e18;
    if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) return 0;
    const annualRewards = (Number(BigInt(emissionRate)) / 1e18) * 86400 * 365;
    if (!Number.isFinite(annualRewards) || annualRewards <= 0) return 0;
    return roundApy(((annualRewards * rewardTokenPriceUsd) / tvlUsd) * 100);
  } catch {
    return 0;
  }
};

export const buildRewardApyMap = (
  activities?: Pick<Activity, "sourceContract" | "emissionRate" | "totalStakeUsd">[] | null,
): Map<string, number> => {
  const map = new Map<string, number>();
  for (const activity of activities || []) {
    const contract = normalizeApyAddress(activity.sourceContract);
    if (!contract) continue;
    map.set(contract, calculateRewardApy(activity.emissionRate, activity.totalStakeUsd ?? null));
  }
  return map;
};

export const buildTokenApyMaps = (entries: TokenApyEntry[]) => {
  const entriesByToken = new Map<string, TokenApyEntry>();
  const baseByToken = new Map<string, number>();

  for (const entry of entries || []) {
    const token = normalizeApyAddress(entry.token);
    if (!token) continue;
    entriesByToken.set(token, entry);

    let directBase = 0;
    for (const apy of entry.apys) {
      if (apy.source !== "base") continue;
      directBase = Math.max(directBase, parseApyValue(apy.apy));
    }
    if (directBase > 0) {
      baseByToken.set(token, directBase);
    }
  }

  return { entriesByToken, baseByToken };
};

export const getDirectBaseApyBreakdown = (params: {
  entriesByToken: Map<string, TokenApyEntry>;
  address?: string | null;
}): StackedApyBreakdown => {
  const entry = params.entriesByToken.get(normalizeApyAddress(params.address));
  if (!entry) return buildStackedApyBreakdown({});

  let directBase = 0;
  for (const apy of entry.apys) {
    if (apy.source !== "base") continue;
    directBase = Math.max(directBase, parseApyValue(apy.apy));
  }

  return buildStackedApyBreakdown({ base: directBase });
};

const parseUsdFromWei = (balanceRaw?: string | null, priceRaw?: string | null): number => {
  try {
    const balance = BigInt(balanceRaw || "0");
    const price = BigInt(priceRaw || "0");
    if (balance <= 0n || price <= 0n) return 0;
    return Number((balance * price) / WAD) / 1e18;
  } catch {
    return 0;
  }
};

export const calculateWeightedBaseFromAssets = (
  assets: AssetLike[],
  baseByToken: Map<string, number>,
): number => {
  let weightedSum = 0;
  let totalUsd = 0;

  for (const asset of assets) {
    const usdValue = parseUsdFromWei(asset.balance, asset.price);
    if (usdValue <= 0) continue;
    totalUsd += usdValue;
    weightedSum += usdValue * (baseByToken.get(normalizeApyAddress(asset.address)) || 0);
  }

  return totalUsd > 0 ? roundApy(weightedSum / totalUsd) : 0;
};

export const calculatePoolWeightedBase = (
  pool: Pool | null | undefined,
  baseByToken: Map<string, number>,
): number => {
  if (!pool) return 0;

  const legacyPool = pool as Pool & { tokenABalance?: string; tokenBBalance?: string };
  const assets = pool.coins?.length
    ? pool.coins.map((coin) => ({
        address: coin.address,
        balance: coin.poolBalance,
        price: coin.price,
      }))
    : [
        {
          address: pool.tokenA?.address,
          balance: pool.tokenA?.poolBalance || legacyPool.tokenABalance,
          price: pool.tokenA?.price,
        },
        {
          address: pool.tokenB?.address,
          balance: pool.tokenB?.poolBalance || legacyPool.tokenBBalance,
          price: pool.tokenB?.price,
        },
      ];

  return calculateWeightedBaseFromAssets(assets, baseByToken);
};

const getRewardApyForSource = (params: {
  source?: ApySource["source"];
  poolAddress?: string;
  rewardApyByContract?: Map<string, number>;
  poolsByAddress?: Map<string, Pool>;
  vaultShareTokenAddress?: string | null;
}): number => {
  const { source, poolAddress, rewardApyByContract, poolsByAddress, vaultShareTokenAddress } = params;
  if (!source || !rewardApyByContract) return 0;

  switch (source) {
    case "lending":
      return rewardApyByContract.get(normalizeApyAddress(mUsdstAddress)) || 0;
    case "swap":
    case "weighted_swap":
      return rewardApyByContract.get(
        normalizeApyAddress(poolsByAddress?.get(normalizeApyAddress(poolAddress))?.lpToken?.address),
      ) || 0;
    case "vault":
    case "vault_weighted":
      return rewardApyByContract.get(normalizeApyAddress(vaultShareTokenAddress)) || 0;
    default:
      return 0;
  }
};

export const getTokenOpportunityApyInfo = (params: {
  entry?: TokenApyEntry | null;
  rewardApyByContract?: Map<string, number>;
  poolsByAddress?: Map<string, Pool>;
  vaultShareTokenAddress?: string | null;
}): {
  source: ApySource["source"];
  poolAddress?: string;
  breakdown: StackedApyBreakdown;
} | null => {
  const entry = params.entry;
  if (!entry) return null;

  let native: ApySource | null = null;
  let weightedBase: ApySource | null = null;
  let directBase = 0;

  for (const apy of entry.apys) {
    const value = parseApyValue(apy.apy);
    if (apy.source === "base") {
      directBase = Math.max(directBase, value);
      continue;
    }
    if (apy.source === "weighted_swap" || apy.source === "vault_weighted") {
      if (!weightedBase || value > parseApyValue(weightedBase.apy)) weightedBase = apy;
      continue;
    }
    if (!native || value > parseApyValue(native.apy)) native = apy;
  }

  const rewardSource = native || weightedBase;
  const breakdown = buildStackedApyBreakdown({
    native: native?.apy,
    base: directBase + parseApyValue(weightedBase?.apy),
    reward: getRewardApyForSource({
      source: rewardSource?.source,
      poolAddress: rewardSource?.poolAddress,
      rewardApyByContract: params.rewardApyByContract,
      poolsByAddress: params.poolsByAddress,
      vaultShareTokenAddress: params.vaultShareTokenAddress,
    }),
  });

  if (breakdown.total <= 0) return null;

  return {
    source: rewardSource?.source || native?.source || "base",
    poolAddress: rewardSource?.poolAddress,
    breakdown,
  };
};

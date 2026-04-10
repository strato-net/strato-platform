import { ApySource, TokenApyEntry } from "@mercata/shared-types";

const CATA_PRICE_USD = 0.25;

export interface EarnApyBreakdownItem {
  label: string;
  apy: string;
}

export interface EarnApyInfo {
  total: number;
  source: ApySource["source"];
  poolAddress?: string;
  breakdown: EarnApyBreakdownItem[];
}

function normalizeBreakdownLabel(label: string | undefined): string {
  return (label || "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parseBreakdownApyPercent(raw: string | number | undefined): number {
  if (raw === undefined || raw === null) return NaN;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : NaN;
  const s = String(raw).trim().replace(/%/g, "").replace(/,/g, "");
  const v = Number(s);
  return Number.isFinite(v) && v >= 0 ? v : NaN;
}

/**
 * Sum APY % from `EarnApyInfo.breakdown` lines — matches earnUtils labels (`Native APY`, `Base APY`, `Rewards APY`)
 * with tolerant label/number parsing so portfolio rollups stay aligned with table tooltips.
 */
export function parseEarnApyBreakdownBuckets(info: EarnApyInfo | null): {
  native: number;
  base: number;
  rewards: number;
} {
  if (!info?.breakdown?.length) return { native: 0, base: 0, rewards: 0 };
  let native = 0;
  let base = 0;
  let rewards = 0;
  let unmatched = 0;

  for (const b of info.breakdown) {
    const v = parseBreakdownApyPercent(b.apy);
    if (!Number.isFinite(v)) continue;

    const key = normalizeBreakdownLabel(b.label);
    if (key === "native apy" || key.endsWith(" native apy")) native += v;
    else if (key === "base apy" || key.endsWith(" base apy")) base += v;
    else if (key === "rewards apy" || key.endsWith(" rewards apy") || (key.includes("reward") && key.includes("apy")))
      rewards += v;
    else unmatched += v;
  }

  if (unmatched > 0) {
    if (native + base + rewards === 0) {
      base = unmatched;
    } else {
      base += unmatched;
    }
  }

  return { native, base, rewards };
}

/**
 * Per-position Native/Base/Rewards % from the Earn breakdown (API-shaped). If breakdown lines sum
 * differs slightly from `apyTotal`, scales all three proportionally so totals stay consistent.
 * No breakdown but `apyTotal` > 0 → attribute all to Base (e.g. vault alpha string only).
 */
export function earnApyRowBuckets(
  info: EarnApyInfo | null,
  apyTotal: number | null
): { native: number; base: number; rewards: number } {
  const apy = apyTotal != null && Number.isFinite(apyTotal) && apyTotal > 0 ? apyTotal : 0;
  if (apy <= 0) return { native: 0, base: 0, rewards: 0 };

  let { native, base, rewards } = parseEarnApyBreakdownBuckets(info);
  const sum = native + base + rewards;
  if (sum <= 0) return { native: 0, base: apy, rewards: 0 };
  const tol = Math.max(0.05, apy * 0.002);
  if (Math.abs(sum - apy) <= tol) return { native, base, rewards };
  const scale = apy / sum;
  return { native: native * scale, base: base * scale, rewards: rewards * scale };
}

export interface EarnApyLookupOptions {
  includeVaultSources?: boolean;
}

const normAddr = (value: string) => (value || "").toLowerCase().replace(/^0x/, "");

const parsePositiveApy = (value?: string | number | null): number => {
  if (!value || value === "-") return 0;
  const apy = Number(value);
  return Number.isFinite(apy) && apy > 0 ? apy : 0;
};

export const roundRewardsApy = (value?: string | number | null): string | null => {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const apy = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(apy) || apy <= 0) return null;
  if (apy >= 1000) return Math.round(apy).toString();
  if (apy >= 10) return apy.toFixed(0);
  return apy.toFixed(1);
};

const toBreakdownItem = (label: string, entry?: ApySource): EarnApyBreakdownItem | null => {
  if (!entry || parsePositiveApy(entry.apy) <= 0) return null;
  return { label, apy: entry.apy };
};

const buildSimpleInfo = (entry?: ApySource, source?: ApySource["source"], label?: string): EarnApyInfo | null => {
  const total = parsePositiveApy(entry?.apy);
  if (!entry || !source || !label || total <= 0) return null;
  return {
    total,
    source,
    breakdown: [{ label, apy: entry.apy }],
  };
};

export const getRewardsApyPercent = (
  emissionRate?: string | null,
  totalStakeUsd?: string | null
): number | null => {
  try {
    if (!emissionRate || !totalStakeUsd) return null;

    const tvlUsd = Number(BigInt(totalStakeUsd)) / 1e18;
    if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) return null;

    const annualCata = (Number(BigInt(emissionRate)) / 1e18) * 86400 * 365;
    if (!Number.isFinite(annualCata) || annualCata <= 0) return null;

    const rewardsApy = ((annualCata * CATA_PRICE_USD) / tvlUsd) * 100;
    if (!Number.isFinite(rewardsApy) || rewardsApy <= 0) return null;

    return Number(rewardsApy.toFixed(2));
  } catch {
    return null;
  }
};

export const buildNativeRewardsApyInfo = (
  nativeApyPercent?: string | number | null,
  emissionRate?: string | null,
  totalStakeUsd?: string | null,
  source: ApySource["source"] = "base"
): EarnApyInfo | null => {
  const native = parsePositiveApy(nativeApyPercent);
  const rewards = getRewardsApyPercent(emissionRate, totalStakeUsd);
  const roundedRewards = roundRewardsApy(rewards);

  const breakdown = [
    native > 0 ? { label: "Native APY", apy: native.toFixed(2) } : null,
    roundedRewards ? { label: "Rewards APY", apy: roundedRewards } : null,
  ].filter((item): item is EarnApyBreakdownItem => item !== null);

  if (breakdown.length === 0) return null;

  const total = breakdown.reduce((sum, item) => sum + parsePositiveApy(item.apy), 0);
  return total > 0 ? { total, source, breakdown } : null;
};

const buildLendingInfo = (apys: ApySource[]): EarnApyInfo | null => {
  const lending = apys.find((item) => item.source === "lending" && !item.poolAddress);
  const rewards = apys.find((item) => item.source === "rewards" && !item.poolAddress && item.meta === "lending");
  const roundedRewards = rewards ? { ...rewards, apy: roundRewardsApy(rewards.apy) || rewards.apy } : undefined;
  const breakdown = [
    toBreakdownItem("Native APY", lending),
    toBreakdownItem("Rewards APY", roundedRewards),
  ].filter((item): item is EarnApyBreakdownItem => item !== null);
  const total = breakdown.reduce((sum, item) => sum + parsePositiveApy(item.apy), 0);
  return total > 0 ? { total, source: "lending", breakdown } : null;
};

const buildVaultInfo = (apys: ApySource[]): EarnApyInfo | null => {
  const vault = apys.find((item) => item.source === "vault" && !item.poolAddress);
  const vaultWeighted = apys.find((item) => item.source === "vault_weighted" && !item.poolAddress);
  const rewards = apys.find((item) => item.source === "rewards" && !item.poolAddress && item.meta === "vault");
  const roundedRewards = rewards ? { ...rewards, apy: roundRewardsApy(rewards.apy) || rewards.apy } : undefined;
  const breakdown = [
    toBreakdownItem("Native APY", vault),
    toBreakdownItem("Base APY", vaultWeighted),
    toBreakdownItem("Rewards APY", roundedRewards),
  ].filter((item): item is EarnApyBreakdownItem => item !== null);
  const total = breakdown.reduce((sum, item) => sum + parsePositiveApy(item.apy), 0);
  return total > 0 ? { total, source: "vault", breakdown } : null;
};

const buildPoolInfos = (apys: ApySource[]): EarnApyInfo[] => {
  const poolGroups = new Map<string, ApySource[]>();
  apys.forEach((item, index) => {
    if (!item.poolAddress) return;
    if (item.source !== "swap" && item.source !== "weighted_swap" && item.source !== "base" && item.source !== "rewards") return;
    const key = `pool:${item.poolAddress || item.meta || index}`;
    if (!poolGroups.has(key)) poolGroups.set(key, []);
    poolGroups.get(key)!.push(item);
  });

  const infos: EarnApyInfo[] = [];
  poolGroups.forEach((items) => {
    const swap = items.find((item) => item.source === "swap");
    const weightedSwap = items.find((item) => item.source === "weighted_swap");
    const base = items.find((item) => item.source === "base");
    const rewards = items.find((item) => item.source === "rewards");
    const roundedRewards = rewards ? { ...rewards, apy: roundRewardsApy(rewards.apy) || rewards.apy } : undefined;
    const breakdown = [
      toBreakdownItem("Native APY", swap),
      toBreakdownItem("Base APY", weightedSwap || base),
      toBreakdownItem("Rewards APY", roundedRewards),
    ].filter((item): item is EarnApyBreakdownItem => item !== null);
    const total = breakdown.reduce((sum, item) => sum + parsePositiveApy(item.apy), 0);
    if (total <= 0) return;
    infos.push({
      total,
      source: "swap",
      poolAddress:
        swap?.poolAddress ||
        weightedSwap?.poolAddress ||
        base?.poolAddress ||
        rewards?.poolAddress,
      breakdown,
    });
  });

  return infos;
};

const buildStandaloneRewardInfos = (apys: ApySource[]): EarnApyInfo[] => {
  const infos: EarnApyInfo[] = [];
  apys.forEach((item) => {
    if (item.source !== "rewards" || item.poolAddress) return;
    if (item.meta === "vault" || item.meta === "lending") return;
    const roundedRewards = roundRewardsApy(item.apy) || item.apy;
    const total = parsePositiveApy(roundedRewards);
    if (total <= 0) return;
    infos.push({
      total,
      source: "rewards",
      breakdown: [{ label: "Rewards APY", apy: roundedRewards }],
    });
  });
  return infos;
};

const pickBestEntry = (
  entries: ApySource[],
  transformApy?: (entry: ApySource) => string | null
): ApySource | null => {
  let best: ApySource | null = null;
  let bestValue = 0;

  for (const entry of entries) {
    const apy = transformApy ? transformApy(entry) : entry.apy;
    const value = parsePositiveApy(apy);
    if (value <= 0 || value <= bestValue) continue;
    best = apy && apy !== entry.apy ? { ...entry, apy } : entry;
    bestValue = value;
  }

  return best;
};

const buildTokenCompositeInfo = (
  apys: ApySource[],
  options?: EarnApyLookupOptions
): EarnApyInfo | null => {
  const includeVaultSources = options?.includeVaultSources !== false;
  const usableApys = includeVaultSources
    ? apys
    : apys.filter((item) => item.source !== "vault" && item.source !== "vault_weighted" && !(item.source === "rewards" && item.meta === "vault"));

  /** Mirrors `/earn/token-apys` grouping: swap fee / vault NAV / lending supply → “Native APY”; pool base / vault_weighted → “Base APY”; rewards → “Rewards APY”. */
  const native = pickBestEntry(
    usableApys.filter(
      (item) =>
        (item.source === "swap" && !!item.poolAddress) ||
        (!item.poolAddress && (item.source === "lending" || item.source === "safety" || item.source === "vault"))
    )
  );

  const basePoolEntries = usableApys.filter(
    (item) => !!item.poolAddress && (item.source === "weighted_swap" || item.source === "base")
  );
  const baseProtocolEntries = usableApys.filter(
    (item) => !item.poolAddress && (item.source === "base" || item.source === "vault_weighted")
  );
  /** One “Base APY” line: best among pool-linked and token-level base sources (avoid `a || b` hiding the larger). */
  const base = pickBestEntry([...basePoolEntries, ...baseProtocolEntries]);

  const rewards = pickBestEntry(
    usableApys.filter((item) => item.source === "rewards"),
    (entry) => roundRewardsApy(entry.apy) || entry.apy
  );

  const breakdown = [
    toBreakdownItem("Native APY", native || undefined),
    toBreakdownItem("Base APY", base || undefined),
    toBreakdownItem("Rewards APY", rewards || undefined),
  ].filter((item): item is EarnApyBreakdownItem => item !== null);
  const total = breakdown.reduce((sum, item) => sum + parsePositiveApy(item.apy), 0);
  if (total <= 0) return null;

  const poolRoute = native?.poolAddress ? native : base?.poolAddress ? base : rewards?.poolAddress ? rewards : null;
  return {
    total,
    source: poolRoute ? "swap" : native?.source || base?.source || rewards?.source || "base",
    poolAddress: poolRoute?.poolAddress,
    breakdown,
  };
};

export const buildEarnApyMap = (
  tokenApys: TokenApyEntry[],
  options?: EarnApyLookupOptions
): Map<string, EarnApyInfo> => {
  const includeVaultSources = options?.includeVaultSources !== false;
  const result = new Map<string, EarnApyInfo>();

  for (const entry of tokenApys) {
    const composite = buildTokenCompositeInfo(entry.apys, { includeVaultSources });
    if (composite) {
      result.set(normAddr(entry.token), composite);
    }
  }

  return result;
};

export const findBestEarnApyInfo = (tokenApys: TokenApyEntry[], tokenAddress?: string | null): EarnApyInfo | null => {
  if (!tokenAddress) return null;
  return buildEarnApyMap(tokenApys).get(normAddr(tokenAddress)) || null;
};

export const findBestNonVaultEarnApyInfo = (tokenApys: TokenApyEntry[], tokenAddress?: string | null): EarnApyInfo | null => {
  if (!tokenAddress) return null;
  return buildEarnApyMap(tokenApys, { includeVaultSources: false }).get(normAddr(tokenAddress)) || null;
};

export const findVaultEarnApyInfo = (tokenApys: TokenApyEntry[]): EarnApyInfo | null => {
  for (const entry of tokenApys) {
    const info = buildVaultInfo(entry.apys);
    if (info) return info;
  }
  return null;
};

export const findPoolEarnApyInfo = (
  tokenApys: TokenApyEntry[],
  poolAddress?: string | null
): EarnApyInfo | null => {
  const normalizedPoolAddress = normAddr(poolAddress || "");
  if (!normalizedPoolAddress) return null;
  for (const entry of tokenApys) {
    const info = buildPoolInfos(entry.apys).find((item) => normAddr(item.poolAddress || "") === normalizedPoolAddress);
    if (info) return info;
  }
  return null;
};

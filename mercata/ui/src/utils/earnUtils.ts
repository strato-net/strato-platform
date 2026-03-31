import { ApySource, TokenApyEntry } from "@mercata/shared-types";

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

export interface EarnApyLookupOptions {
  includeVaultSources?: boolean;
}

const normAddr = (value: string) => (value || "").toLowerCase().replace(/^0x/, "");

const parsePositiveApy = (value?: string | null): number => {
  if (!value || value === "-") return 0;
  const apy = Number(value);
  return Number.isFinite(apy) && apy > 0 ? apy : 0;
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

const buildVaultInfo = (apys: ApySource[]): EarnApyInfo | null => {
  const vault = apys.find((item) => item.source === "vault");
  const vaultWeighted = apys.find((item) => item.source === "vault_weighted");
  const rewards = apys.find((item) => item.source === "rewards");
  const breakdown = [
    toBreakdownItem("Native APY", vault),
    toBreakdownItem("Base APY", vaultWeighted),
    toBreakdownItem("Rewards APY", rewards),
  ].filter((item): item is EarnApyBreakdownItem => item !== null);
  const total = breakdown.reduce((sum, item) => sum + parsePositiveApy(item.apy), 0);
  return total > 0 ? { total, source: "vault", breakdown } : null;
};

const buildPoolInfos = (apys: ApySource[]): EarnApyInfo[] => {
  const poolGroups = new Map<string, ApySource[]>();
  apys.forEach((item, index) => {
    if (item.source !== "swap" && item.source !== "weighted_swap") return;
    const key = item.poolAddress ? `pool:${item.poolAddress}` : `pool:${item.meta || index}`;
    if (!poolGroups.has(key)) poolGroups.set(key, []);
    poolGroups.get(key)!.push(item);
  });

  const infos: EarnApyInfo[] = [];
  poolGroups.forEach((items) => {
    const swap = items.find((item) => item.source === "swap");
    const weightedSwap = items.find((item) => item.source === "weighted_swap");
    const breakdown = [
      toBreakdownItem("Native APY", swap),
      toBreakdownItem("Base APY", weightedSwap),
    ].filter((item): item is EarnApyBreakdownItem => item !== null);
    const total = breakdown.reduce((sum, item) => sum + parsePositiveApy(item.apy), 0);
    if (total <= 0) return;
    infos.push({
      total,
      source: "swap",
      poolAddress: swap?.poolAddress || weightedSwap?.poolAddress,
      breakdown,
    });
  });

  return infos;
};

const withNativeApyOverride = (info: EarnApyInfo | null, nativeApyRaw?: string | null): EarnApyInfo | null => {
  const nativeApy = parsePositiveApy(nativeApyRaw);
  if (!info || nativeApy <= 0 || info.source !== "swap") return info;

  const breakdown = info.breakdown.map((item, index) =>
    index === 0 ? { ...item, apy: nativeApy.toFixed(2) } : item
  );
  const total = breakdown.reduce((sum, item) => sum + parsePositiveApy(item.apy), 0);
  return total > 0 ? { ...info, total, breakdown } : info;
};

export const buildEarnApyMap = (
  tokenApys: TokenApyEntry[],
  options?: EarnApyLookupOptions
): Map<string, EarnApyInfo> => {
  const includeVaultSources = options?.includeVaultSources !== false;
  const result = new Map<string, EarnApyInfo>();

  for (const entry of tokenApys) {
    const candidates: EarnApyInfo[] = [];
    const base = buildSimpleInfo(entry.apys.find((item) => item.source === "base"), "base", "Base APY");
    const lending = buildSimpleInfo(entry.apys.find((item) => item.source === "lending"), "lending", "Native APY");
    const safety = buildSimpleInfo(entry.apys.find((item) => item.source === "safety"), "safety", "Native APY");
    const vault = includeVaultSources ? buildVaultInfo(entry.apys) : null;

    if (base) candidates.push(base);
    if (lending) candidates.push(lending);
    if (safety) candidates.push(safety);
    if (vault) candidates.push(vault);
    candidates.push(...buildPoolInfos(entry.apys));

    const best = candidates.reduce<EarnApyInfo | null>(
      (currentBest, candidate) => (!currentBest || candidate.total > currentBest.total ? candidate : currentBest),
      null
    );
    if (best) {
      result.set(normAddr(entry.token), best);
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
  poolAddress?: string | null,
  nativeApyRaw?: string | null
): EarnApyInfo | null => {
  const normalizedPoolAddress = normAddr(poolAddress || "");
  if (!normalizedPoolAddress) return null;
  for (const entry of tokenApys) {
    const info = buildPoolInfos(entry.apys).find((item) => normAddr(item.poolAddress || "") === normalizedPoolAddress);
    if (info) return withNativeApyOverride(info, nativeApyRaw);
  }
  return null;
};

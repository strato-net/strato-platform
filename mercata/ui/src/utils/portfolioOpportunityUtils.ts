import type { Token as WalletToken } from "@mercata/shared-types";
import type { TokenApyEntry } from "@mercata/shared-types";
import type { Pool } from "@/interface";
import { WAD } from "@/lib/constants";
import { findBestEarnApyInfo } from "@/utils/earnUtils";

/** Min USD (oracle × balance) for idle-holdings and similar portfolio prompts. */
export const MIN_PORTFOLIO_IDLE_USD = 10;

/** Aligns with Earn “top pool” eligibility when TVL is available. */
export const TOP_OPPORTUNITY_MIN_POOL_TVL = 100000n * WAD;

export function parsePoolApySort(value: string | number | undefined): number {
  if (!value || value === "-") return Number.NEGATIVE_INFINITY;
  const apy = Number(value);
  if (!Number.isFinite(apy)) return Number.NEGATIVE_INFINITY;
  if (apy <= 0 || Math.abs(apy) < 0.005) return Number.NEGATIVE_INFINITY;
  return apy;
}

export function safeBigIntLoose(value: string | undefined | null): bigint {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}

export function isPoolPaused(pool: Pool): boolean {
  return Boolean((pool as { isPaused?: boolean }).isPaused);
}

export function isPoolDisabled(pool: Pool): boolean {
  return Boolean((pool as { isDisabled?: boolean }).isDisabled);
}

export function walletTokenUsdApprox(token: WalletToken): number {
  try {
    const b = BigInt(token.balance || "0");
    if (b <= 0n) return 0;
    const p = BigInt(String(token.price || "0"));
    if (p <= 0n) return 0;
    return Number((b * p) / WAD) / Number(WAD);
  } catch {
    return 0;
  }
}

export function normalizeTokenAddress(addr: string): string {
  return addr.trim().toLowerCase().replace(/^0x/i, "");
}

export function tokenAddressesEqual(a: string, b: string): boolean {
  return normalizeTokenAddress(a) === normalizeTokenAddress(b);
}

/** True when this wallet token is the Save vault’s configured deposit asset (from `/earn/save-usdst/info`). */
export function isSaveVaultDepositAsset(
  tokenAddress: string,
  save:
    | {
        deployed?: boolean;
        assetAddress?: string;
      }
    | null
    | undefined
): boolean {
  if (!save?.deployed || !save.assetAddress || !tokenAddress) return false;
  return tokenAddressesEqual(tokenAddress, save.assetAddress);
}

export function poolContainsTokenAddress(pool: Pool, tokenAddress: string): boolean {
  const a = normalizeTokenAddress(tokenAddress);
  if (pool.tokenA?.address && normalizeTokenAddress(pool.tokenA.address) === a) return true;
  if (pool.tokenB?.address && normalizeTokenAddress(pool.tokenB.address) === a) return true;
  return Boolean(pool.coins?.some((c) => c.address && normalizeTokenAddress(c.address) === a));
}

export function getPoolEarnApySortValue(pool: Pool, tokenApys: TokenApyEntry[] | undefined): number {
  const info = findBestEarnApyInfo(tokenApys || [], pool.lpToken?.address);
  if (info) return info.total;
  return parsePoolApySort(pool.apy);
}

/**
 * For each token address that appears in any pool, the single best pool to suggest (by earn APY, TVL gate).
 */
export function buildBestPoolMapByTokenAddress(
  pools: Pool[] | undefined,
  tokenApys: TokenApyEntry[] | undefined
): Map<string, Pool> {
  const list = [...(pools || [])].filter((p) => !isPoolPaused(p) && !isPoolDisabled(p));
  const map = new Map<string, Pool>();

  const pickBest = (candidates: Pool[]): Pool | null => {
    if (candidates.length === 0) return null;
    const withTvl = candidates.filter((p) => safeBigIntLoose(p.totalLiquidityUSD) >= TOP_OPPORTUNITY_MIN_POOL_TVL);
    const poolset = withTvl.length > 0 ? withTvl : candidates;
    return (
      [...poolset].sort(
        (x, y) => getPoolEarnApySortValue(y, tokenApys) - getPoolEarnApySortValue(x, tokenApys)
      )[0] ?? null
    );
  };

  const allAddrs = new Set<string>();
  for (const pool of list) {
    if (pool.tokenA?.address) allAddrs.add(normalizeTokenAddress(pool.tokenA.address));
    if (pool.tokenB?.address) allAddrs.add(normalizeTokenAddress(pool.tokenB.address));
    for (const c of pool.coins || []) {
      if (c.address) allAddrs.add(normalizeTokenAddress(c.address));
    }
  }
  for (const addr of allAddrs) {
    const containing = list.filter((p) => poolContainsTokenAddress(p, addr));
    const best = pickBest(containing);
    if (best) map.set(addr, best);
  }
  return map;
}

import { useMemo, useCallback } from "react";
import type { EarningAsset } from "@mercata/shared-types";
import { useEarnContext } from "@/context/EarnContext";
import { useLendingContext } from "@/context/LendingContext";
import { useSwapContext } from "@/context/SwapContext";
import { useVaultContext } from "@/context/VaultContext";
import {
  earnApyRowBuckets,
  findBestEarnApyInfo,
  findBestNonVaultEarnApyInfo,
  findPoolEarnApyInfo,
  findVaultEarnApyInfo,
  type EarnApyInfo,
} from "@/utils/earnUtils";
import { getPortfolioAssetHref } from "@/utils/portfolioAssetRoutes";

const normAddr = (value?: string | null) => (value || "").toLowerCase().replace(/^0x/, "");

export type PortfolioEarningRow = {
  asset: EarningAsset;
  valueUsd: number;
  apyTotal: number | null;
  apyInfo: EarnApyInfo | null;
  breakdownLabel: string;
  estAnnualUsd: number | null;
  href: string;
  pool: unknown;
  isLPToken: boolean;
};

function breakdownToLabel(info: EarnApyInfo | null): string {
  if (!info?.breakdown?.length) return "—";
  return info.breakdown.map((b) => `${b.apy}% ${b.label}`).join(" + ");
}

/** Value-weighted Native / Base / Rewards APY and matching est. annual $ (same weights as blended APY). */
export type PortfolioYieldRollup = {
  nativeApy: number;
  baseApy: number;
  rewardsApy: number;
  estNativeUsd: number;
  estBaseUsd: number;
  estRewardsUsd: number;
};

/** All portfolio yield rollups use only `earningAssets` (user positions from `/tokens/v2/earning-assets`). */
export function usePortfolioEarningRows(earningAssets: EarningAsset[]) {
  const { tokenApys } = useEarnContext();
  const { liquidityInfo } = useLendingContext();
  const { pools } = useSwapContext();
  const { vaultState } = useVaultContext();

  const lpTokenPoolMap = useMemo(() => {
    const map = new Map<string, unknown>();
    pools?.forEach((pool: { lpToken?: { address?: string } }) => {
      const addr = pool.lpToken?.address;
      if (addr) map.set(normAddr(addr), pool);
    });
    return map;
  }, [pools]);

  const resolveTokenAPY = useCallback(
    (token: EarningAsset, pool?: unknown): { value: string | null; info: EarnApyInfo | null } => {
      if (liquidityInfo?.withdrawable?.address === token.address) {
        const info = findBestNonVaultEarnApyInfo(tokenApys, token.address);
        return { value: info ? info.total.toFixed(2) : null, info };
      }

      if (token._symbol === "SUSDST" || token._symbol === "safetyUSDST") {
        return { value: null, info: null };
      }

      if (
        token._symbol?.endsWith("-LP") ||
        token.description === "Liquidity Provider Token" ||
        token.isPoolToken
      ) {
        const p =
          (pool as { address?: string; lpToken?: { address?: string; _symbol?: string } } | null) ||
          (lpTokenPoolMap.get(normAddr(token.address)) as typeof pool) ||
          pools?.find(
            (candidate: { lpToken?: { _symbol?: string } }) => candidate.lpToken?._symbol === token._symbol
          );
        const lpTokenAddr = (p as { lpToken?: { address?: string } } | null)?.lpToken?.address || token.address;
        const poolContractAddr = (p as { address?: string } | null)?.address;
        /** Pool-scoped APYs (swap / weighted_swap / base / rewards) often live under pool address in token-apys, not LP token row — use findPoolEarnApyInfo first. */
        const poolInfo = poolContractAddr ? findPoolEarnApyInfo(tokenApys, poolContractAddr) : null;
        const lpRowInfo = findBestEarnApyInfo(tokenApys, lpTokenAddr);
        const info = poolInfo ?? lpRowInfo;
        return {
          value: info ? info.total.toFixed(2) : null,
          info,
        };
      }

      if (vaultState.shareTokenAddress && token.address === vaultState.shareTokenAddress) {
        const info = findVaultEarnApyInfo(tokenApys);
        return {
          value: info
            ? info.total.toFixed(2)
            : vaultState.alpha && vaultState.alpha !== "0" && vaultState.alpha !== "-"
              ? vaultState.alpha
              : null,
          info,
        };
      }

      const info = findBestNonVaultEarnApyInfo(tokenApys, token.address);
      return {
        value: info ? info.total.toFixed(2) : null,
        info,
      };
    },
    [liquidityInfo?.withdrawable?.address, lpTokenPoolMap, pools, tokenApys, vaultState.alpha, vaultState.shareTokenAddress]
  );

  const { rows, blendedApy, totalEstAnnualUsd, totalEarningValueUsd, bestApyRow, portfolioYieldRollup } = useMemo(() => {
    const sorted = [...earningAssets].sort((a, b) => {
      const vA = parseFloat(a.value || "0");
      const vB = parseFloat(b.value || "0");
      return vB - vA;
    });

    const rowsInner: PortfolioEarningRow[] = [];
    let weightTotal = 0;
    let weightedNativeSum = 0;
    let weightedBaseSum = 0;
    let weightedRewardsSum = 0;
    let estNativeSum = 0;
    let estBaseSum = 0;
    let estRewardsSum = 0;
    let valueSum = 0;
    let best: PortfolioEarningRow | null = null;

    for (const asset of sorted) {
      const valueUsd = parseFloat(asset.value || "0") || 0;
      const pool =
        lpTokenPoolMap.get(normAddr(asset.address)) ||
        pools?.find(
          (candidate: { lpToken?: { _symbol?: string } }) => candidate.lpToken?._symbol === asset._symbol
        );

      const { value: apyStr, info } = resolveTokenAPY(asset, pool);
      const apyTotal = apyStr != null ? parseFloat(apyStr) : null;
      const apyNum = apyTotal != null && Number.isFinite(apyTotal) ? apyTotal : null;

      const estAnnualUsd = valueUsd > 0 && apyNum != null ? (valueUsd * apyNum) / 100 : null;

      if (valueUsd > 0) {
        valueSum += valueUsd;
      }
      if (valueUsd > 0 && apyNum != null && apyNum > 0) {
        weightTotal += valueUsd;

        const buckets = earnApyRowBuckets(info, apyNum);
        weightedNativeSum += valueUsd * buckets.native;
        weightedBaseSum += valueUsd * buckets.base;
        weightedRewardsSum += valueUsd * buckets.rewards;
        estNativeSum += (valueUsd * buckets.native) / 100;
        estBaseSum += (valueUsd * buckets.base) / 100;
        estRewardsSum += (valueUsd * buckets.rewards) / 100;
      }

      const row: PortfolioEarningRow = {
        asset,
        valueUsd,
        apyTotal: apyNum,
        apyInfo: info,
        breakdownLabel: breakdownToLabel(info),
        estAnnualUsd,
        href: getPortfolioAssetHref(asset),
        pool: pool || null,
        isLPToken: !!(
          asset.isPoolToken ||
          asset._symbol?.endsWith("-LP") ||
          asset.description === "Liquidity Provider Token"
        ),
      };
      rowsInner.push(row);

      if (apyNum != null && apyNum > 0 && valueUsd > 0) {
        if (!best || (best.apyTotal ?? 0) < apyNum) best = row;
      }
    }

    const portfolioYieldRollupInner: PortfolioYieldRollup | null =
      weightTotal > 0
        ? {
            nativeApy: weightedNativeSum / weightTotal,
            baseApy: weightedBaseSum / weightTotal,
            rewardsApy: weightedRewardsSum / weightTotal,
            estNativeUsd: estNativeSum,
            estBaseUsd: estBaseSum,
            estRewardsUsd: estRewardsSum,
          }
        : null;

    /** Same as sum of Native + Base + Rewards $/yr (value-weighted breakdown from each row’s Earn APY lines). */
    const totalEstAnnualFromBuckets = estNativeSum + estBaseSum + estRewardsSum;

    const blendedApyInner =
      portfolioYieldRollupInner != null
        ? portfolioYieldRollupInner.nativeApy +
          portfolioYieldRollupInner.baseApy +
          portfolioYieldRollupInner.rewardsApy
        : null;

    return {
      rows: rowsInner,
      blendedApy: blendedApyInner,
      totalEstAnnualUsd: totalEstAnnualFromBuckets,
      totalEarningValueUsd: valueSum,
      bestApyRow: best,
      portfolioYieldRollup: portfolioYieldRollupInner,
    };
  }, [earningAssets, lpTokenPoolMap, pools, resolveTokenAPY]);

  return { rows, blendedApy, totalEstAnnualUsd, totalEarningValueUsd, bestApyRow, portfolioYieldRollup };
}

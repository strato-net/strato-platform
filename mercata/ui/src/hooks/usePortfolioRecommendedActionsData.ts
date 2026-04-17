import { useMemo } from "react";
import type { Pool } from "@/interface";
import { useTokenContext } from "@/context/TokenContext";
import { useEarnContext } from "@/context/EarnContext";
import { useSaveUsdstContext } from "@/context/SaveUsdstContext";
import { useSwapContext } from "@/context/SwapContext";
import { useLendingContext } from "@/context/LendingContext";
import { useVaultContext } from "@/context/VaultContext";
import { useYieldVaultContext } from "@/hooks/useYieldVaultContext";
import { useRewardsActivities } from "@/hooks/useRewardsActivities";
import { mUsdstAddress } from "@/lib/constants";
import { buildNativeRewardsApyInfo, findBestEarnApyInfo, findVaultEarnApyInfo } from "@/utils/earnUtils";
import {
  MIN_PORTFOLIO_IDLE_USD,
  TOP_OPPORTUNITY_MIN_POOL_TVL,
  isPoolDisabled,
  isPoolPaused,
  parsePoolApySort,
  safeBigIntLoose,
  tokenAddressesEqual,
  walletTokenUsdApprox,
} from "@/utils/portfolioOpportunityUtils";

const YIELD_VAULTS = [
  { key: "eth-carry" as const, shortTitle: "ETH Carry Vault" },
  { key: "wbtc-carry" as const, shortTitle: "wBTC Carry Vault" },
];

type OpportunityRow =
  | { kind: "saveUsdst"; apySortValue: number }
  | { kind: "vault"; apySortValue: number }
  | { kind: "lending"; apySortValue: number }
  | { kind: "pool"; apySortValue: number; pool: Pool }
  | { kind: "yieldVault"; apySortValue: number; vaultIndex: number };

/**
 * Idle wallet token (inactive list) with largest USD value, for “Move to Easy Savings” copy.
 */
export function usePortfolioRecommendedActionsData(isLoggedIn: boolean) {
  const { inactiveTokens } = useTokenContext();
  const { tokenApys, tokenApysLoaded } = useEarnContext();
  const { saveUsdstInfo } = useSaveUsdstContext();
  const { pools } = useSwapContext();
  const { liquidityInfo } = useLendingContext();
  const { vaultState } = useVaultContext();
  const { vaults: yieldVaults } = useYieldVaultContext();
  const { activities: rewardsActivities } = useRewardsActivities();

  const saveUsdstRewardsActivity = useMemo(() => {
    const vault = saveUsdstInfo?.vaultAddress;
    if (!vault) return null;
    return (
      rewardsActivities.find(
        (activity) =>
          activity.sourceContract && tokenAddressesEqual(activity.sourceContract, vault)
      ) || null
    );
  }, [rewardsActivities, saveUsdstInfo?.vaultAddress]);

  const saveUsdstTvl = useMemo(() => {
    if (saveUsdstInfo?.deployed && saveUsdstInfo.tvlUsd) return saveUsdstInfo.tvlUsd;
    if (saveUsdstInfo?.deployed && saveUsdstInfo.pricingAssets) return saveUsdstInfo.pricingAssets;
    if (saveUsdstInfo?.deployed && saveUsdstInfo.totalAssets) return saveUsdstInfo.totalAssets;
    return saveUsdstRewardsActivity?.totalStakeUsd || "0";
  }, [saveUsdstInfo, saveUsdstRewardsActivity]);

  const saveUsdstApyInfo = useMemo(
    () => findBestEarnApyInfo(tokenApys, saveUsdstInfo?.vaultAddress),
    [saveUsdstInfo?.vaultAddress, tokenApys]
  );

  const vaultEarnApyInfo = useMemo(() => findVaultEarnApyInfo(tokenApys), [tokenApys]);
  const lendingEarnApyInfo = useMemo(() => findBestEarnApyInfo(tokenApys, mUsdstAddress), [tokenApys]);

  const rewardActivityByContract = useMemo(() => {
    const map = new Map<string, { emissionRate: bigint; totalStakeUsd: string | null }>();
    for (const activity of rewardsActivities || []) {
      const contract = activity.sourceContract?.toLowerCase();
      if (!contract) continue;
      try {
        map.set(contract, {
          emissionRate: BigInt(activity.emissionRate || "0"),
          totalStakeUsd: activity.totalStakeUsd ?? null,
        });
      } catch {
        map.set(contract, { emissionRate: 0n, totalStakeUsd: activity.totalStakeUsd ?? null });
      }
    }
    return map;
  }, [rewardsActivities]);

  const vaultRewardActivity = rewardActivityByContract.get(vaultState.shareTokenAddress?.toLowerCase() || "");

  const resolvedVaultApyInfo = useMemo(
    () =>
      vaultEarnApyInfo ||
      buildNativeRewardsApyInfo(
        vaultState.alpha,
        vaultRewardActivity?.emissionRate ? vaultRewardActivity.emissionRate.toString() : null,
        vaultRewardActivity?.totalStakeUsd ?? vaultState.totalEquity ?? null,
        "vault"
      ),
    [
      vaultEarnApyInfo,
      vaultRewardActivity?.emissionRate,
      vaultRewardActivity?.totalStakeUsd,
      vaultState.alpha,
      vaultState.totalEquity,
    ]
  );

  const saveUsdstDisplayApyRaw = saveUsdstApyInfo?.total.toFixed(2);
  const vaultDisplayApyRaw = resolvedVaultApyInfo ? resolvedVaultApyInfo.total.toFixed(2) : vaultState.alpha;
  const lendingDisplayApyRaw = lendingEarnApyInfo?.total.toFixed(2);

  const getPoolEarnApyInfo = (pool: Pool) => findBestEarnApyInfo(tokenApys, pool.lpToken?.address);
  const getPoolDisplayApy = (pool: Pool) => {
    const info = getPoolEarnApyInfo(pool);
    return info ? info.total.toFixed(2) : undefined;
  };

  const sortedPools = useMemo(() => {
    return [...(pools || [])]
      .filter((pool) => !isPoolPaused(pool) && !isPoolDisabled(pool))
      .sort((a, b) => parsePoolApySort(b.apy) - parsePoolApySort(a.apy));
  }, [pools]);

  const getOpportunityTvl = (opportunity: OpportunityRow): bigint => {
    if (opportunity.kind === "saveUsdst") return safeBigIntLoose(saveUsdstTvl);
    if (opportunity.kind === "vault") return safeBigIntLoose(vaultState.totalEquity);
    if (opportunity.kind === "lending") return safeBigIntLoose(liquidityInfo?.totalUSDSTSupplied?.toString());
    if (opportunity.kind === "yieldVault") {
      const vData = yieldVaults[YIELD_VAULTS[opportunity.vaultIndex].key];
      return safeBigIntLoose(vData?.tvlUsd);
    }
    return safeBigIntLoose(opportunity.pool.totalLiquidityUSD);
  };

  const getOpportunitySimplicityRank = (opportunity: OpportunityRow): number => {
    if (opportunity.kind === "saveUsdst") return 0;
    if (opportunity.kind === "vault") return 1;
    if (opportunity.kind === "yieldVault") return 2;
    if (opportunity.kind === "lending") return 3;
    return 4;
  };

  const compareOpportunities = (a: OpportunityRow, b: OpportunityRow): number => {
    if (b.apySortValue !== a.apySortValue) return b.apySortValue - a.apySortValue;
    const simplicityDiff = getOpportunitySimplicityRank(a) - getOpportunitySimplicityRank(b);
    if (simplicityDiff !== 0) return simplicityDiff;
    const tvlA = getOpportunityTvl(a);
    const tvlB = getOpportunityTvl(b);
    if (tvlA !== tvlB) return tvlA > tvlB ? -1 : 1;
    return 0;
  };

  const isEligibleForTopOpportunity = (opportunity: OpportunityRow): boolean => {
    if (opportunity.kind !== "pool") return true;
    return getOpportunityTvl(opportunity) >= TOP_OPPORTUNITY_MIN_POOL_TVL;
  };

  const rankedTopCandidates = useMemo<OpportunityRow[]>(() => {
    const candidates: OpportunityRow[] = [
      { kind: "saveUsdst", apySortValue: parsePoolApySort(saveUsdstDisplayApyRaw) },
      { kind: "vault", apySortValue: parsePoolApySort(vaultDisplayApyRaw) },
      ...YIELD_VAULTS.map((v, i) => ({
        kind: "yieldVault" as const,
        apySortValue: yieldVaults[v.key]?.deployed ? parsePoolApySort(yieldVaults[v.key]?.apy) : Number.NEGATIVE_INFINITY,
        vaultIndex: i,
      })),
      { kind: "lending", apySortValue: parsePoolApySort(lendingDisplayApyRaw) },
      ...sortedPools.map((pool) => ({
        kind: "pool" as const,
        apySortValue: parsePoolApySort(getPoolDisplayApy(pool)),
        pool,
      })),
    ];
    const rankedCandidates = [...candidates].sort(compareOpportunities);
    const eligible = rankedCandidates.filter(isEligibleForTopOpportunity);
    return eligible.length > 0 ? eligible : rankedCandidates;
  }, [
    lendingDisplayApyRaw,
    liquidityInfo?.totalUSDSTSupplied,
    saveUsdstDisplayApyRaw,
    saveUsdstTvl,
    sortedPools,
    tokenApys,
    vaultDisplayApyRaw,
    vaultState.totalEquity,
    yieldVaults,
  ]);

  const topOpportunity = rankedTopCandidates[0] ?? null;

  const topEarnDisplay = useMemo(() => {
    if (!topOpportunity) return null;
    const apyNum =
      topOpportunity.apySortValue > Number.NEGATIVE_INFINITY ? topOpportunity.apySortValue : null;
    if (topOpportunity.kind === "saveUsdst") {
      return {
        title: "Easy Savings",
        apy: apyNum,
        path: "/dashboard/earn-save",
      };
    }
    if (topOpportunity.kind === "vault") {
      return { title: "Diversified Vault", apy: apyNum, path: "/dashboard/earn-vault" };
    }
    if (topOpportunity.kind === "yieldVault") {
      const cfg = YIELD_VAULTS[topOpportunity.vaultIndex];
      const live = yieldVaults[cfg.key]?.deployed;
      return {
        title: cfg.shortTitle,
        apy: live ? parsePoolApySort(yieldVaults[cfg.key]?.apy) : null,
        path: `/dashboard/earn-yield-vault?vault=${cfg.key}`,
      };
    }
    if (topOpportunity.kind === "lending") {
      return { title: "USDST Lending", apy: apyNum, path: "/dashboard/earn-lending" };
    }
    const pool = topOpportunity.pool;
    const name = pool.lpToken?._symbol || pool.poolName || "Pool";
    return {
      title: name,
      apy: apyNum,
      path: `/dashboard/earn-pools?pool=${pool.address}`,
    };
  }, [topOpportunity, yieldVaults]);

  const easySavingsApyPct = useMemo(() => {
    const v = saveUsdstApyInfo?.total;
    return v != null && Number.isFinite(v) ? v : null;
  }, [saveUsdstApyInfo]);

  const idleTop = useMemo(() => {
    if (!isLoggedIn || !inactiveTokens?.length) return null;
    let best: { usd: number; symbol: string } | null = null;
    for (const t of inactiveTokens) {
      const usd = walletTokenUsdApprox(t);
      if (usd < MIN_PORTFOLIO_IDLE_USD) continue;
      if (!best || usd > best.usd) {
        best = { usd, symbol: t._symbol || t._name || "Token" };
      }
    }
    return best;
  }, [isLoggedIn, inactiveTokens]);

  const loading = !tokenApysLoaded;

  return {
    idleTop,
    easySavingsApyPct,
    topEarnDisplay,
    loading,
  };
}

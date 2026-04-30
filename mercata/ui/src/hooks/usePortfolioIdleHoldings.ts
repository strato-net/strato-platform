import { useMemo } from "react";
import { useTokenContext } from "@/context/TokenContext";
import { useEarnContext } from "@/context/EarnContext";
import { useSaveUsdstContext } from "@/context/SaveUsdstContext";
import { useSwapContext } from "@/context/SwapContext";
import { findBestEarnApyInfo } from "@/utils/earnUtils";
import {
  MIN_PORTFOLIO_IDLE_USD,
  buildBestPoolMapByTokenAddress,
  isSaveVaultDepositAsset,
  normalizeTokenAddress,
  walletTokenUsdApprox,
} from "@/utils/portfolioOpportunityUtils";

export type IdleHoldingRow = {
  address: string;
  symbol: string;
  valueUsd: number;
  opportunity: string;
  actionLabel: "Earn" | "Explore";
  to: string;
};

export function usePortfolioIdleHoldings(isLoggedIn: boolean) {
  const { inactiveTokens } = useTokenContext();
  const { tokenApys, tokenApysLoaded } = useEarnContext();
  const { saveUsdstInfo, loadingSaveUsdst } = useSaveUsdstContext();
  const { pools } = useSwapContext();

  const saveUsdstApyInfo = useMemo(
    () => findBestEarnApyInfo(tokenApys, saveUsdstInfo?.vaultAddress),
    [saveUsdstInfo?.vaultAddress, tokenApys]
  );

  const easySavingsApyPct = useMemo(() => {
    const v = saveUsdstApyInfo?.total;
    return v != null && Number.isFinite(v) ? v : null;
  }, [saveUsdstApyInfo]);

  const bestPoolForToken = useMemo(
    () => buildBestPoolMapByTokenAddress(pools, tokenApys),
    [pools, tokenApys]
  );

  const rows = useMemo((): IdleHoldingRow[] => {
    if (!isLoggedIn || !inactiveTokens?.length) return [];

    const out: IdleHoldingRow[] = [];
    for (const t of inactiveTokens) {
      const valueUsd = walletTokenUsdApprox(t);
      if (valueUsd < MIN_PORTFOLIO_IDLE_USD) continue;
      const address = t.address || "";
      if (!address) continue;
      const symbol = t._symbol || t._name || "Token";

      if (isSaveVaultDepositAsset(address, saveUsdstInfo)) {
        const apyText =
          easySavingsApyPct != null ? `${easySavingsApyPct.toFixed(1)}%` : null;
        out.push({
          address,
          symbol,
          valueUsd,
          opportunity: apyText
            ? `Move to Easy Savings at ${apyText}`
            : "Move to Easy Savings",
          actionLabel: "Earn",
          to: "/dashboard/earn-save",
        });
        continue;
      }

      const pool = bestPoolForToken.get(normalizeTokenAddress(address));
      if (pool) {
        const pair = pool.lpToken?._symbol || pool.poolName || pool.poolSymbol || "LP";
        out.push({
          address,
          symbol,
          valueUsd,
          opportunity: `Add to ${pair} LP`,
          actionLabel: "Explore",
          to: `/dashboard/earn-pools?pool=${pool.address}`,
        });
      } else {
        out.push({
          address,
          symbol,
          valueUsd,
          opportunity: "Browse Earn for pools and vaults",
          actionLabel: "Explore",
          to: "/dashboard/earn",
        });
      }
    }

    return out.sort((a, b) => b.valueUsd - a.valueUsd);
  }, [bestPoolForToken, easySavingsApyPct, inactiveTokens, isLoggedIn, saveUsdstInfo]);

  const loading = !tokenApysLoaded || loadingSaveUsdst;

  return { rows, loading };
}

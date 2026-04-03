import { useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBalance } from "@/utils/numberUtils";
import { useLendingContext } from "@/context/LendingContext";
import { useSwapContext } from "@/context/SwapContext";
import { useVaultContext } from "@/context/VaultContext";
import { useEarnContext } from "@/context/EarnContext";
import EarnApyTooltip from "@/components/earn/EarnApyTooltip";
import { findBestNonVaultEarnApyInfo, findPoolEarnApyInfo, findVaultEarnApyInfo } from "@/utils/earnUtils";
import { ChevronDown, ChevronUp } from "lucide-react";
import LPTokenDropdown from "./LPTokenDropdown";

interface PoolParticipationProps {
  poolTokens: any[];
  loading?: boolean;
  guestMode?: boolean;
}

export default function MyPoolParticipationSection({
  poolTokens,
  loading = false,
  guestMode = false,
}: PoolParticipationProps) {
  const normAddr = (value?: string | null) => (value || "").toLowerCase().replace(/^0x/, "");
  const hasData = poolTokens.length > 0;
  const shouldShowLoading = loading && !hasData;

  const { liquidityInfo, loadingLiquidity } = useLendingContext();
  const { pools, poolsLoading } = useSwapContext();
  const { vaultState } = useVaultContext();
  const { tokenApys } = useEarnContext();

  const [expandedTokens, setExpandedTokens] = useState<Record<string, boolean>>(
    {}
  );

  const lpTokenPoolMap = useMemo(() => {
    const map = new Map<string, any>();
    pools?.forEach((pool: any) => {
      const addr = pool.lpToken?.address;
      if (addr) map.set(normAddr(addr), pool);
    });
    return map;
  }, [pools]);

  const resolveTokenAPY = useCallback(
    (token: any, pool?: any): { value: string | null; info: ReturnType<typeof findBestNonVaultEarnApyInfo> } => {
      if (liquidityInfo?.withdrawable?.address === token.address) {
        const info = findBestNonVaultEarnApyInfo(tokenApys, token.address);
        return { value: info ? info.total.toFixed(2) : null, info };
      }

      if (token._symbol === "SUSDST" || token._symbol === "safetyUSDST") return { value: null, info: null };

      if (
        token._symbol?.endsWith("-LP") ||
        token.description === "Liquidity Provider Token"
      ) {
        const resolvedPool =
          pool ||
          lpTokenPoolMap.get(normAddr(token.address)) ||
          pools?.find((candidate: any) => candidate.lpToken?._symbol === token._symbol);
        const info = resolvedPool ? findPoolEarnApyInfo(tokenApys, resolvedPool.address) : null;
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
    [liquidityInfo, lpTokenPoolMap, pools, tokenApys, vaultState.alpha, vaultState.shareTokenAddress]
  );

  const rows = useMemo(
    () =>
      poolTokens.map((token) => {
        const balance = BigInt(token.balance || "0");
        const collateral = BigInt(token.collateralBalance || "0");
        const total = balance + collateral;

        const isLPToken =
          token._symbol?.endsWith("-LP") ||
          token.description === "Liquidity Provider Token";

        const pool = isLPToken
          ? lpTokenPoolMap.get(normAddr(token.address)) || pools?.find((candidate: any) => candidate.lpToken?._symbol === token._symbol) || null
          : null;

        const rawValue = token.value ? parseFloat(token.value) : 0;

        const apyInfo = resolveTokenAPY(token, pool);

        return {
          token,
          formattedBalance:
            total > 0n
              ? formatBalance(
                  total.toString(),
                  undefined,
                  token.customDecimals || 18,
                  2,
                  2
                )
              : "-",
          apy: apyInfo.value,
          apyInfo: apyInfo.info,
          value: rawValue > 0 ? `$${rawValue.toFixed(2)}` : "-",
          isLPToken,
          pool,
        };
      }),
    [lpTokenPoolMap, poolTokens, pools, resolveTokenAPY]
  );

  const anyLoading = poolsLoading || loadingLiquidity || vaultState.loading;

  const toggleExpanded = (tokenAddress: string) => {
    setExpandedTokens((prev) => ({
      ...prev,
      [tokenAddress]: !prev[tokenAddress],
    }));
  };

  return (
    <Card className="rounded-xl shadow-sm w-full mb-6">
      <CardHeader className="pb-2 md:pb-4">
        <CardTitle className="text-base md:text-lg font-semibold text-foreground">
          My Pool Participation
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 md:space-y-4 px-3 md:px-6">
        {/* Header Row - 3 columns on mobile, 4 on desktop */}
        <div className="grid grid-cols-3 md:grid-cols-4 px-3 md:px-4 text-xs md:text-sm text-muted-foreground font-medium">
          <div>Token</div>
          <div className="text-right md:text-center">Balance</div>
          <div className="hidden md:block text-center">Best Available APY</div>
          <div className="text-right">Value</div>
        </div>

        {shouldShowLoading ? (
          <div className="flex items-center justify-center gap-2 py-4">
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary" />
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : !hasData ? (
          <div className="p-4 flex justify-center text-muted-foreground text-sm">
            No pool tokens found
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(
              ({ token, formattedBalance, apy, apyInfo, value, isLPToken, pool }) => {
                const isExpanded = !!expandedTokens[token.address];
                const canExpand = isLPToken && pool && formattedBalance !== "-";

                return (
                  <div key={token.address} className="space-y-0">
                    <div
                      className="grid grid-cols-3 md:grid-cols-4 items-center bg-muted/30 px-3 md:px-4 py-2.5 md:py-3 rounded-lg"
                    >
                      <div className="flex items-center gap-1.5 md:gap-2 min-w-0">
                        <Link
                          to={`/dashboard/deposits/${token.address}`}
                          className="font-medium text-sm md:text-base text-blue-600 hover:text-blue-800 underline transition-colors truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {token._symbol || token._name}
                        </Link>
                        {canExpand && (
                          <button 
                            className="cursor-pointer hover:opacity-70 shrink-0 p-0.5"
                            onClick={() => toggleExpanded(token.address)}
                          >
                            {isExpanded ? (
                              <ChevronUp size={14} className="md:w-4 md:h-4" />
                            ) : (
                              <ChevronDown size={14} className="md:w-4 md:h-4" />
                            )}
                          </button>
                        )}
                      </div>

                      <div className="text-right md:text-center text-sm md:text-base font-semibold text-foreground">
                        {formattedBalance}
                      </div>

                      <div className="hidden md:flex text-center font-semibold text-foreground justify-center">
                        {guestMode ? (
                          "N/A"
                        ) : anyLoading ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary" />
                        ) : apy ? (
                          <EarnApyTooltip info={apyInfo}>
                            <span className="cursor-default">{apy}%</span>
                          </EarnApyTooltip>
                        ) : (
                          "N/A"
                        )}
                      </div>

                      <div className="text-right text-sm md:text-base font-medium text-foreground">
                        {value}
                      </div>
                    </div>

                    {canExpand && (
                      <LPTokenDropdown
                        lpToken={pool}
                        isExpanded={isExpanded}
                        className="px-3 md:px-4"
                      />
                    )}
                  </div>
                );
              }
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBalance } from "@/utils/numberUtils";
import { useLendingContext } from "@/context/LendingContext";
import { useSwapContext } from "@/context/SwapContext";
import { ChevronDown, ChevronUp } from "lucide-react";
import LPTokenDropdown from "./LPTokenDropdown";

interface PoolParticipationProps {
  poolTokens: any[];
  loading?: boolean;
}

export default function MyPoolParticipationSection({
  poolTokens,
  loading = false,
}: PoolParticipationProps) {
  const hasData = poolTokens.length > 0;
  const shouldShowLoading = loading && !hasData;

  const { liquidityInfo, loadingLiquidity } = useLendingContext();
  const { pools, poolsLoading } = useSwapContext();

  const [expandedTokens, setExpandedTokens] = useState<Record<string, boolean>>(
    {}
  );

  const lpTokenPoolMap = useMemo(() => {
    const map = new Map<string, any>();
    pools?.forEach((pool: any) => {
      const addr = pool.lpToken?.address;
      if (addr) map.set(addr, pool);
    });
    return map;
  }, [pools]);

  const resolveTokenAPY = useCallback(
    (token: any): string | null => {
      if (liquidityInfo?.withdrawable?.address === token.address) {
        return liquidityInfo.supplyAPY?.toFixed(2) || null;
      }

      if (token._symbol === "SUSDST" || token._symbol === "SAFETYUSDST") return null;

      if (
        token._symbol?.endsWith("-LP") ||
        token.description === "Liquidity Provider Token"
      ) {
        return lpTokenPoolMap.get(token.address)?.apy || null;
      }

      return null;
    },
    [liquidityInfo, lpTokenPoolMap]
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

        const pool = isLPToken ? lpTokenPoolMap.get(token.address) : null;

        const rawValue = token.value ? parseFloat(token.value) : 0;

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
          apy: resolveTokenAPY(token),
          value: rawValue > 0 ? `$${rawValue.toFixed(2)}` : "-",
          isLPToken,
          pool,
        };
      }),
    [poolTokens, lpTokenPoolMap, resolveTokenAPY]
  );

  const anyLoading = poolsLoading || loadingLiquidity;

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
          <div className="hidden md:block text-center">APY</div>
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
              ({ token, formattedBalance, apy, value, isLPToken, pool }) => {
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
                        {anyLoading ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary" />
                        ) : apy ? (
                          `${apy}%`
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

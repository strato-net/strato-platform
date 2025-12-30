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

      if (token._symbol === "SUSDST") return null;

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
    <Card className="rounded-none md:rounded-2xl border-x-0 md:border-x shadow-sm w-full mb-6">
      <CardHeader className="px-3 md:px-6 py-3 md:py-4">
        <CardTitle className="text-base md:text-lg font-semibold text-foreground whitespace-nowrap">
          My Pool Participation
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-2 md:space-y-4 px-2 md:px-6">
        {/* Header Row */}
        <div className="grid grid-cols-4 px-2 md:px-4 text-[10px] md:text-sm text-muted-foreground font-medium">
          <div>Token</div>
          <div className="text-center">Balance</div>
          <div className="text-center">APY</div>
          <div className="text-right">Value</div>
        </div>

        {shouldShowLoading ? (
          <div className="flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 md:h-5 md:w-5 border-t-2 border-b-2 border-primary" />
            <span className="text-xs md:text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : !hasData ? (
          <div className="p-2 flex justify-center text-xs md:text-sm text-muted-foreground">
            No pool tokens found
          </div>
        ) : (
          <div className="space-y-1.5 md:space-y-2">
            {rows.map(
              ({ token, formattedBalance, apy, value, isLPToken, pool }) => {
                const isExpanded = !!expandedTokens[token.address];
                const canExpand = isLPToken && pool && formattedBalance !== "-";

                return (
                  <div key={token.address} className="space-y-0">
                    <div
                      className={`grid grid-cols-4 items-center bg-muted/30 px-2 md:px-4 py-2 md:py-3 rounded-md`}
                    >
                      <div className="flex items-center gap-1 md:gap-2 min-w-0">
                        <Link
                          to={`/dashboard/deposits/${token.address}`}
                          className="text-xs md:text-sm font-medium text-blue-600 hover:text-blue-800 underline transition-colors truncate"
                          onClick={(e) => e.stopPropagation()}
                          title={token._name || token._symbol}
                        >
                          {token._symbol || token._name}
                        </Link>
                        {canExpand &&
                          <div 
                            className="cursor-pointer hover:opacity-70 shrink-0"
                            onClick={() => toggleExpanded(token.address)}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-3 h-3 md:w-4 md:h-4" />
                            ) : (
                              <ChevronDown className="w-3 h-3 md:w-4 md:h-4" />
                            )}
                          </div>
                        }
                      </div>

                      <div className="text-center text-xs md:text-sm font-semibold text-foreground">
                        {formattedBalance}
                      </div>

                      <div className="text-center text-xs md:text-sm font-semibold text-foreground">
                        {anyLoading ? (
                          <div className="flex items-center justify-center">
                            <div className="animate-spin rounded-full h-3 w-3 md:h-4 md:w-4 border-t-2 border-b-2 border-primary" />
                          </div>
                        ) : apy ? (
                          `${apy}%`
                        ) : (
                          "N/A"
                        )}
                      </div>

                      <div className="text-right text-xs md:text-sm font-medium text-foreground">
                        {value}
                      </div>
                    </div>

                    {canExpand && (
                      <LPTokenDropdown
                        lpToken={pool}
                        isExpanded={isExpanded}
                        className="px-1 md:px-4"
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

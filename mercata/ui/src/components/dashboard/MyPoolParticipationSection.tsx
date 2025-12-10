import { useMemo, useState, useCallback } from "react";
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
    <Card className="rounded-2xl shadow-sm w-full mb-6">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-foreground">
          My Pool Participation
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Header Row */}
        <div className="grid grid-cols-4 px-4 text-sm text-muted-foreground font-medium">
          <div>Token</div>
          <div className="text-center">Balance</div>
          <div className="text-center">APY</div>
          <div className="text-right">Value</div>
        </div>

        {shouldShowLoading ? (
          <div className="flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary" />
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : !hasData ? (
          <div className="p-2 flex justify-center text-muted-foreground">
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
                      className={`grid grid-cols-4 items-center bg-muted/30 px-4 py-3 rounded-md ${
                        canExpand ? "cursor-pointer hover:bg-muted/50" : ""
                      }`}
                      onClick={() => canExpand && toggleExpanded(token.address)}
                    >
                      <div className="flex items-center gap-2 font-semibold text-foreground/80">
                        {token._name || token._symbol}
                        {canExpand &&
                          (isExpanded ? (
                            <ChevronUp size={16} />
                          ) : (
                            <ChevronDown size={16} />
                          ))}
                      </div>

                      <div className="text-center font-semibold text-foreground">
                        {formattedBalance}
                      </div>

                      <div className="text-center font-semibold text-foreground">
                        {anyLoading ? (
                          <div className="flex items-center justify-center">
                            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary" />
                          </div>
                        ) : apy ? (
                          `${apy}%`
                        ) : (
                          "N/A"
                        )}
                      </div>

                      <div className="text-right font-medium text-foreground">
                        {value}
                      </div>
                    </div>

                    {canExpand && (
                      <LPTokenDropdown
                        lpToken={pool}
                        isExpanded={isExpanded}
                        className="px-4"
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

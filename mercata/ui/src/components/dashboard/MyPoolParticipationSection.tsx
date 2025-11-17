import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBalance } from "@/utils/numberUtils";
import { useLendingContext } from "@/context/LendingContext";
import { useSwapContext } from "@/context/SwapContext";

interface PoolParticipationProps {
  poolTokens: any[];
  loading?: boolean;
}

export default function MyPoolParticipationSection({ 
  poolTokens,
  loading = false
}: PoolParticipationProps) {
  const hasData = poolTokens.length > 0;
  const shouldShowLoading = loading && !hasData;
  const { liquidityInfo, loadingLiquidity } = useLendingContext();
  const { pools, poolsLoading } = useSwapContext();

  const lpTokenApyMap = useMemo(() => {
    const map = new Map<string, string>();
    pools?.forEach((pool: any) => {
      if (pool.lpToken?.address && pool.apy) {
        map.set(pool.lpToken.address, pool.apy);
      }
    });
    return map;
  }, [pools]);

  const rows = useMemo(() => {
    const resolveTokenAPY = (token: any): string | null => {
      if (liquidityInfo?.withdrawable?.address === token.address) {
        return liquidityInfo.supplyAPY?.toFixed(2) || null;
      }
      
      if (token._symbol === "SUSDST") {
        return null;
      }
      
      if (token._symbol?.endsWith("-LP") || token.description === "Liquidity Provider Token") {
        return lpTokenApyMap.get(token.address) || null;
      }
      
      return null;
    };

    return poolTokens.map((token) => {
      const balance = BigInt(token.balance || "0");
      const collateral = BigInt(token.collateralBalance || "0");
      const total = balance + collateral;

      return {
        token,
        total,
        formattedBalance: total > 0n
          ? formatBalance(total.toString(), undefined, token.customDecimals || 18, 2, 2)
          : "-",
        apy: resolveTokenAPY(token),
        value: token.value && parseFloat(token.value) > 0
          ? `$${parseFloat(token.value).toFixed(2)}`
          : "-"
      };
    });
  }, [poolTokens, lpTokenApyMap, liquidityInfo]);

  const anyLoading = poolsLoading || loadingLiquidity;

  return (
    <Card className="rounded-2xl shadow-sm w-full mb-6">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-gray-800">
          My Pool Participation
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Header Row */}
        <div className="grid grid-cols-4 px-4 text-sm text-gray-500 font-medium">
          <div>Token</div>
          <div className="text-center">Balance</div>
          <div className="text-center">APY</div>
          <div className="text-right">Value</div>
        </div>

        {shouldShowLoading ? (
          <div className="flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
            <span className="text-sm text-gray-600">Loading...</span>
          </div>
        ) : poolTokens.length === 0 ? (
          <div className="p-2 flex justify-center text-gray-500">No pool tokens found</div>
        ) : (
          <div className="space-y-2">
            {rows.map(({ token, formattedBalance, apy, value }) => (
              <div key={token.address} className="grid grid-cols-4 items-center bg-gray-50 px-4 py-3 rounded-md">
                <div className="font-semibold text-gray-700">{token._name || token._symbol}</div>
                <div className="text-center font-semibold text-gray-900">{formattedBalance}</div>
                <div className="text-center font-semibold text-gray-900">
                  {anyLoading ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary"></div>
                    </div>
                  ) : apy ? (
                    `${apy}%`
                  ) : (
                    "N/A"
                  )}
                </div>
                <div className="text-right font-medium text-gray-900">{value}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

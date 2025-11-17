import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBalance } from "@/utils/numberUtils";

interface PoolParticipationProps {
  poolTokens: any[];
  loading?: boolean;
  shouldPreventFlash?: boolean;
}

export default function MyPoolParticipationSection({ 
  poolTokens,
  loading = false,
  shouldPreventFlash = false
}: PoolParticipationProps) {
  const shouldShowLoading = loading && !shouldPreventFlash;

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
        ) : (
          <>
            {poolTokens.length > 0 ? (
              <div className="space-y-2">
                {poolTokens.map((token) => {
                  const totalBalance = BigInt(token.balance || "0") + BigInt(token.collateralBalance || "0");
                  const hasBalance = totalBalance > 0n;
                  
                  return (
                    <div key={token.address} className="grid grid-cols-4 items-center bg-gray-50 px-4 py-3 rounded-md mb-2">
                      <div className="font-semibold text-gray-700">{token._name || token._symbol}</div>
                      <div className="text-center font-semibold text-gray-900">
                        {hasBalance
                          ? formatBalance(totalBalance.toString(), undefined, token.customDecimals || 18, 2, 2)
                          : "-"}
                      </div>
                      <div className="text-center font-semibold text-gray-900">N/A</div>
                      <div className="text-right font-medium text-gray-900">
                        {token.value && parseFloat(token.value) > 0
                          ? `$${parseFloat(token.value).toFixed(2)}`
                          : "-"}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-2 flex justify-center text-gray-500">No pool tokens found</div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

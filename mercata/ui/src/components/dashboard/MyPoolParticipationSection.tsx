import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBalance } from "@/utils/numberUtils";
import { formatUnits } from "ethers";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import LPTokenDropdown from "./LPTokenDropdown";
import { PoolParticipationProps } from "@/interface";

export default function MyPoolParticipationSection({ 
  liquidityInfo, 
  loadingLiquidity, 
  userPools, 
  loadingUserPools,
  shouldPreventFlash = false,
  safetyInfo,
  loadingSafety = false
}: PoolParticipationProps) {
  
  const [expandedTokens, setExpandedTokens] = useState<Set<string>>(new Set());
  
  const formatValue = (rawBalance: string, price: string): string => {
    if (!rawBalance || !price) return "0.00";

    const balance = parseFloat(formatUnits(rawBalance, 18));
    const priceValue = parseFloat(formatUnits(price, 18));
    const value = balance * priceValue;

    return value.toFixed(2);
  };

  // Helper variables for sUSDST calculations
  const sUSDSTBalance = safetyInfo?.userShares && BigInt(safetyInfo.userShares) > 0n;
  const sUsdstExchangeRate = safetyInfo?.exchangeRate ? parseFloat(formatUnits(safetyInfo.exchangeRate, 18)) : 1;
  const sUsdstApy = safetyInfo?.exchangeRate ? `${((sUsdstExchangeRate - 1) * 100).toFixed(2)}%` : "N/A";
  const sUsdstValue = safetyInfo?.exchangeRate ? `$${formatValue(safetyInfo.userShares, safetyInfo.exchangeRate)}` : "$0.00";

  const toggleTokenExpansion = (tokenAddress: string) => {
    const newExpanded = new Set(expandedTokens);
    if (newExpanded.has(tokenAddress)) {
      newExpanded.delete(tokenAddress);
    } else {
      newExpanded.add(tokenAddress);
    }
    setExpandedTokens(newExpanded);
  };

  // Don't show loading indicator immediately if shouldPreventFlash is true
  const shouldShowLoading = (loadingLiquidity || loadingUserPools || loadingSafety) && !shouldPreventFlash;

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
            {/* Lending Pool Row */}
            {liquidityInfo?.withdrawable ? (
              <div className="grid grid-cols-4 items-center bg-gray-50 px-4 py-3 rounded-md mb-2">
                <div className="font-semibold text-gray-700">{liquidityInfo.withdrawable._name}</div>
                <div className="text-center font-semibold text-gray-900">
                  {liquidityInfo?.withdrawable?.userBalance
                      ? formatBalance(liquidityInfo?.withdrawable?.userBalance,undefined,18,2,2)
                      : "0.00"}
                </div>
                <div className="text-center font-semibold text-gray-900">
                  {liquidityInfo?.supplyAPY ? `${liquidityInfo.supplyAPY}%` : "N/A"}
                </div>
                <div className="text-right font-medium text-gray-900">
                  {liquidityInfo?.withdrawable?.withdrawValue
                    ? `$${Number(formatUnits(liquidityInfo?.withdrawable?.withdrawValue, 18)).toFixed(2)}`
                    : "$0.00"}
                </div>
              </div>
            ) : null}

            {/* SUSDST Row */}
            {sUSDSTBalance && (
              <div className="grid grid-cols-4 items-center bg-gray-50 px-4 py-3 rounded-md mb-2">
                <div className="font-semibold text-gray-700">sUSDST</div>
                <div className="text-center font-semibold text-gray-900">
                  {formatBalance(safetyInfo.userShares, undefined, 18, 2, 2)}
                </div>
                <div className="text-center font-semibold text-gray-900">
                  {sUsdstApy}
                </div>
                <div className="text-right font-medium text-gray-900">
                  {sUsdstValue}
                </div>
              </div>
            )}

            {/* LP Token Rows */}
            {userPools.length > 0 ? (
              <div className="space-y-2">
                {userPools.map((userPool, idx) => {
                  const tokenAddress = userPool?.lpToken?.address || `token-${idx}`;
                  const isExpanded = expandedTokens.has(tokenAddress);
                  
                  return (
                    <div key={tokenAddress}>
                      {/* Clickable LP Token Row */}
                      <div 
                        className="grid grid-cols-4 items-center bg-gray-50 px-4 py-3 rounded-md mb-2 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => toggleTokenExpansion(tokenAddress)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-700">{userPool.lpToken._name}</span>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-gray-500" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-gray-500" />
                          )}
                        </div>
                        <div className="text-center font-semibold text-gray-900">
                          {userPool?.lpToken?.balance
                            ? formatBalance(userPool?.lpToken?.balance,undefined,18,2,2)
                            : "0.00"}
                        </div>
                        <div className="text-center font-semibold text-gray-900">
                          {userPool?.apy ? `${userPool.apy}%` : "N/A"}
                        </div>
                        <div className="text-right font-medium text-gray-900">
                          {userPool?.lpToken?._totalSupply
                            ? `$${formatValue(userPool?.lpToken?.balance, userPool?.lpToken?.price)}`
                            : "$0.00"}
                        </div>
                      </div>
                      
                      {/* Dropdown with detailed breakdown */}
                      <LPTokenDropdown
                        lpToken={userPool}
                        className="mb-2"
                        isExpanded={isExpanded}
                      />
                    </div>
                  );
                })}
              </div>
            ) : !liquidityInfo?.withdrawable && Array.isArray(userPools) && userPools.length === 0 ? (
              <div className="p-2 flex justify-center text-gray-500">No LP tokens found</div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

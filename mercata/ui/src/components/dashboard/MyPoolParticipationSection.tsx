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
import { useUser } from "@/context/UserContext";

interface PoolParticipationProps {
  liquidityInfo: any;
  loadingLiquidity: any;
  lpTokens: any;
  loadingLpTokens: any;
  shouldPreventFlash?: boolean;
}

export default function MyPoolParticipationSection({ 
  liquidityInfo, 
  loadingLiquidity, 
  lpTokens, 
  loadingLpTokens,
  shouldPreventFlash = false
}: PoolParticipationProps) {
  
  const [expandedTokens, setExpandedTokens] = useState<Set<string>>(new Set());
  const { userAddress } = useUser();
  
  // Helper function to get user's LP token balance
  const getUserLPBalance = (lpToken: any): string => {
    if (!lpToken?.lpToken?.balances || !userAddress) return "0";
    const userBalance = lpToken.lpToken.balances.find((b: any) => b.user === userAddress);
    return userBalance?.balance || "0";
  };

  // Calculate mark-to-market value using user's actual token quantities
  const calculateMarkToMarketValue = (lpToken: any): string => {
    const userLPBalance = getUserLPBalance(lpToken);
    if (!userLPBalance || userLPBalance === "0") return "0.00";

    const totalSupply = lpToken?.lpToken?._totalSupply || "0";
    if (totalSupply === "0") return "0.00";

    // Calculate user's share
    const userShare = BigInt(userLPBalance) / BigInt(totalSupply);
    
    // Calculate user's token quantities
    const userTokenA = (BigInt(lpToken.tokenABalance || "0") * userShare).toString();
    const userTokenB = (BigInt(lpToken.tokenBBalance || "0") * userShare).toString();
    
    // Calculate USD values
    const tokenAValue = (BigInt(userTokenA) * BigInt(lpToken.tokenAPrice || "0")) / BigInt(10 ** 18);
    const tokenBValue = (BigInt(userTokenB) * BigInt(lpToken.tokenBPrice || "0")) / BigInt(10 ** 18);
    
    const totalValue = tokenAValue + tokenBValue;
    return (Number(totalValue) / 10 ** 18).toFixed(2);
  };

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
  const shouldShowLoading = (loadingLiquidity || loadingLpTokens) && !shouldPreventFlash;

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

            {/* LP Token Rows */}
            {lpTokens.length > 0 ? (
              <div className="space-y-2">
                {lpTokens.map((lpToken, idx) => {
                  const tokenAddress = lpToken?.lpToken?.address || `token-${idx}`;
                  const isExpanded = expandedTokens.has(tokenAddress);
                  
                  return (
                    <div key={tokenAddress}>
                      {/* Clickable LP Token Row */}
                      <div 
                        className="grid grid-cols-4 items-center bg-gray-50 px-4 py-3 rounded-md mb-2 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => toggleTokenExpansion(tokenAddress)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-700">{lpToken.lpToken._name}</span>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-gray-500" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-gray-500" />
                          )}
                        </div>
                        <div className="text-center font-semibold text-gray-900">
                          {getUserLPBalance(lpToken) !== "0"
                            ? formatBalance(getUserLPBalance(lpToken), undefined, 18, 6, 12)
                            : "0.00"}
                        </div>
                        <div className="text-center font-semibold text-gray-900">
                          {lpToken?.apy ? `${lpToken.apy}%` : "N/A"}
                        </div>
                        <div className="text-right font-medium text-gray-900">
                          {getUserLPBalance(lpToken) !== "0"
                            ? `$${calculateMarkToMarketValue(lpToken)}`
                            : "$0.00"}
                        </div>
                      </div>
                      
                      {/* Dropdown with detailed breakdown */}
                      <LPTokenDropdown
                        lpToken={lpToken}
                        className="mb-2"
                        isExpanded={isExpanded}
                      />
                    </div>
                  );
                })}
              </div>
            ) : !liquidityInfo?.withdrawable && Array.isArray(lpTokens) && lpTokens.length === 0 ? (
              <div className="p-2 flex justify-center text-gray-500">No LP tokens found</div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

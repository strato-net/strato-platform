import { formatBalance } from "@/utils/numberUtils";

interface LPTokenDropdownProps {
  lpToken: any;
  className?: string;
  isExpanded: boolean;
}

export default function LPTokenDropdown({ lpToken, className = "", isExpanded }: LPTokenDropdownProps) {
  const userShare = lpToken?.lpToken?._totalSupply && lpToken?.lpToken?.balances?.[0]?.balance
    ? Number((BigInt(lpToken.lpToken.balances[0].balance) * 10000n) / BigInt(lpToken.lpToken._totalSupply)) / 100
    : 0;

  const tokenQuantities = lpToken?.lpToken?.balances?.[0]?.balance && lpToken?.lpToken?._totalSupply ? {
    tokenA: ((BigInt(lpToken.lpToken.balances[0].balance) * BigInt(lpToken.tokenABalance || "0")) / BigInt(lpToken.lpToken._totalSupply)).toString(),
    tokenB: ((BigInt(lpToken.lpToken.balances[0].balance) * BigInt(lpToken.tokenBBalance || "0")) / BigInt(lpToken.lpToken._totalSupply)).toString()
  } : { tokenA: "0", tokenB: "0" };

  return (
    <div className={`${className}`}>
      {isExpanded && (
        <div className="p-3 bg-white border border-gray-200 rounded-md mb-2">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-700 mb-2">
              Your Position Breakdown ({userShare < 0.01 ? '<0.01' : userShare.toFixed(2)}% share):
            </div>
            
            {/* Token A */}
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                {lpToken.tokenA?.images?.[0]?.value ? (
                  <img
                    src={lpToken.tokenA.images[0].value}
                    alt={lpToken.tokenA._symbol}
                    className="w-6 h-6 rounded-full"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                    <span className="text-xs font-medium text-blue-600">
                      {lpToken.tokenA._symbol?.slice(0, 2)}
                    </span>
                  </div>
                )}
                <span className="text-sm font-medium text-gray-700">
                  {lpToken.tokenA._name} ({lpToken.tokenA._symbol})
                </span>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-gray-900">
                  {formatBalance(tokenQuantities.tokenA, lpToken.tokenA._symbol, 18, 6, 12)}
                </div>
                <div className="text-xs text-gray-500">
                  {formatBalance(
                    (BigInt(tokenQuantities.tokenA) * BigInt(lpToken.tokenAPrice || "0")) / BigInt(10 ** 18),
                    undefined, 18, 2, 2, true
                  )}
                </div>
              </div>
            </div>
            
            {/* Token B */}
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                {lpToken.tokenB?.images?.[0]?.value ? (
                  <img
                    src={lpToken.tokenB.images[0].value}
                    alt={lpToken.tokenB._symbol}
                    className="w-6 h-6 rounded-full"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
                    <span className="text-xs font-medium text-green-600">
                      {lpToken.tokenB._symbol?.slice(0, 2)}
                    </span>
                  </div>
                )}
                <span className="text-sm font-medium text-gray-700">
                  {lpToken.tokenB._name} ({lpToken.tokenB._symbol})
                </span>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-gray-900">
                  {formatBalance(tokenQuantities.tokenB, lpToken.tokenB._symbol, 18, 6, 12)}
                </div>
                <div className="text-xs text-gray-500">
                  {formatBalance(
                    (BigInt(tokenQuantities.tokenB) * BigInt(lpToken.tokenBPrice || "0")) / BigInt(10 ** 18),
                    undefined, 18, 2, 2, true
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 
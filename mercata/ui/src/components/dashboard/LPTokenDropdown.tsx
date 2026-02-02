import { formatBalance } from "@/utils/numberUtils";
import { LPTokenDropdownProps } from "@/interface";

export default function LPTokenDropdown({ lpToken, className = "", isExpanded }: LPTokenDropdownProps) {
  const userShare = lpToken?.lpToken?._totalSupply && lpToken?.lpToken?.balance
    ? Number((BigInt(lpToken.lpToken.balance) * 10000n) / BigInt(lpToken.lpToken._totalSupply)) / 100
    : 0;

  const tokenQuantities = lpToken?.lpToken?.balance && lpToken?.lpToken?._totalSupply ? {
    tokenA: ((BigInt(lpToken.lpToken.balance) * BigInt(lpToken.tokenA.poolBalance || "0")) / BigInt(lpToken.lpToken._totalSupply)).toString(),
    tokenB: ((BigInt(lpToken.lpToken.balance) * BigInt(lpToken.tokenB.poolBalance || "0")) / BigInt(lpToken.lpToken._totalSupply)).toString()
  } : { tokenA: "0", tokenB: "0" };

  return (
    <div className={`${className}`}>
      {isExpanded && (
        <div className="p-3 bg-card border border-border rounded-md mb-2">
          <div className="space-y-3">
            <div className="text-sm font-medium text-foreground mb-2">
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
                  <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <span className="text-xs font-medium text-blue-500">
                      {lpToken.tokenA._symbol?.slice(0, 2)}
                    </span>
                  </div>
                )}
                <span className="text-sm font-medium text-foreground">
                  {lpToken.tokenA._name} ({lpToken.tokenA._symbol})
                </span>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-foreground">
                  {formatBalance(tokenQuantities.tokenA, lpToken.tokenA._symbol, 18, 6, 12)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatBalance(
                    (BigInt(tokenQuantities.tokenA) * BigInt(lpToken.tokenA.price || "0")) / BigInt(10 ** 18),
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
                  <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                    <span className="text-xs font-medium text-green-500">
                      {lpToken.tokenB._symbol?.slice(0, 2)}
                    </span>
                  </div>
                )}
                <span className="text-sm font-medium text-foreground">
                  {lpToken.tokenB._name} ({lpToken.tokenB._symbol})
                </span>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-foreground">
                  {formatBalance(tokenQuantities.tokenB, lpToken.tokenB._symbol, 18, 6, 12)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatBalance(
                    (BigInt(tokenQuantities.tokenB) * BigInt(lpToken.tokenB.price || "0")) / BigInt(10 ** 18),
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
import { useState } from "react";
import { ChevronDown, ChevronUp, Wallet, Percent, Coins, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useVaultContext } from "@/context/VaultContext";
import { formatUnits } from "ethers";

const formatUsd = (value: string): string => {
  try {
    const num = parseFloat(formatUnits(value, 18));
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return "0.00";
  }
};

const formatShares = (value: string): string => {
  try {
    const num = parseFloat(formatUnits(value, 18));
    if (num === 0) return "0";
    return num.toLocaleString("en-US", {
      maximumFractionDigits: 6,
    });
  } catch {
    return "0";
  }
};

const formatPercent = (value: string): string => {
  try {
    const num = parseFloat(value);
    if (num === 0) return "0";
    if (num < 0.01) return "<0.01";
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return "0";
  }
};

const formatTokenAmount = (value: string, decimals: number = 18): string => {
  try {
    const num = parseFloat(formatUnits(value, decimals));
    if (num === 0) return "0";
    if (num < 0.0001) return "<0.0001";
    return num.toLocaleString("en-US", {
      maximumFractionDigits: 6,
    });
  } catch {
    return "0";
  }
};

interface VaultUserPositionProps {
  onDeposit: () => void;
  onWithdraw: () => void;
}

const VaultUserPosition = ({ onDeposit, onWithdraw }: VaultUserPositionProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { vaultState } = useVaultContext();
  const {
    userShares,
    userValueUsd,
    ownershipPercent,
    totalShares,
    assets,
    paused,
    loadingUser,
    shareTokenSymbol,
  } = vaultState;

  const hasPosition = BigInt(userShares || "0") > BigInt(0);
  const totalSharesBigInt = BigInt(totalShares || "1");

  // Calculate pro-rata holdings for each asset
  const proRataHoldings = assets.map((asset) => {
    const assetBalance = BigInt(asset.balance || "0");
    const userSharesBigInt = BigInt(userShares || "0");

    // user's share of this asset = (userShares / totalShares) * assetBalance
    const userAmount = totalSharesBigInt > BigInt(0)
      ? (userSharesBigInt * assetBalance) / totalSharesBigInt
      : BigInt(0);

    return {
      ...asset,
      userAmount: userAmount.toString(),
    };
  });

  if (loadingUser) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Your Position
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Your Position
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasPosition ? (
          <div className="text-center py-4">
            <p className="text-muted-foreground mb-4">
              You don't have any vault shares yet. Deposit tokens to start earning.
            </p>
            <Button onClick={onDeposit} disabled={paused}>
              Make Your First Deposit
            </Button>
          </div>
        ) : (
          <>
            {/* Position Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-muted/50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Coins className="h-4 w-4" />
                  Your Shares
                </div>
                <div className="text-2xl font-bold">
                  {formatShares(userShares)}
                </div>
                <div className="text-xs text-muted-foreground">{shareTokenSymbol}</div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Wallet className="h-4 w-4" />
                  USD Value
                </div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  ${formatUsd(userValueUsd)}
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Percent className="h-4 w-4" />
                  Ownership
                </div>
                <div className="text-2xl font-bold">
                  {formatPercent(ownershipPercent)}%
                </div>
              </div>
            </div>

            {/* Pro-rata Holdings (Collapsible) */}
            {assets.length > 0 && (
              <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between">
                    <span className="text-sm">Pro-rata Token Holdings</span>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                    {proRataHoldings.map((holding) => (
                      <div
                        key={holding.address}
                        className="flex items-center justify-between py-2 border-b border-border last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          {holding.images?.[0]?.value ? (
                            <img
                              src={holding.images[0].value}
                              alt={holding.symbol}
                              className="w-6 h-6 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-xs text-white font-medium">
                              {holding.symbol?.slice(0, 2)}
                            </div>
                          )}
                          <span className="font-medium">{holding.symbol}</span>
                        </div>
                        <span className="font-mono text-sm">
                          {formatTokenAmount(holding.userAmount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Action Buttons */}
            <div className="flex gap-4">
              <Button
                onClick={onDeposit}
                disabled={paused}
                className="flex-1"
              >
                Deposit
              </Button>
              <Button
                onClick={onWithdraw}
                disabled={paused || !hasPosition}
                variant="outline"
                className="flex-1"
              >
                Withdraw
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default VaultUserPosition;

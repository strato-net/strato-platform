import { useState } from "react";
import { Wallet, TrendingUp, AlertTriangle, Pause, Coins, ChevronDown, ChevronUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import AssetSummary from "@/components/dashboard/AssetSummary";
import { useVaultContext } from "@/context/VaultContext";
import { formatUnits } from "ethers";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";

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

const formatApy = (value: string): { formatted: string; isPositive: boolean; isNeutral: boolean } => {
  // If vault is too young, show "-"
  if (value === "-") return { formatted: "-", isPositive: true, isNeutral: true };

  try {
    // APY is returned as a percentage number (e.g., "26.50" for 26.50%)
    const num = parseFloat(value);
    if (isNaN(num)) return { formatted: "-", isPositive: true, isNeutral: true };
    
    const isPositive = num >= 0;
    const isNeutral = num === 0;
    const absFormatted = Math.abs(num).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const formatted = (isPositive ? "+" : "-") + absFormatted + "%";
    
    return { formatted: isNeutral ? "0.00%" : formatted, isPositive, isNeutral };
  } catch {
    return { formatted: "-", isPositive: true, isNeutral: true };
  }
};

const formatShares = (value: string): string => {
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

const formatTokenBalance = (value: string): string => {
  try {
    const num = parseFloat(formatUnits(value, 18));
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

const VaultOverview = () => {
  const [isTokensOpen, setIsTokensOpen] = useState(false);
  const { vaultState } = useVaultContext();
  const {
    totalEquity,
    totalShares,
    apy,
    paused,
    assets,
    loading,
  } = vaultState;

  // Check for tokens near minimum reserve (< 110% of minReserve)
  const tokensNearMinReserve = assets.filter((asset) => {
    const balance = BigInt(asset.balance || "0");
    const minReserve = BigInt(asset.minReserve || "0");
    const threshold = (minReserve * BigInt(110)) / BigInt(100);
    return balance > BigInt(0) && minReserve > BigInt(0) && balance < threshold;
  });

  const showWarning = paused || tokensNearMinReserve.length > 0;

  return (
    <div className="space-y-6">


      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <AssetSummary
          title="TVL"
          value={`$${formatUsd(totalEquity)}`}
          icon={<Wallet className="text-white" size={18} />}
          color="bg-blue-500"
          isLoading={loading}
          tooltip="Total Net Asset Value of all tokens held in the vault"
        />

        <AssetSummary
          title="Total Shares"
          value={formatShares(totalShares)}
          icon={<Coins className="text-white" size={18} />}
          color="bg-purple-500"
          isLoading={loading}
          tooltip="Total number of vault shares in circulation"
        />

        {(() => {
          const { formatted, isPositive, isNeutral } = formatApy(apy);
          const valueColor = isNeutral ? "" : isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
          return (
            <AssetSummary
              title="APY"
              value={formatted}
              icon={<TrendingUp className="text-white" size={18} />}
              color="bg-orange-500"
              isLoading={loading}
              tooltip="Annualized percentage yield based on vault performance (30 days or since first deposit for younger vaults)"
              valueClassName={valueColor}
            />
          );
        })()}
      </div>

      {/* Vault Tokens Collapsible */}
      <Collapsible open={isTokensOpen} onOpenChange={setIsTokensOpen}>
        <Card>
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 rounded-t-lg transition-colors">
              <div className="flex items-center gap-2">
                <Coins className="h-5 w-5 text-muted-foreground" />
                <span className="font-semibold">Vault Tokens</span>
                <span className="text-sm text-muted-foreground">
                  ({assets.length} {assets.length === 1 ? "token" : "tokens"})
                </span>
              </div>
              {isTokensOpen ? (
                <ChevronUp className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              {loading ? (
                <div className="text-center py-4 text-muted-foreground">
                  Loading tokens...
                </div>
              ) : assets.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No tokens in the vault
                </div>
              ) : (
                <div className="divide-y">
                  {assets.map((asset) => (
                    <div
                      key={asset.address}
                      className="flex items-center justify-between py-3 first:pt-0"
                    >
                      <div className="flex items-center gap-3">
                        {asset.images?.[0]?.value ? (
                          <img
                            src={asset.images[0].value}
                            alt={asset.symbol}
                            className="w-8 h-8 rounded-full"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                            <span className="text-xs font-medium">
                              {asset.symbol.slice(0, 2)}
                            </span>
                          </div>
                        )}
                        <div>
                          <div className="font-medium">{asset.symbol}</div>
                          <div className="text-sm text-muted-foreground">
                            {asset.name}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">
                          {formatTokenBalance(asset.balance)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          ${formatUsd(asset.valueUsd)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
};

export default VaultOverview;

import { Wallet, TrendingUp, AlertTriangle, Pause, Coins } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import AssetSummary from "@/components/dashboard/AssetSummary";
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

const VaultOverview = () => {
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
    </div>
  );
};

export default VaultOverview;

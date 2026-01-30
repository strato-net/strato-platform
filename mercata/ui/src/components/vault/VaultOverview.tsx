import { Wallet, TrendingUp, AlertTriangle, Pause } from "lucide-react";
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

const formatApy = (value: string): string => {
  // If vault is too young, show "-"
  if (value === "-") return "-";
  
  try {
    // APY is returned as a percentage number (e.g., "26.50" for 26.50%)
    const num = parseFloat(value);
    if (isNaN(num)) return "-";
    return num.toFixed(2) + "%";
  } catch {
    return "-";
  }
};

const VaultOverview = () => {
  const { vaultState } = useVaultContext();
  const {
    totalEquity,
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
      {/* Warning Banner */}
      {showWarning && (
        <Alert variant="destructive" className="border-orange-500 bg-orange-50 dark:bg-orange-950">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <AlertDescription className="text-orange-800 dark:text-orange-200">
            {paused && (
              <div className="flex items-center gap-2 font-medium">
                <Pause className="h-4 w-4" />
                Vault is currently paused. Deposits and withdrawals are temporarily disabled.
              </div>
            )}
            {tokensNearMinReserve.length > 0 && (
              <div className="mt-1">
                {tokensNearMinReserve.length === 1
                  ? `${tokensNearMinReserve[0].symbol} is approaching minimum reserve level.`
                  : `${tokensNearMinReserve.length} tokens are approaching minimum reserve levels: ${tokensNearMinReserve.map((t) => t.symbol).join(", ")}`}
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <AssetSummary
          title="TVL"
          value={`$${formatUsd(totalEquity)}`}
          icon={<Wallet className="text-white" size={18} />}
          color="bg-blue-500"
          isLoading={loading}
          tooltip="Total Net Asset Value of all tokens held in the vault"
        />

        <AssetSummary
          title="APY (30d)"
          value={`${formatApy(apy)}`}
          icon={<TrendingUp className="text-white" size={18} />}
          color="bg-orange-500"
          isLoading={loading}
          tooltip="Annual percentage yield of the vault in the last 30 days"
        />
      </div>
    </div>
  );
};

export default VaultOverview;

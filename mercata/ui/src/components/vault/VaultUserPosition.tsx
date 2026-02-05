import { Wallet, Coins, Loader2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

const formatEarnings = (value: string): { formatted: string; isPositive: boolean; isZero: boolean } => {
  try {
    const num = parseFloat(formatUnits(value, 18));
    const isZero = num === 0;
    const isPositive = num >= 0;
    const absFormatted = Math.abs(num).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const formatted = isPositive ? `+$${absFormatted}` : `-$${absFormatted}`;
    return { formatted: isZero ? "$0.00" : formatted, isPositive, isZero };
  } catch {
    return { formatted: "$0.00", isPositive: true, isZero: true };
  }
};

interface VaultUserPositionProps {
  onDeposit: () => void;
  onWithdraw: () => void;
  guestMode?: boolean;
}

const VaultUserPosition = ({ onDeposit, onWithdraw, guestMode = false }: VaultUserPositionProps) => {
  const { vaultState } = useVaultContext();
  const {
    userShares,
    userValueUsd,
    allTimeEarnings,
    paused,
    loadingUser,
    shareTokenSymbol,
  } = vaultState;

  if (guestMode) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Your Position
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">
            Sign in to view your vault position and manage deposits or withdrawals.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasPosition = BigInt(userShares || "0") > BigInt(0);

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
            {paused && (
              <p className="text-sm text-orange-600 dark:text-orange-400 mb-2">
                Vault is paused. Deposits are disabled.
              </p>
            )}
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
                  <TrendingUp className="h-4 w-4" />
                  All-Time Earnings
                </div>
                {(() => {
                  const { formatted, isPositive, isZero } = formatEarnings(allTimeEarnings);
                  return (
                    <div className={`text-2xl font-bold ${isZero ? "" : isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                      {formatted}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-2">
              {paused && (
                <p className="text-sm text-orange-600 dark:text-orange-400 text-center">
                  Vault is paused. Deposits and withdrawals are disabled.
                </p>
              )}
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
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default VaultUserPosition;

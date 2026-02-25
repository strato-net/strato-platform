import { useState, useMemo } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useVaultContext } from "@/context/VaultContext";
import { useToast } from "@/hooks/use-toast";
import { formatUnits, parseUnits } from "ethers";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";

const MIN_FIRST_DEPOSIT_USD = 50000;

interface VaultDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const formatTokenAmount = (value: string, decimals: number = 18): string => {
  try {
    const num = parseFloat(formatUnits(value, decimals));
    if (num === 0) return "0";
    return num.toLocaleString("en-US", {
      maximumFractionDigits: 6,
    });
  } catch {
    return "0";
  }
};

const formatUsd = (value: number): string => {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const VaultDepositModal = ({ isOpen, onClose, onSuccess }: VaultDepositModalProps) => {
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [depositLoading, setDepositLoading] = useState(false);

  const { vaultState, deposit, refreshVault } = useVaultContext();
  const { toast } = useToast();
  const { userRewards } = useRewardsUserInfo();

  const {
    deficitAssets,
    totalShares,
    totalEquity,
    paused,
    userTokenBalances,
    loadingBalances,
  } = vaultState;

  const isFirstDeposit = BigInt(totalShares || "0") === BigInt(0);

  // Filter available tokens based on deficit rule
  // Backend already filters to only tokens user owns (balance > 0)
  const availableTokens = useMemo(() => {
    if (deficitAssets.length > 0) {
      // Normalize deficit addresses to lowercase for comparison
      const deficitAddressesLower = deficitAssets.map((addr) => addr.toLowerCase());
      // Only allow deposit of deficit tokens that user owns
      return userTokenBalances.filter((token) =>
        deficitAddressesLower.includes(token.address.toLowerCase())
      );
    }
    // Allow all supported tokens that user owns
    return userTokenBalances;
  }, [userTokenBalances, deficitAssets]);

  // Get the selected token's details
  const selectedTokenData = useMemo(() => {
    return availableTokens.find((t) => t.address === selectedToken);
  }, [availableTokens, selectedToken]);

  // Calculate USD value of input amount
  const usdValue = useMemo(() => {
    if (!amount || !selectedTokenData) return 0;
    try {
      const amountWei = parseUnits(amount, 18);
      const priceWei = BigInt(selectedTokenData.priceUsd || "0");
      const valueWei = (amountWei * priceWei) / BigInt(10 ** 18);
      return parseFloat(formatUnits(valueWei, 18));
    } catch {
      return 0;
    }
  }, [amount, selectedTokenData]);

  // Calculate shares to receive
  const sharesToReceive = useMemo(() => {
    if (!amount || usdValue === 0) return "0";

    const totalSharesBigInt = BigInt(totalShares || "0");
    const totalEquityBigInt = BigInt(totalEquity || "0");

    if (totalSharesBigInt === BigInt(0)) {
      // First deposit: shares = value (1:1)
      return parseUnits(usdValue.toFixed(18), 18).toString();
    }

    // Subsequent deposits: shares = (value * totalShares) / totalEquity
    const valueWei = parseUnits(usdValue.toFixed(18), 18);
    const newShares = (valueWei * totalSharesBigInt) / totalEquityBigInt;
    return newShares.toString();
  }, [amount, usdValue, totalShares, totalEquity]);

  // Validation
  const validationError = useMemo(() => {
    if (!selectedToken) return null;
    if (!amount || parseFloat(amount) <= 0) return null;

    // Check balance
    if (selectedTokenData) {
      try {
        const amountWei = parseUnits(amount, 18);
        const balanceWei = BigInt(selectedTokenData.balance || "0");
        if (amountWei > balanceWei) {
          return "Insufficient balance";
        }
      } catch {
        return "Invalid amount";
      }
    }

    // Check first deposit minimum
    if (isFirstDeposit && usdValue < MIN_FIRST_DEPOSIT_USD) {
      return `First deposit must be at least $${MIN_FIRST_DEPOSIT_USD.toLocaleString()}`;
    }

    return null;
  }, [selectedToken, amount, selectedTokenData, isFirstDeposit, usdValue]);

  const handleClose = () => {
    setSelectedToken("");
    setAmount("");
    onClose();
  };

  const handleMaxClick = () => {
    if (selectedTokenData) {
      const maxAmount = formatUnits(selectedTokenData.balance, 18);
      setAmount(maxAmount);
    }
  };

  const handleDeposit = async () => {
    if (!selectedToken || !amount || validationError) return;

    setDepositLoading(true);
    try {
      const amountWei = parseUnits(amount, 18).toString();
      await deposit({ token: selectedToken, amount: amountWei });

      toast({
        title: "Deposit Successful",
        description: `Successfully deposited ${amount} ${selectedTokenData?.symbol}`,
        variant: "success",
      });

      // Close modal first, then refresh in background
      setDepositLoading(false);
      handleClose();
      onSuccess();

      // Refresh vault data in background (don't await)
      refreshVault(false);
    } catch (err: any) {
      toast({
        title: "Deposit Failed",
        description: err.message || "An error occurred during deposit",
        variant: "destructive",
      });
      setDepositLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deposit to Vault</DialogTitle>
          <DialogDescription>
            Deposit tokens to receive vault shares.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Deficit Token Notice */}
          {deficitAssets.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Some vault assets are below minimum reserves. Only deficit tokens can be deposited.
              </AlertDescription>
            </Alert>
          )}

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Withdrawals are returned as a basket of vault tokens and may not match the token you deposited.
            </AlertDescription>
          </Alert>

          {/* Token Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Token</label>
            {!loadingBalances && availableTokens.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {deficitAssets.length > 0
                    ? "You don't own any deficit tokens. Only deficit tokens can be deposited when reserves are low."
                    : "You don't own any supported vault tokens."}
                </AlertDescription>
              </Alert>
            ) : (
              <Select
                value={selectedToken}
                onValueChange={(value) => {
                  setSelectedToken(value);
                  setAmount("");
                }}
                disabled={loadingBalances || availableTokens.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={loadingBalances ? "Loading..." : "Select a token"} />
                </SelectTrigger>
                <SelectContent>
                  {availableTokens.map((token) => (
                    <SelectItem key={token.address} value={token.address}>
                      <div className="flex items-center gap-2">
                        {token.images?.[0]?.value ? (
                          <img
                            src={token.images[0].value}
                            alt={token.symbol}
                            className="w-5 h-5 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-xs text-white">
                            {token.symbol?.slice(0, 1)}
                          </div>
                        )}
                        <span>{token.symbol}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Amount</label>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "" || /^\d*\.?\d*$/.test(value)) {
                      setAmount(value);
                    }
                  }}
                  disabled={!selectedToken}
                  className="border-none text-xl font-medium p-0 h-auto focus-visible:ring-0"
                />
                {selectedTokenData && (
                  <div className="flex items-center gap-1 bg-muted rounded-md px-2 py-1 flex-shrink-0">
                    {selectedTokenData.images?.[0]?.value ? (
                      <img
                        src={selectedTokenData.images[0].value}
                        alt={selectedTokenData.symbol}
                        className="w-5 h-5 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-purple-500" />
                    )}
                    <span className="font-medium text-sm">{selectedTokenData.symbol}</span>
                  </div>
                )}
              </div>

              {selectedTokenData && (
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground">
                    Balance: {formatTokenAmount(selectedTokenData.balance)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-blue-500"
                    onClick={handleMaxClick}
                  >
                    Max
                  </Button>
                </div>
              )}

              {validationError && (
                <p className="text-red-600 text-sm mt-2">{validationError}</p>
              )}
            </div>
          </div>

          {/* Preview Section */}
          {amount && parseFloat(amount) > 0 && !validationError && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">USD Value</span>
                <span className="font-medium">${formatUsd(usdValue)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Shares to Receive</span>
                <span className="font-medium">
                  {formatTokenAmount(sharesToReceive)} {vaultState.shareTokenSymbol}
                </span>
              </div>
            </div>
          )}

          {/* Estimated Rewards */}
          <RewardsWidget
            userRewards={userRewards}
            activityName=" Vault Token"
            inputAmount={sharesToReceive !== "0" ? formatUnits(sharesToReceive, 18) : undefined}
            actionLabel="Deposit"
          />

          {/* Submit Button */}
          <Button
            onClick={handleDeposit}
            disabled={
              depositLoading ||
              paused ||
              !selectedToken ||
              !amount ||
              !!validationError ||
              parseFloat(amount) <= 0
            }
            className="w-full"
          >
            {depositLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : paused ? (
              "Vault is Paused"
            ) : (
              "Confirm Deposit"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VaultDepositModal;

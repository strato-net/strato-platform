import { useState, useEffect, useMemo } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useVaultContext } from "@/context/VaultContext";
import { useToast } from "@/hooks/use-toast";
import { formatUnits, parseUnits } from "ethers";
import { api } from "@/lib/axios";
import WithdrawBasketPreview, { BasketItem } from "./WithdrawBasketPreview";
import { Alert, AlertDescription } from "../ui/alert";

interface VaultWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type InputMode = "usd" | "percent";

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

const VaultWithdrawModal = ({ isOpen, onClose, onSuccess }: VaultWithdrawModalProps) => {
  const [inputMode, setInputMode] = useState<InputMode>("usd");
  const [usdAmount, setUsdAmount] = useState<string>("");
  const [percentAmount, setPercentAmount] = useState<string>("");
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [basket, setBasket] = useState<BasketItem[]>([]);

  const { vaultState, withdraw, refreshVault } = useVaultContext();
  const { toast } = useToast();

  const {
    userShares,
    userValueUsd,
    withdrawableEquity,
    totalShares,
    totalEquity,
    paused,
    assets,
    shareTokenSymbol,
  } = vaultState;

  // Calculate max withdrawable based on user's position AND vault's withdrawable equity
  const maxWithdrawableUsd = useMemo(() => {
    const userValueBigInt = BigInt(userValueUsd || "0");
    const withdrawableEquityBigInt = BigInt(withdrawableEquity || "0");
    return userValueBigInt < withdrawableEquityBigInt
      ? userValueUsd
      : withdrawableEquity;
  }, [userValueUsd, withdrawableEquity]);

  // Calculate actual USD amount based on input mode
  const actualUsdAmount = useMemo(() => {
    if (inputMode === "usd") {
      if (!usdAmount || parseFloat(usdAmount) <= 0) return "0";
      try {
        return parseUnits(usdAmount, 18).toString();
      } catch {
        return "0";
      }
    } else {
      if (!percentAmount || parseFloat(percentAmount) <= 0) return "0";
      try {
        const percent = parseFloat(percentAmount);
        const userValueBigInt = BigInt(userValueUsd || "0");
        const amount = (userValueBigInt * BigInt(Math.floor(percent * 100))) / BigInt(10000);
        return amount.toString();
      } catch {
        return "0";
      }
    }
  }, [inputMode, usdAmount, percentAmount, userValueUsd]);

  // Calculate shares to burn
  const sharesToBurn = useMemo(() => {
    const amountBigInt = BigInt(actualUsdAmount || "0");
    const totalSharesBigInt = BigInt(totalShares || "1");
    const totalEquityBigInt = BigInt(totalEquity || "1");

    if (totalEquityBigInt === BigInt(0)) return "0";

    const shares = (amountBigInt * totalSharesBigInt) / totalEquityBigInt;
    return shares.toString();
  }, [actualUsdAmount, totalShares, totalEquity]);

  // Validation
  const validationError = useMemo(() => {
    const amount = BigInt(actualUsdAmount || "0");
    if (amount === BigInt(0)) return null;

    const maxAmount = BigInt(maxWithdrawableUsd || "0");
    if (amount > maxAmount) {
      return "Amount exceeds maximum withdrawable";
    }

    return null;
  }, [actualUsdAmount, maxWithdrawableUsd]);

  // Fetch basket preview when amount changes
  useEffect(() => {
    const fetchPreview = async () => {
      const amount = BigInt(actualUsdAmount || "0");
      if (amount === BigInt(0) || validationError) {
        setBasket([]);
        return;
      }

      setPreviewLoading(true);
      try {
        const res = await api.get("/vault/withdraw/preview", {
          params: { amountUsd: actualUsdAmount },
        });

        if (res.data?.basket) {
          setBasket(res.data.basket);
        }
      } catch (err) {
        console.error("Error fetching preview:", err);
        // Build a simple preview from current assets
        const totalWithdrawable = assets.reduce(
          (sum, a) => sum + BigInt(a.withdrawable || "0"),
          BigInt(0)
        );

        const previewBasket: BasketItem[] = assets.map((asset) => {
          const withdrawable = BigInt(asset.withdrawable || "0");
          const included = withdrawable > BigInt(0);
          const weight = totalWithdrawable > BigInt(0)
            ? (withdrawable * BigInt(10000)) / totalWithdrawable
            : BigInt(0);

          const tokenUsdValue = included
            ? (BigInt(actualUsdAmount) * weight) / BigInt(10000)
            : BigInt(0);

          const priceUsd = BigInt(asset.priceUsd || "1");
          const tokenAmount = priceUsd > BigInt(0)
            ? (tokenUsdValue * BigInt(10 ** 18)) / priceUsd
            : BigInt(0);

          return {
            address: asset.address,
            symbol: asset.symbol,
            name: asset.name,
            weightPercent: (Number(weight) / 100).toString(),
            usdValue: tokenUsdValue.toString(),
            tokenAmount: tokenAmount.toString(),
            included,
            images: asset.images,
          };
        });

        setBasket(previewBasket);
      } finally {
        setPreviewLoading(false);
      }
    };

    const debounce = setTimeout(fetchPreview, 300);
    return () => clearTimeout(debounce);
  }, [actualUsdAmount, validationError, assets]);

  const handleClose = () => {
    setUsdAmount("");
    setPercentAmount("");
    setBasket([]);
    onClose();
  };

  const handleMaxClick = () => {
    if (inputMode === "usd") {
      const maxUsd = formatUnits(maxWithdrawableUsd, 18);
      setUsdAmount(maxUsd);
    } else {
      setPercentAmount("100");
    }
  };

  const handleWithdraw = async () => {
    if (!actualUsdAmount || validationError) return;

    setWithdrawLoading(true);
    try {
      await withdraw({ amountUsd: actualUsdAmount });

      toast({
        title: "Withdrawal Successful",
        description: `Successfully withdrew $${formatUsd(actualUsdAmount)} from the vault`,
        variant: "success",
      });

      // Close modal first, then refresh in background
      setWithdrawLoading(false);
      handleClose();
      onSuccess();

      // Refresh vault data in background (don't await)
      refreshVault(false);
    } catch (err: any) {
      toast({
        title: "Withdrawal Failed",
        description: err.message || "An error occurred during withdrawal",
        variant: "destructive",
      });
      setWithdrawLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Withdraw from Vault</DialogTitle>
          <DialogDescription>
            Withdraw your vault shares for a basket of underlying tokens.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Max Withdrawable */}
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Your Position Value</span>
              <span className="font-medium">${formatUsd(userValueUsd)}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-muted-foreground">Max Withdrawable</span>
              <span className="font-medium text-green-600 dark:text-green-400">
                ${formatUsd(maxWithdrawableUsd)}
              </span>
            </div>
          </div>

          {/* Input Mode Toggle */}
          <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as InputMode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="usd">USD Amount</TabsTrigger>
              <TabsTrigger value="percent">% of Position</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Amount Input */}
          <div className="space-y-2">
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="0.0"
                  value={inputMode === "usd" ? usdAmount : percentAmount}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "" || /^\d*\.?\d*$/.test(value)) {
                      if (inputMode === "usd") {
                        setUsdAmount(value);
                      } else {
                        // Clamp percent to 100
                        const numValue = parseFloat(value);
                        if (!isNaN(numValue) && numValue > 100) {
                          setPercentAmount("100");
                        } else {
                          setPercentAmount(value);
                        }
                      }
                    }
                  }}
                  className="border-none text-xl font-medium p-0 h-auto focus-visible:ring-0"
                />
                <div className="flex items-center gap-1 bg-muted rounded-md px-2 py-1 flex-shrink-0">
                  <span className="font-medium text-sm">
                    {inputMode === "usd" ? "USD" : "%"}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between mt-2">
                <span className="text-sm text-muted-foreground">
                  {inputMode === "usd"
                    ? `≈ ${formatShares(sharesToBurn)} ${shareTokenSymbol}`
                    : `≈ $${formatUsd(actualUsdAmount)}`}
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

              {validationError && (
                <p className="text-red-600 text-sm mt-2">{validationError}</p>
              )}
            </div>
          </div>

          {/* Warning for skipped tokens */}
          {
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Tokens will be received based on availability.
              </AlertDescription>
            </Alert>
          }
          {/* Basket Preview */}
          {BigInt(actualUsdAmount || "0") > BigInt(0) && !validationError && (
            <>
              {previewLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <WithdrawBasketPreview
                  basket={basket}
                  totalUsd={actualUsdAmount}
                />
              )}
            </>
          )}



          {/* Shares to Burn */}
          {BigInt(actualUsdAmount || "0") > BigInt(0) && !validationError && (
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Shares to Burn</span>
                <span className="font-medium">
                  {formatShares(sharesToBurn)} {shareTokenSymbol}
                </span>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <Button
            onClick={handleWithdraw}
            disabled={
              withdrawLoading ||
              paused ||
              BigInt(actualUsdAmount || "0") === BigInt(0) ||
              !!validationError
            }
            className="w-full"
          >
            {withdrawLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : paused ? (
              "Vault is Paused"
            ) : (
              "Confirm Withdrawal"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VaultWithdrawModal;

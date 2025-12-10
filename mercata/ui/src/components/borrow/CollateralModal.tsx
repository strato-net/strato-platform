import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatUnits } from "ethers";
import { CollateralData, NewLoanData } from "@/interface";
import { safeParseUnits, addCommasToInput } from "@/utils/numberUtils";
import { 
  calculateSupplyHealthImpact, 
  calculateWithdrawHealthImpact,
  getMaxSafeWithdrawAmount 
} from "@/utils/lendingUtils";
import RiskLevelProgress from "@/components/ui/RiskLevelProgress";
import HealthImpactDisplay from "@/components/ui/HealthImpactDisplay";
import { computeMaxTransferable, handleAmountInputChange } from "@/utils/transferValidation";

type ModalType = "supply" | "withdraw";

interface CollateralModalProps {
  type: ModalType;
  loading: boolean;
  asset: CollateralData;
  loanData: NewLoanData;
  isOpen: boolean;
  onClose: () => void;
  onAction: (amount: string) => void;
  usdstBalance: string;
  voucherBalance: string;
  transactionFee: string;
}

const CollateralModal = ({
  type,
  loading,
  asset,
  loanData,
  isOpen,
  onClose,
  onAction,
  usdstBalance,
  voucherBalance,
  transactionFee,
}: CollateralModalProps) => {
  const [amount, setAmount] = useState<string>("");
  const [amountError, setAmountError] = useState<string>("");
  const [feeError, setFeeError] = useState<string>("");
  const [riskLevel, setRiskLevel] = useState(0);
  const [healthImpact, setHealthImpact] = useState({
    currentHealthFactor: 0,
    newHealthFactor: 0,
    healthImpact: 0,
    isHealthy: true,
  });

  const isSupply = type === "supply";
  const maxAmount = useMemo(() => {
    return isSupply 
      ? computeMaxTransferable(asset?.userBalance || "0", false, voucherBalance, usdstBalance, safeParseUnits(transactionFee).toString(), setFeeError)
      : computeMaxTransferable(getMaxSafeWithdrawAmount(asset, loanData).toString(), false, voucherBalance, usdstBalance, safeParseUnits(transactionFee).toString(), setFeeError)
  }, [asset, loanData, isSupply, voucherBalance, usdstBalance, transactionFee]);
  
  // NEW: reflect on-chain 1 wei safety when there is outstanding debt
  const hasDebt = BigInt(loanData?.totalAmountOwed || "0") > 0n;
  const maxDisplayAmount = (!isSupply && hasDebt && BigInt(maxAmount) > 0n) ? (BigInt(maxAmount) - 1n) : BigInt(maxAmount);

  // Calculate risk level when amount changes
  useEffect(() => {
    try {
      if (!loanData?.totalCollateralValueUSD || !loanData?.totalAmountOwed) {
        setRiskLevel(0);
        return;
      }

      const totalBorrowedBigInt = BigInt(loanData.totalAmountOwed);
      const collateralValueBigInt = BigInt(loanData.totalCollateralValueUSD);
      const amountWei = safeParseUnits(amount || "0");
      const assetPriceUSD = BigInt(asset?.assetPrice || "0");
      const amountValueUSD = (amountWei * assetPriceUSD * BigInt(asset?.liquidationThreshold || 0)) / ((BigInt(10) ** 18n) * 10000n);

      let newCollateralValue: bigint;
      if (isSupply) {
        // For supply, we're adding collateral, so risk decreases
        newCollateralValue = collateralValueBigInt + amountValueUSD;
      } else {
        // For withdraw, we're removing collateral, so risk increases
        newCollateralValue = collateralValueBigInt - amountValueUSD;
      }
      
      if (newCollateralValue === 0n) {
        setRiskLevel(0);
        return;
      }

      const risk = Number((totalBorrowedBigInt * 10000n) / newCollateralValue) / 100;
      setRiskLevel(Math.min(risk, 100));
    } catch {
      setRiskLevel(0);
    }
  }, [amount, loanData?.totalCollateralValueUSD, loanData?.totalAmountOwed, isSupply, asset?.assetPrice]);

  // Calculate health impact when amount changes
  useEffect(() => {
    const amountWei = safeParseUnits(amount || "0");
    const impact = isSupply 
      ? calculateSupplyHealthImpact(amountWei, asset, loanData)
      : calculateWithdrawHealthImpact(amountWei, asset, loanData);
    setHealthImpact(impact);
  }, [amount, asset, loanData, isSupply]);

  const handleAction = () => {
    try {
      if (!isSupply) {
        const amtWei = safeParseUnits(amount || "0");
        // If user selected at least the max, invoke on-chain max-withdraw to avoid drift issues
        if (amtWei >= maxDisplayAmount && maxDisplayAmount > 0n) {
          onAction('ALL');
          setAmount("");
          return;
        }
      }
    } catch {}
    onAction(amount);
    setAmount("");
    setAmountError("");
  };

  // Clear input when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAmount("");
      setAmountError("");
    }
  }, [isOpen]);

  const handlePercentageClick = (percent?: bigint) => {
    // Use adjusted max for 100% when withdrawing with debt, to avoid dust surprises
    if (!isSupply && hasDebt && percent === 100n && maxDisplayAmount > 0n) {
      const amountValue = formatUnits(maxDisplayAmount);
      setAmount(amountValue);
      setAmountError("");
      return;
    }
    const amountValue = formatUnits((BigInt(maxAmount) * percent) / 100n);
    setAmount(amountValue);
    setAmountError("");
  };

  const handleClose = () => {
    setAmount("");
    setAmountError("")
    onClose();
  };

  const getBalanceText = () => {
    if (isSupply) {
      return "Available to supply";
    } else {
      return "Collateral supplied";
    }
  };

  const getBalanceValue = () => {
     if (isSupply) {
       return formatUnits(asset?.userBalance || 0);
     } else {
       return formatUnits(asset?.collateralizedAmount || 0);
     }
  };

  const getTitle = () => {
    const action = isSupply ? "Supply" : "Withdraw";
    return `${action} ${asset?._name} as Collateral`;
  };

  const getAmountLabel = () => {
    const action = isSupply ? "Supply" : "Withdraw";
    return `${action} Amount`;
  };

  const getButtonText = () => {
    return isSupply ? "Supply" : "Withdraw";
  };

  const isAmountValid = () => {
    const amountWei = safeParseUnits(amount || "0");
    return amountWei > 0n && amountWei <= BigInt(maxAmount);
  };

  const isDisabled = () => {
    return (
      safeParseUnits(amount || "0") === 0n ||
      loading ||
      !isAmountValid() ||
      !!feeError ||
      (!isSupply && !healthImpact.isHealthy)
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent aria-describedby={null} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {asset?.images?.[0] ? (
              <img
                src={asset.images[0].value}
                alt={asset._name}
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
                style={{ backgroundColor: "red" }}
              >
                {asset?._symbol?.slice(0, 2) || "??"}
              </div>
            )}
            {getTitle()}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">{getBalanceText()}</span>
              <span className="font-medium">{getBalanceValue()}</span>
            </div>
            {!isSupply && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Max withdrawable now</span>
                <span className="font-medium">{formatUnits(maxDisplayAmount)}</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">
              {getAmountLabel()} ({asset?._name})
            </label>
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    const max = formatUnits(maxAmount);
                    setAmount(max);
                  }}
                  className="px-2 py-1 mr-1 bg-muted hover:bg-muted/80 rounded-full text-foreground text-xs font-medium transition"
                >
                  Max :
                </button>
                <span>
                  {formatUnits(maxAmount)} {asset?._symbol}
                </span>
              </div>
            </div>
            <div className="relative">
              <Input
                placeholder="0.00"
                className={`pr-8 ${
                  safeParseUnits(amount || "0") > BigInt(maxAmount)
                    ? "text-red-600"
                    : ""
                }`}
                value={addCommasToInput(amount)}
                onChange={(e)=>{
                  const value = e.target.value;
                  handleAmountInputChange(value, setAmount, setAmountError, maxAmount);
                }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {asset?._symbol}
              </span>
            </div>
            {amountError && (
              <p className="text-red-600 text-sm">{amountError}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant={
                  safeParseUnits(amount || "0") === (BigInt(maxAmount) * 10n) / 100n
                    ? "default"
                    : "outline"
                }
                size="sm"
                onClick={() => handlePercentageClick(10n)}
                className="flex-1"
              >
                10%
              </Button>
              <Button
                variant={
                  safeParseUnits(amount || "0") === (BigInt(maxAmount) * 25n) / 100n
                    ? "default"
                    : "outline"
                }
                size="sm"
                onClick={() => handlePercentageClick(25n)}
                className="flex-1"
              >
                25%
              </Button>
              <Button
                variant={
                  safeParseUnits(amount || "0") === (BigInt(maxAmount) * 50n) / 100n
                    ? "default"
                    : "outline"
                }
                size="sm"
                onClick={() => handlePercentageClick(50n)}
                className="flex-1"
              >
                50%
              </Button>
              <Button
                variant={
                  safeParseUnits(amount || "0") === (BigInt(maxAmount) * 100n) / 100n
                    ? "default"
                    : "outline"
                }
                size="sm"
                onClick={() => handlePercentageClick(100n)}
                className="flex-1"
              >
                {!isSupply && (BigInt(loanData?.totalAmountOwed || "0") > 0n) ? "Max" : "100%"}
              </Button>
            </div>
          </div>

          {/* Risk Level */}
          <RiskLevelProgress riskLevel={riskLevel} />

          {/* Health Impact Section */}
          <HealthImpactDisplay healthImpact={healthImpact} showWarning={false} className="pb-0" />

          {/* Transaction Fee Display */}
          <div className="px-4 bg-muted/50 rounded-md">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Transaction Fee</span>
              <span className="font-medium">{transactionFee} USDST ({parseFloat(transactionFee) * 100} voucher)</span>
            </div>
            {(() => {
              const feeAmount = safeParseUnits(transactionFee);
              const usdstBalanceBigInt = BigInt(usdstBalance || "0");

              // Check if USDST balance is running low after fee
              const lowBalanceThreshold = safeParseUnits("0.10");
              const remainingBalance = usdstBalanceBigInt - feeAmount;
              const isLowBalanceWarning =
                remainingBalance >= 0n &&
                remainingBalance <= lowBalanceThreshold;

              return (
                <>
                  {feeError && (
                    <p className="text-yellow-600 text-sm mt-1">
                      {feeError}
                    </p>
                  )}
                  {isLowBalanceWarning && !feeError && (
                    <p className="text-yellow-600 text-sm mt-1">
                      Warning: Your USDST balance is running low. Add more funds
                      now to avoid issues with future transactions.
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} className="mr-2">
            Cancel
          </Button>
          <Button
            disabled={isDisabled()}
            onClick={handleAction}
            className="px-6"
          >
            {loading && (
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-purple-50"></div>
            )}{" "}
            {getButtonText()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CollateralModal; 
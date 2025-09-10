import { useState, useEffect } from "react";
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

type ModalType = "supply" | "withdraw";

interface CollateralModalProps {
  type: ModalType;
  loading: boolean;
  asset: CollateralData;
  loanData: NewLoanData;
  isOpen: boolean;
  onClose: () => void;
  onAction: (amount: string) => void;
  usdstBalance?: string;
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
  usdstBalance = "0",
  transactionFee,
}: CollateralModalProps) => {
  const [amount, setAmount] = useState<string>("");
  const [displayAmount, setDisplayAmount] = useState("");
  const [riskLevel, setRiskLevel] = useState(0);
  const [healthImpact, setHealthImpact] = useState({
    currentHealthFactor: 0,
    newHealthFactor: 0,
    healthImpact: 0,
    isHealthy: true,
  });

  const isSupply = type === "supply";
  const maxAmount = isSupply 
    ? BigInt(asset?.userBalance || 0)
    : getMaxSafeWithdrawAmount(asset, loanData);
  
  // NEW: reflect on-chain 1 wei safety when there is outstanding debt
  const hasDebt = BigInt(loanData?.totalAmountOwed || "0") > 0n;
  const maxDisplayAmount = (!isSupply && hasDebt && maxAmount > 0n) ? (maxAmount - 1n) : maxAmount;

  // Calculate risk level when amount changes
  useEffect(() => {
    try {
      if (!loanData?.totalCollateralValueUSD || !loanData?.totalAmountOwed) {
        setRiskLevel(0);
        return;
      }

      const totalBorrowedBigInt = BigInt(loanData.totalAmountOwed);
      const collateralValueBigInt = BigInt(loanData.totalCollateralValueUSD);
      const tokenDecimals = asset?.customDecimals ?? 18;
      const amountWei = safeParseUnits(amount || "0", tokenDecimals);
      const assetPriceUSD = BigInt(asset?.assetPrice || "0");
      const amountValueUSD = (amountWei * assetPriceUSD * BigInt(asset?.liquidationThreshold || 0)) / ((BigInt(10) ** BigInt(tokenDecimals)) * 10000n);

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
    const amountWei = safeParseUnits(amount || "0", 18);
    const impact = isSupply 
      ? calculateSupplyHealthImpact(amountWei, asset, loanData)
      : calculateWithdrawHealthImpact(amountWei, asset, loanData);
    setHealthImpact(impact);
  }, [amount, asset, loanData, isSupply]);

  const handleAction = () => {
    const tokenDecimals = asset?.customDecimals ?? 18;
    try {
      if (!isSupply) {
        const amtWei = safeParseUnits(amount || "0", tokenDecimals);
        // If user selected at least the max, invoke on-chain max-withdraw to avoid drift issues
        if (amtWei >= maxDisplayAmount && maxDisplayAmount > 0n) {
          onAction('ALL');
          setAmount("");
          setDisplayAmount("");
          return;
        }
      }
    } catch {}
    onAction(amount);
    setAmount("");
    setDisplayAmount("");
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, "");
    if (/^\d*\.?\d*$/.test(value)) {
      setDisplayAmount(addCommasToInput(value));
      setAmount(value);
    }
  };

  // Clear input when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAmount("");
      setDisplayAmount("");
    }
  }, [isOpen]);

  const handlePercentageClick = (percent?: bigint) => {
    const tokenDecimals = asset?.customDecimals ?? 18;
    // Use adjusted max for 100% when withdrawing with debt, to avoid dust surprises
    if (!isSupply && hasDebt && percent === 100n && maxDisplayAmount > 0n) {
      const amountValue = formatUnits(maxDisplayAmount, tokenDecimals);
      setAmount(amountValue);
      setDisplayAmount(addCommasToInput(amountValue));
      return;
    }
    const amountValue = formatUnits((maxAmount * percent) / 100n, tokenDecimals);
    setAmount(amountValue);
    setDisplayAmount(addCommasToInput(amountValue));
  };

  const handleClose = () => {
    setDisplayAmount("");
    setAmount("");
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
         const tokenDecimals = asset?.customDecimals ?? 18;
     if (isSupply) {
       return formatUnits(asset?.userBalance || 0, tokenDecimals);
     } else {
       return formatUnits(asset?.collateralizedAmount || 0, tokenDecimals);
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
    const amountWei = safeParseUnits(amount || "0", 18);
    return amountWei > 0n && amountWei <= maxAmount;
  };

  const isDisabled = () => {
    return (
      safeParseUnits(amount || "0", 18) === 0n ||
      loading ||
      !isAmountValid() ||
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
              <span className="text-sm text-gray-500">{getBalanceText()}</span>
              <span className="font-medium">{getBalanceValue()}</span>
            </div>
            {!isSupply && (
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Max withdrawable now</span>
                <span className="font-medium">{formatUnits(maxDisplayAmount, asset?.customDecimals ?? 18)}</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">
              {getAmountLabel()} ({asset?._name})
            </label>
            <div className="flex justify-between items-center text-xs text-gray-500">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    const max = formatUnits(maxAmount, 18);
                    setAmount(max);
                    setDisplayAmount(addCommasToInput(max));
                  }}
                  className="px-2 py-1 mr-1 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 text-xs font-medium transition"
                >
                  Max :
                </button>
                <span>
                  {formatUnits(maxAmount, 18)} {asset?._symbol}
                </span>
              </div>
            </div>
            <div className="relative">
              <Input
                placeholder="0.00"
                className={`pr-8 ${
                  safeParseUnits(amount || "0", asset?.customDecimals ?? 18) > maxAmount
                    ? "text-red-600"
                    : ""
                }`}
                value={displayAmount}
                onChange={handleAmountChange}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                {asset?._symbol}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant={
                  safeParseUnits(amount || "0", 18) === (maxAmount * 10n) / 100n
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
                  safeParseUnits(amount || "0", 18) === (maxAmount * 25n) / 100n
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
                  safeParseUnits(amount || "0", 18) === (maxAmount * 50n) / 100n
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
                  safeParseUnits(amount || "0", 18) === (maxAmount * 100n) / 100n
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
          <div className="px-4 bg-gray-50 rounded-md">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Transaction Fee</span>
              <span className="font-medium">{transactionFee} USDST</span>
            </div>
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
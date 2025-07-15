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
import { formatUnits, parseUnits } from "ethers";
import { SUPPLY_COLLATERAL_FEE } from "@/lib/contants";
import { safeParseUnits, safeParseFloat } from "@/utils/numberUtils";

interface SupplyModalProps {
  supplyLoading: boolean;
  asset: any;
  loanData: any;
  isOpen: boolean;
  onClose: () => void;
  onSupply: (amount: string) => void;
  usdstBalance?: string;
}

const addCommasToInput = (value: string) => {
  if (!value) return '';
  const parts = value.split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  if (parts.length === 2) {
    return integerPart + '.' + parts[1];
  }
  return integerPart;
};

// Calculate health factor color based on value
const getHealthFactorColor = (healthFactor: number) => {
  if (healthFactor >= 1.5) return "text-green-600";
  if (healthFactor >= 1.2) return "text-yellow-600";
  if (healthFactor >= 1.0) return "text-orange-600";
  return "text-red-600";
};

// Calculate health impact of supply
const calculateHealthImpact = (
  supplyAmount: number,
  asset: any,
  loanData: any
) => {
  if (!asset || !loanData) {
    return {
      currentHealthFactor: 0,
      newHealthFactor: 0,
      healthImpact: 0,
      isHealthy: true,
    };
  }

  // Current values from backend
  const currentTotalBorrowValue = BigInt(loanData?.totalAmountOwed || 0);
  const currentHealthFactor = loanData?.healthFactor || 0;
  const currentCollateralValue = BigInt(loanData?.totalCollateralValueUSD || 0);

  // If there's no outstanding loan, supply is always healthy
  if (currentTotalBorrowValue === 0n) {
    return {
      currentHealthFactor: Infinity,
      newHealthFactor: Infinity,
      healthImpact: 0,
      isHealthy: true,
    };
  }

  // Calculate the USD value of the supplied amount
  const assetPrice = BigInt(asset?.assetPrice || 0);
  const liquidationThreshold = BigInt(asset?.liquidationThreshold || 0);

  // Convert supply amount to wei and calculate USD value
  const supplyAmountWei = BigInt(Math.round(supplyAmount * Math.pow(10, 18)));
  const suppliedValueUSD = (supplyAmountWei * assetPrice) / (10n ** 18n);

  // Apply liquidation threshold to get health factor value
  const suppliedValueWithThreshold = (suppliedValueUSD * liquidationThreshold) / 10000n;

  // Add to current collateral value
  const newCollateralValue = currentCollateralValue + suppliedValueWithThreshold;

  // Calculate new health factor
  const newHealthFactor = Number(newCollateralValue) / Number(currentTotalBorrowValue);

  const healthImpact = newHealthFactor - currentHealthFactor;
  const isHealthy = newHealthFactor >= 1.0;

  return {
    currentHealthFactor,
    newHealthFactor,
    healthImpact,
    isHealthy,
  };
};

const SupplyCollateralModal = ({
  supplyLoading,
  asset,
  loanData,
  isOpen,
  onClose,
  onSupply,
  usdstBalance = "0",
}: SupplyModalProps) => {
  const [supplyAmount, setSupplyAmount] = useState<string>("");
  const [displayAmount, setDisplayAmount] = useState("");
  const [healthImpact, setHealthImpact] = useState({
    currentHealthFactor: 0,
    newHealthFactor: 0,
    healthImpact: 0,
    isHealthy: true,
  });

  useEffect(() => {
    const numValue = safeParseFloat(supplyAmount);
    const impact = calculateHealthImpact(numValue, asset, loanData);
    setHealthImpact(impact);
  }, [supplyAmount, asset, loanData]);

  const handleSupply = () => {
    onSupply(supplyAmount);
    // Clear the input after supply
    setSupplyAmount("");
    setDisplayAmount("");
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, '');
    if (/^\d*\.?\d*$/.test(value)) {
      setDisplayAmount(addCommasToInput(value));
      setSupplyAmount(value);
    }
  };

  // Clear input when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSupplyAmount("");
      setDisplayAmount("");
    }
  }, [isOpen]);

  const handlePercentageClick = (percent?: bigint) => {
    const amount = formatUnits((BigInt(asset?.userBalance || 0) * percent) / 100n, 18);
    setSupplyAmount(amount);
    setDisplayAmount(addCommasToInput(amount));
  };

  const handleClose = () => {
    setDisplayAmount("")
    setSupplyAmount("")
    onClose()
  }
  

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent aria-describedby={null} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
              style={{ backgroundColor: "red" }}
            >
              {asset?._symbol?.slice(0, 2)}
            </div>
            {`Supply ${asset?._name} as Collateral`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Available balance</span>
              <span className="font-medium">
                {formatUnits(asset?.userBalance || 0,18)}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Supply Amount ({asset?._name})</label>
            <div className="flex justify-between items-center text-xs text-gray-500">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setSupplyAmount(formatUnits(asset?.userBalance || 0,18));
                    setDisplayAmount(addCommasToInput(formatUnits(asset?.userBalance || 0,18)));
                  }}
                  className="px-2 py-1 mr-1 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 text-xs font-medium transition"
                >
                  Max :
                </button>
                <span>${formatUnits(asset?.userBalance || 0,18)}</span>
              </div>
            </div>
            <div className="relative">
              <Input
                placeholder="0.00"
                className={`pr-8 ${safeParseUnits(supplyAmount || "0", 18) > BigInt(asset?.userBalance || 0) ? 'text-red-600' : ''}`}
                value={displayAmount}
                onChange={handleAmountChange}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">{asset?._symbol}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant={safeParseUnits(supplyAmount || "0", 18) === (BigInt(asset?.userBalance || 0) * 10n) / 100n ? "default" : "outline"}
                size="sm"
                onClick={() => handlePercentageClick(10n)}
                className="flex-1"
              >
                10%
              </Button>
              <Button
                variant={safeParseUnits(supplyAmount || "0", 18) === (BigInt(asset?.userBalance || 0) * 25n) / 100n ? "default" : "outline"}
                size="sm"
                onClick={() => handlePercentageClick(25n)}
                className="flex-1"
              >
                25%
              </Button>
              <Button
                variant={safeParseUnits(supplyAmount || "0", 18) === (BigInt(asset?.userBalance || 0) * 50n) / 100n ? "default" : "outline"}
                size="sm"
                onClick={() => handlePercentageClick(50n)}
                className="flex-1"
              >
                50%
              </Button>
              <Button
                variant={safeParseUnits(supplyAmount || "0", 18) === (BigInt(asset?.userBalance || 0) * 100n) / 100n ? "default" : "outline"}
                size="sm"
                onClick={() => handlePercentageClick(100n)}
                className="flex-1"
              >
                100%
              </Button>
            </div>
          </div>

          {/* Health Impact Section */}
          {safeParseUnits(supplyAmount || "0", 18) !== 0n && (
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              <h4 className="text-sm font-medium text-gray-700">Health Impact</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Current Health Factor:</span>
                  <span className={`font-medium ${getHealthFactorColor(healthImpact.currentHealthFactor)}`}>
                    {healthImpact.currentHealthFactor === Infinity ? "No Loan" : healthImpact.currentHealthFactor.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">New Health Factor:</span>
                  <span className={`font-medium ${getHealthFactorColor(healthImpact.newHealthFactor)}`}>
                    {healthImpact.newHealthFactor === Infinity ? "No Loan" : healthImpact.newHealthFactor.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Change:</span>
                  <span className={`font-medium ${healthImpact.healthImpact >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {healthImpact.healthImpact >= 0 ? '+' : ''}{healthImpact.healthImpact.toFixed(2)}
                  </span>
                </div>
                {healthImpact.healthImpact > 0 && (
                  <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
                    ✅ This supply will improve your position health and increase your borrowing power.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Transaction Fee Display */}
          <div className="px-4 py-3 bg-gray-50 rounded-md">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Transaction Fee</span>
              <span className="font-medium">{SUPPLY_COLLATERAL_FEE} USDST</span>
            </div>
            {(() => {
              const feeAmount = parseUnits(SUPPLY_COLLATERAL_FEE, 18);
              const usdstBalanceBigInt = BigInt(usdstBalance || "0");

              // Check if insufficient USDST for fee
              const isInsufficientUsdstForFee = usdstBalanceBigInt < feeAmount;

              // Check if USDST balance is running low after fee
              const lowBalanceThreshold = parseUnits("0.10", 18);
              const remainingBalance = usdstBalanceBigInt - feeAmount;
              const isLowBalanceWarning = remainingBalance >= 0n && remainingBalance <= lowBalanceThreshold;

              return (
                <>
                  {isInsufficientUsdstForFee && (
                    <p className="text-yellow-600 text-sm mt-1">
                      Insufficient USDST balance for transaction fee ({SUPPLY_COLLATERAL_FEE} USDST)
                    </p>
                  )}
                  {isLowBalanceWarning && !isInsufficientUsdstForFee && (
                    <p className="text-yellow-600 text-sm mt-1">
                      Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
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
            disabled={
              safeParseUnits(supplyAmount || "0", 18) === 0n ||
              supplyLoading ||
              safeParseUnits(supplyAmount || "0", 18) > BigInt(asset?.userBalance || 0) ||
              BigInt(usdstBalance || 0) < parseUnits(SUPPLY_COLLATERAL_FEE, 18)
            }
            onClick={handleSupply}
            className="px-6"
          >
            {supplyLoading && (
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-purple-50"></div>
            )} {" "}
            Supply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SupplyCollateralModal;

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
import { useFees } from "@/context/FeeContext";

interface WithdrawModalProps {
  withdrawLoading: boolean;
  asset: any;
  loanData: any;
  isOpen: boolean;
  onClose: () => void;
  onWithdraw: (amount: number) => void;
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

// Calculate health impact of withdrawal
const calculateHealthImpact = (
  withdrawAmount: number,
  asset: any,
  loanData: any
) => {
  if (!asset || !loanData || withdrawAmount === 0) {
    return {
      currentHealthFactor: loanData?.healthFactor || 0,
      newHealthFactor: loanData?.healthFactor || 0,
      healthImpact: 0,
      isHealthy: true,
    };
  }

  const DECIMALS = 18n;
  
  // Current total borrow value (principal + interest)
  const currentTotalBorrowValue = BigInt(loanData?.totalAmountOwed || 0);
  
  // Current health factor from loan data
  const currentHealthFactor = loanData?.healthFactor || 0;
  
  // Calculate the value being withdrawn (with liquidation threshold applied)
  // Convert USD amount to token amount first
  const assetPrice = BigInt(asset?.assetPrice || 0);
  const liquidationThreshold = BigInt(asset?.liquidationThreshold || 0);
  
  // Calculate token amount from USD amount
  const tokenAmount = assetPrice > 0n 
    ? BigInt(Math.round(withdrawAmount * Math.pow(10, 18))) / (assetPrice / DECIMALS)
    : 0n;
  const withdrawAmountWei = tokenAmount * DECIMALS;
  
  // Value being withdrawn with liquidation threshold: (amount * price * liquidationThreshold) / (1e18 * 10000)
  const withdrawnValue = (withdrawAmountWei * assetPrice * liquidationThreshold) / (DECIMALS * 10000n);
  
  // Calculate new health factor based on the reduction in collateral value
  // Health factor is proportional to collateral value, so:
  // New HF = Current HF * (1 - withdrawnValue / totalCollateralValue)
  // But we need to calculate the total collateral value first
  const totalCollateralValue = currentTotalBorrowValue > 0n 
    ? (BigInt(Math.round(currentHealthFactor * Number(DECIMALS))) * currentTotalBorrowValue) / DECIMALS
    : 0n;
  
  const newHealthFactor = totalCollateralValue > 0n
    ? currentHealthFactor * (1 - Number(withdrawnValue) / Number(totalCollateralValue))
    : currentHealthFactor;
  
  const healthImpact = newHealthFactor - currentHealthFactor;
  const isHealthy = newHealthFactor >= 1.0;

  return {
    currentHealthFactor,
    newHealthFactor,
    healthImpact,
    isHealthy,
  };
};

const WithdrawCollateralModal = ({
  withdrawLoading,
  asset,
  loanData,
  isOpen,
  onClose,
  onWithdraw,
  usdstBalance = "0",
}: WithdrawModalProps) => {
  const [withdrawAmount, setWithdrawAmount] = useState(0);
  const { withdrawFee } = useFees();
  const [displayAmount, setDisplayAmount] = useState("");
  const [healthImpact, setHealthImpact] = useState({
    currentHealthFactor: 0,
    newHealthFactor: 0,
    healthImpact: 0,
    isHealthy: true,
  });

  // Calculate health impact when withdraw amount changes
  useEffect(() => {
    const impact = calculateHealthImpact(withdrawAmount, asset, loanData);
    setHealthImpact(impact);
  }, [withdrawAmount, asset, loanData]);

  const handleWithdraw = () => {
    onWithdraw(withdrawAmount);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, ''); // Remove existing commas
    if (/^\d*\.?\d*$/.test(value)) {
      setDisplayAmount(addCommasToInput(value));
      const numValue = parseFloat(value) || 0;
      setWithdrawAmount(numValue);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent aria-describedby={null} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
              style={{ backgroundColor: "red" }}
            >
              {asset?._symbol?.slice(0, 2)}
            </div>
            {`Withdraw ${asset?._name} as Collateral`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Available balance</span>
              <span className="font-medium">
                {formatUnits(asset?.collateralizedAmount || 0,18)}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Withdraw Amount</label>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Max: {formatUnits(asset?.collateralizedAmount || 0,18)}</span>
            </div>
            <div className="relative">
              <Input
                placeholder="0.00"
                className={`pr-8 ${withdrawAmount > parseFloat(formatUnits(asset?.collateralizedAmount || 0,18)) ? 'text-red-600' : ''}`}
                value={displayAmount}
                onChange={handleAmountChange}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">{asset?._symbol}</span>
            </div>
          </div>

          {/* Health Impact Section */}
          {withdrawAmount > 0 && (
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              <h4 className="text-sm font-medium text-gray-700">Health Impact</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Current Health Factor:</span>
                  <span className={`font-medium ${getHealthFactorColor(healthImpact.currentHealthFactor)}`}>
                    {healthImpact.currentHealthFactor.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">New Health Factor:</span>
                  <span className={`font-medium ${getHealthFactorColor(healthImpact.newHealthFactor)}`}>
                    {healthImpact.newHealthFactor.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Change:</span>
                  <span className={`font-medium ${healthImpact.healthImpact <= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {healthImpact.healthImpact >= 0 ? '+' : ''}{healthImpact.healthImpact.toFixed(2)}
                  </span>
                </div>
                {!healthImpact.isHealthy && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                    ⚠️ Warning: This withdrawal would make your position unhealthy and vulnerable to liquidation.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Transaction Fee Display */}
          <div className="px-4 py-3 bg-gray-50 rounded-md">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Transaction Fee</span>
              <span className="font-medium">{formatUnits(withdrawFee, 18)} USDST</span>
            </div>
            {/* Fee validation warnings */}
            {(() => {
              const feeAmount = BigInt(withdrawFee || "0");
              const usdstBalanceBigInt = BigInt(usdstBalance || "0");
              
              // Check if insufficient USDST for fee
              const isInsufficientUsdstForFee = usdstBalanceBigInt < feeAmount;
              
              return (
                <>
                  {isInsufficientUsdstForFee && (
                    <p className="text-yellow-600 text-sm mt-1">
                      Insufficient USDST balance for transaction fee ({formatUnits(withdrawFee, 18)} USDST)
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="mr-2">
            Cancel
          </Button>
          <Button
            disabled={
              withdrawAmount === 0 || 
              withdrawLoading || 
              withdrawAmount > parseFloat(formatUnits(asset?.collateralizedAmount || 0,18)) ||
              !healthImpact.isHealthy ||
              (() => {
                const feeAmount = BigInt(withdrawFee || "0");
                const usdstBalanceBigInt = BigInt(usdstBalance || "0");
                return usdstBalanceBigInt < feeAmount;
              })()
            }
            onClick={handleWithdraw}
            className="px-6"
          >
            {withdrawLoading && (
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-purple-50"></div>
            )}{" "}
            Withdraw
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WithdrawCollateralModal;

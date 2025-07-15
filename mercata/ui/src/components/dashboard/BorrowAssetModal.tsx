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
import { Progress } from "@/components/ui/progress";
import { formatUnits, parseUnits } from "ethers";
import { BORROW_FEE } from "@/lib/contants";
import PercentageButtons from "@/components/ui/PercentageButtons";
import { safeParseUnits, addCommasToInput } from "@/utils/numberUtils";
import { useIsMobile } from "@/hooks/use-mobile";

interface BorrowAssetModalProps {
  borrowLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
  onBorrow: (amount: string) => void;
  loan?: any;
  usdstBalance?: string;
}

const BorrowAssetModal = ({
  borrowLoading,
  isOpen,
  onClose,
  onBorrow,
  loan,
  usdstBalance = "0"
}: BorrowAssetModalProps) => {
  const isMobile = useIsMobile();
  const availableToBorrowFormatted = formatUnits(loan?.maxAvailableToBorrowUSD || 0,18)
  const [borrowAmount, setBorrowAmount] = useState<string>("");
  const [displayAmount, setDisplayAmount] = useState("");
  const [riskLevel, setRiskLevel] = useState(0);

  // Calculate risk level based on total borrowed amount (existing + new) (0-100)
  useEffect(() => {
    try {
      // Get existing borrowed amount (including accrued interest)
      const existingBorrowedBigInt = BigInt(loan?.totalAmountOwed || 0);
      
      // Get new borrow amount
      const newBorrowAmountBigInt = safeParseUnits(borrowAmount || "0", 18);
      
      // Calculate total borrowed amount (existing + new)
      const totalBorrowedBigInt = existingBorrowedBigInt + newBorrowAmountBigInt;
      
      const collateralValueBigInt = BigInt(loan?.totalCollateralValueUSD || 0);

      if (collateralValueBigInt === 0n) {
        setRiskLevel(0);
        return;
      }

      // Calculate risk percentage using BigInt math
      const risk = Number((totalBorrowedBigInt * 10000n) / collateralValueBigInt) / 100;
      setRiskLevel(Math.min(risk, 100)); // Cap at 100%
    } catch {
      setRiskLevel(0);
    }
  }, [borrowAmount, loan?.totalCollateralValueUSD, loan?.totalAmountOwed]);

  const getRiskColor = () => {
    if (riskLevel < 30) return "bg-green-500";
    if (riskLevel < 70) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getRiskText = () => {
    if (riskLevel < 30) return "Low";
    if (riskLevel < 70) return "Moderate";
    return "High";
  };

  const handleBorrow = () => {
    onBorrow(borrowAmount);
    // Clear the input after borrow
    setBorrowAmount("");
    setDisplayAmount("");
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, '');
    if (/^\d*\.?\d*$/.test(value)) {
      setDisplayAmount(addCommasToInput(value));
      setBorrowAmount(value);
    }
  };

  // Clear input when modal closes
  useEffect(() => {
    if (!isOpen) {
      setBorrowAmount("");
      setDisplayAmount("");
    }
  }, [isOpen]);

  const handlePercentageClick = (percent?: number) => {
    const total = availableToBorrowFormatted;
    const amount = percent
      ? (parseFloat(total) * percent).toString()
      : total;
    setBorrowAmount(amount);
    setDisplayAmount(addCommasToInput(amount));
  };

  const handlePercentageButtonClick = (percentageAmount: string) => {
    setBorrowAmount(percentageAmount);
    setDisplayAmount(addCommasToInput(percentageAmount));
  };

  const handleClose = () => {
    setDisplayAmount('')
    setBorrowAmount('0')
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent 
        aria-describedby={null} 
        className={`${isMobile ? 'max-w-[95vw] h-[90vh] overflow-y-auto p-4' : 'sm:max-w-lg'}`}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
              style={{ backgroundColor: "red" }}
            >
              US
            </div>
            Borrow USDST
          </DialogTitle>
        </DialogHeader>

        <div className={`space-y-${isMobile ? '4' : '6'} py-4`}>
          <div className={`space-y-${isMobile ? '3' : '2'}`}>
            <div className={`flex ${isMobile ? 'flex-col space-y-1' : 'justify-between'}`}>
              <span className="text-sm text-gray-500">Available to borrow</span>
              <span className={`font-medium ${isMobile ? 'text-base' : ''}`}>
                USDST {availableToBorrowFormatted}
              </span>
            </div>
            <div className={`flex ${isMobile ? 'flex-col space-y-1' : 'justify-between'}`}>
              <span className="text-sm text-gray-500">Currently borrowed</span>
              <span className={`font-medium ${isMobile ? 'text-base' : ''}`}>
                USDST {loan?.totalAmountOwed ? formatUnits(loan.totalAmountOwed, 18) : "0.00"}
              </span>
            </div>
            <div className={`flex ${isMobile ? 'flex-col space-y-1' : 'justify-between'}`}>
              <span className="text-sm text-gray-500">Interest Rate</span>
              <span className={`font-medium ${isMobile ? 'text-base' : ''}`}>
                {loan?.interestRate
                  ? `${loan.interestRate.toFixed(2)}%`
                  : "-"}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Borrow Amount (USDST)</label>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Min: $0.01</span>
              <span>Max: ${availableToBorrowFormatted}</span>
            </div>
            <div className="relative">
              <Input
                placeholder="0.00"
                className={`pr-8 ${safeParseUnits(borrowAmount || "0", 18) > BigInt(loan?.maxAvailableToBorrowUSD || 0) ? 'text-red-600' : ''}`}
                value={displayAmount}
                onChange={handleAmountChange}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            </div>
            <PercentageButtons
              value={borrowAmount}
              maxValue={availableToBorrowFormatted}
              onChange={handlePercentageButtonClick}
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span>Risk Level:</span>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                    riskLevel < 30
                      ? "bg-green-50 text-green-700"
                      : riskLevel < 70
                        ? "bg-yellow-50 text-yellow-700"
                        : "bg-red-50 text-red-700"
                    }`}
                >
                  {getRiskText()}
                </span>
              </div>
            </div>

            <div className="relative">
              <Progress value={riskLevel} className="h-2">
                <div
                  className={`absolute inset-0 ${getRiskColor()} h-full rounded-full`}
                  style={{ width: `${riskLevel}%` }}
                />
              </Progress>

              <div className="flex justify-between mt-1 text-xs text-gray-500">
                <span>Safe</span>
                <span>Risk Increases →</span>
                <span>Liquidation</span>
              </div>
            </div>
          </div>

          {/* Transaction Fee Display */}
          <div className="px-4 py-3 bg-gray-50 rounded-md">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Transaction Fee</span>
              <span className="font-medium">{BORROW_FEE} USDST</span>
            </div>
            {/* Fee validation warnings */}
            {(() => {
              const feeAmount = parseUnits(BORROW_FEE, 18);
              const usdstBalanceBigInt = BigInt(usdstBalance || "0");

              // Check if insufficient USDST for fee
              const isInsufficientUsdstForFee = usdstBalanceBigInt < feeAmount;

              return (
                <>
                  {isInsufficientUsdstForFee && (
                    <p className="text-yellow-600 text-sm mt-1">
                      Insufficient USDST balance for transaction fee ({BORROW_FEE} USDST)
                    </p>
                  )}
                </>
              );
            })()}
          </div>

          {!isMobile && (
            <div className="px-4 py-3 bg-gray-50 rounded-md text-sm">
              <p className="text-gray-600">
                Borrowing against your assets allows you to access liquidity
                without selling your holdings. Be mindful of the risk level, as
                high borrowing increases liquidation risk during market
                volatility.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className={isMobile ? 'flex-col space-y-2 pt-4' : ''}>
          <Button 
            variant="outline" 
            onClick={handleClose} 
            className={isMobile ? 'w-full order-2' : 'mr-2'}
          >
            Cancel
          </Button>
          <Button
            disabled={
              !borrowAmount ||
              borrowLoading ||
              safeParseUnits(borrowAmount || "0", 18) > BigInt(loan?.maxAvailableToBorrowUSD || 0) ||
              (() => {
                const feeAmount = parseUnits(BORROW_FEE, 18);
                const usdstBalanceBigInt = BigInt(usdstBalance || "0");
                return usdstBalanceBigInt < feeAmount;
              })()
            }
            onClick={handleBorrow}
            className={isMobile ? 'w-full px-6 order-1' : 'px-6'}
          >
            {borrowLoading && (
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-purple-50"></div>
            )}{" "}
            Borrow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BorrowAssetModal;

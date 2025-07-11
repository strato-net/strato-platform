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

interface BorrowAssetModalProps {
  borrowLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
  onBorrow: (amount: string) => void;
  loan?: any;
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

const BorrowAssetModal = ({
  borrowLoading,
  isOpen,
  onClose,
  onBorrow,
  loan,
  usdstBalance = "0"
}: BorrowAssetModalProps) => {
  const availableToBorrowFormatted = formatUnits(loan?.maxAvailableToBorrowUSD || 0, 18)
  const collateralValueFormatted = parseFloat(formatUnits(loan?.totalCollateralValueUSD || 0, 18))
  const [borrowAmount, setBorrowAmount] = useState<string>("");
  const [displayAmount, setDisplayAmount] = useState("");
  const [riskLevel, setRiskLevel] = useState(0);

  // Calculate risk level based on borrowed amount (0-100)
  useEffect(() => {
    try {
      if (!borrowAmount) {
        setRiskLevel(0);
        return;
      }

      const borrowAmountBigInt = parseUnits(borrowAmount, 18);
      const collateralValueBigInt = BigInt(loan?.totalCollateralValueUSD || 0);

      if (collateralValueBigInt === 0n) {
        setRiskLevel(0);
        return;
      }

      // Calculate risk percentage using BigInt math
      const risk = Number((borrowAmountBigInt * 10000n) / collateralValueBigInt) / 100;
      setRiskLevel(Math.min(risk, 100)); // Cap at 100%
    } catch {
      setRiskLevel(0);
    }
  }, [borrowAmount, loan?.totalCollateralValueUSD]);

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

  const handleClose = () => {
    setDisplayAmount('')
    setBorrowAmount('0')
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
              US
            </div>
            Borrow USDST
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Available to borrow</span>
              <span className="font-medium">
                USDST {availableToBorrowFormatted}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Interest Rate</span>
              <span className="font-medium">
                {loan?.interestRate
                  ? `${loan.interestRate.toFixed(2)}%`
                  : "-"}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Borrow Amount (USDST)</label>
            <div className="flex justify-between items-center text-xs text-gray-500">
              <span>Min: $0.01</span>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setBorrowAmount(availableToBorrowFormatted);
                    setDisplayAmount(addCommasToInput(availableToBorrowFormatted));
                  }}
                  className="px-2 py-1 mr-1 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 text-xs font-medium transition"
                >
                  Max :
                </button>
                <span>${availableToBorrowFormatted}</span>
              </div>
            </div>
            <div className="relative">
              <Input
                placeholder="0.00"
                className={`pr-8 ${(() => { try { return parseUnits(borrowAmount || "0", 18) > BigInt(loan?.maxAvailableToBorrowUSD || 0) ? 'text-red-600' : ''; } catch { return ''; } })()}`}
                value={displayAmount}
                onChange={handleAmountChange}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant={borrowAmount?.toString() === (parseFloat(availableToBorrowFormatted.toString().replace(/,/g, "")) * 0.1).toString() ? "default" : "outline"}
                size="sm"
                onClick={() => handlePercentageClick(0.1)}
                className="flex-1"
              >
                10%
              </Button>
              <Button
                variant={borrowAmount?.toString() === (parseFloat(availableToBorrowFormatted.toString().replace(/,/g, "")) * 0.25).toString() ? "default" : "outline"}
                size="sm"
                onClick={() => handlePercentageClick(0.25)}
                className="flex-1"
              >
                25%
              </Button>
              <Button
                variant={borrowAmount?.toString() === (parseFloat(availableToBorrowFormatted.toString().replace(/,/g, "")) * 0.5).toString() ? "default" : "outline"}
                size="sm"
                onClick={() => handlePercentageClick(0.5)}
                className="flex-1"
              >
                50%
              </Button>
              <Button
                variant={borrowAmount?.toString() === availableToBorrowFormatted ? "default" : "outline"}
                size="sm"
                onClick={() => handlePercentageClick()}
                className="flex-1"
              >
                100%
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span>Risk Level:</span>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${riskLevel < 30
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

          <div className="px-4 py-3 bg-gray-50 rounded-md text-sm">
            <p className="text-gray-600">
              Borrowing against your assets allows you to access liquidity
              without selling your holdings. Be mindful of the risk level, as
              high borrowing increases liquidation risk during market
              volatility.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} className="mr-2">
            Cancel
          </Button>
          <Button
            disabled={
              !borrowAmount ||
              borrowLoading ||
              (() => { try { return parseUnits(borrowAmount, 18) > BigInt(loan?.maxAvailableToBorrowUSD || 0); } catch { return true; } })() ||
              (() => {
                const feeAmount = parseUnits(BORROW_FEE, 18);
                const usdstBalanceBigInt = BigInt(usdstBalance || "0");
                return usdstBalanceBigInt < feeAmount;
              })()
            }
            onClick={handleBorrow}
            className="px-6"
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

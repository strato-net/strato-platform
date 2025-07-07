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
import { formatUnits } from "ethers";

interface BorrowAssetModalProps {
  borrowLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
  onBorrow: (amount: number) => void;
  loan?: any;
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
  loan
}: BorrowAssetModalProps) => {
  const availableToBorrowFormatted = formatUnits(loan?.maxAvailableToBorrowUSD || 0,18)
  const collateralValueFormatted = parseFloat(formatUnits(loan?.totalCollateralValueUSD || 0,18))
  const [borrowAmount, setBorrowAmount] = useState(0);
  const [displayAmount, setDisplayAmount] = useState("");
  const [riskLevel, setRiskLevel] = useState(0);

  // Calculate risk level based on borrowed amount (0-100)
  useEffect(() => {
    const denom = collateralValueFormatted === 0 ? 1 : collateralValueFormatted;
    const risk = ((borrowAmount * 10 ** 18) / (denom * 10 ** 18)) * 100;
    setRiskLevel(risk);
  }, [borrowAmount, collateralValueFormatted]);

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
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, ''); // Remove existing commas
    if (/^\d*\.?\d*$/.test(value)) {
      setDisplayAmount(addCommasToInput(value));
      const numValue = parseFloat(value) || 0;
      setBorrowAmount(numValue);
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
                {loan?.accruedInterest
                  ? `${parseFloat(loan?.accruedInterest).toFixed(2)}%`
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
                className={`pr-8 ${borrowAmount > parseFloat(availableToBorrowFormatted) ? 'text-red-600' : ''}`}
                value={displayAmount}
                onChange={handleAmountChange}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            </div>
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
          <Button variant="outline" onClick={onClose} className="mr-2">
            Cancel
          </Button>
          <Button
            disabled={borrowAmount === 0 || borrowLoading || borrowAmount > parseFloat(availableToBorrowFormatted)}
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

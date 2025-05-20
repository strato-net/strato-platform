import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DepositableToken } from "@/interface";
import { formatUnits } from "ethers";

interface BorrowAssetModalProps {
  borrowLoading: boolean;
  borrowAsset: DepositableToken;
  asset: DepositableToken;
  isOpen: boolean;
  onClose: () => void;
  onBorrow: (amount: number) => void;
}

const formatUsdValue = (value: any) =>
  parseFloat(formatUnits(value || 0, 18)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatTokenBalance = (value: any) =>
  parseFloat(formatUnits(value || 0, 18)).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 4,
  });

const BorrowAssetModal = ({
  borrowLoading,
  borrowAsset,
  asset,
  isOpen,
  onClose,
  onBorrow,
}: BorrowAssetModalProps) => {
  // Calculate "Available to borrow" and max borrowable using formatted numbers (price * value / (collateralRatio / 100))
  let calculatedBorrowable = 0;
  try {
    const price = parseFloat(formatUnits(asset?.price || "0", 18));
    const value = parseFloat(formatUnits(asset?.value || "0", 18));
    const ratio = Number(asset?.collateralRatio || "0") / 100;
    calculatedBorrowable = ratio === 0 ? 0 : (price * value) / ratio;
  } catch (e) {
    calculatedBorrowable = 0;
  }
  const availableToBorrowFormatted = calculatedBorrowable.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const maxBorrowAmount = calculatedBorrowable;
  const [borrowAmount, setBorrowAmount] = useState(maxBorrowAmount / 2);
  const [riskLevel, setRiskLevel] = useState(0);

  // Calculate risk level based on borrowed amount (0-100)
  useEffect(() => {
    const risk =
      ((borrowAmount * 10 ** 18) / (maxBorrowAmount * 10 ** 18)) * 100;
    setRiskLevel(risk);
  }, [borrowAmount, maxBorrowAmount]);

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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
              style={{ backgroundColor: "red" }}
            >
              {asset?._symbol?.slice(0, 2)}
            </div>
            Borrow {borrowAsset?._name} against {asset?._name}
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
              <span className="text-sm text-gray-500">Available balance</span>
              <span className="font-medium text-right">
                {asset?._symbol || asset?._name}{" "}
                {formatTokenBalance(asset?.value)}
                <div className="text-xs text-gray-500">
                  ≈ ${formatUsdValue(asset?.price)} / {asset?._symbol}
                </div>
                <div className="text-xs text-gray-500">
                  Total ≈ $
                  {(
                    parseFloat(formatUnits(asset?.price || 0, 18)) *
                    parseFloat(formatUnits(asset?.value || 0, 18))
                  ).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Interest Rate</span>
              <span className="font-medium">
                {borrowAsset?.interestRate
                  ? `${parseFloat(borrowAsset.interestRate).toFixed(2)}%`
                  : "-"}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Borrow Amount</label>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-gray-500">$0.00</span>
              <span className="text-sm text-gray-500">
                $
                {maxBorrowAmount.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <Slider
              value={[borrowAmount]}
              max={maxBorrowAmount}
              step={0.01}
              onValueChange={(value) => setBorrowAmount(value[0])}
            />
            <div className="flex justify-between">
              <span>Selected amount:</span>
              <span className="font-semibold">
                $
                {borrowAmount.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
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
                ></div>
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
            disabled={borrowAmount === 0 || borrowLoading}
            onClick={handleBorrow}
            className="px-6"
          >
            {borrowLoading && (
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-purple-50"></div>
            )}{" "}
            Borrow Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BorrowAssetModal;

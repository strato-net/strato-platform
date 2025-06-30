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

const formatUsdValue = (value: any) => {
  try {
    let raw: string;

    if (typeof value === "number" || (typeof value === "string" && value.includes("e"))) {
      raw = BigInt(Number(value)).toString(); // safely convert e-notation
    } else {
      raw = value?.toString() || "0";
    }

    return parseFloat(formatUnits(raw, 18)).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return "0.00";
  }
};

const formatTokenBalance = (value: any) =>
  parseFloat(formatUnits(value || 0, 18)).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 4,
  });

const safeBigNumberish = (input: any): string => {
  if (typeof input === "number" || (typeof input === "string" && input.includes("e"))) {
    return BigInt(Number(input)).toString();
  }
  return input?.toString() || "0";
};

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
  borrowAsset,
  asset,
  isOpen,
  onClose,
  onBorrow,
}: BorrowAssetModalProps) => {
  // Calculate "Available to borrow" and max borrowable using formatted numbers (price * value / (collateralRatio / 100))
  let calculatedBorrowable = 0;
  try {
    const price = parseFloat(formatUnits(
      typeof asset?.price === "number" || (typeof asset?.price === "string" && asset.price.includes("e"))
        ? BigInt(Number(asset.price)).toString()
        : asset?.price?.toString() || "0",
      18
    ));
    const value = parseFloat(formatUnits(
      typeof asset?.value === "number" || (typeof asset?.value === "string" && asset.value.includes("e"))
        ? BigInt(Number(asset.value)).toString()
        : asset?.value?.toString() || "0",
      18
    ));
    const ratio = Number(asset?.collateralRatio || "0") / 100;
    calculatedBorrowable = ratio === 0 ? 0 : (price * value) / ratio;
  } catch (e) {
    calculatedBorrowable = 0;
  }
  const availableLiquidity = parseFloat(formatUnits(safeBigNumberish(borrowAsset?.liquidity), 18));
  const effectiveMaxBorrowable = Math.min(calculatedBorrowable, availableLiquidity);

  // Risk calculations should be scaled to the maximum based on collateral (liquidation threshold),
  // *not* the lower pool-liquidity cap.
  const collateralMaxBorrowable = calculatedBorrowable;

  const availableToBorrowFormatted = effectiveMaxBorrowable.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const maxBorrowAmount = effectiveMaxBorrowable;
  const [borrowAmount, setBorrowAmount] = useState(maxBorrowAmount / 2);
  const [displayAmount, setDisplayAmount] = useState("");
  const [riskLevel, setRiskLevel] = useState(0);

  // Calculate risk level based on borrowed amount (0-100)
  useEffect(() => {
    const denom = collateralMaxBorrowable === 0 ? 1 : collateralMaxBorrowable;
    const risk = ((borrowAmount * 10 ** 18) / (denom * 10 ** 18)) * 100;
    setRiskLevel(risk);
  }, [borrowAmount, collateralMaxBorrowable]);

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
                    parseFloat(formatUnits(safeBigNumberish(asset?.price), 18)) *
                    parseFloat(formatUnits(safeBigNumberish(asset?.value), 18))
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
            <label className="text-sm font-medium">Borrow Amount (USDST)</label>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Min: $0.01</span>
              <span>Max: ${maxBorrowAmount.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}</span>
            </div>
            <div className="relative">
              <Input
                placeholder="0.00"
                className="pr-8"
                value={displayAmount}
                onChange={handleAmountChange}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            </div>
            {availableLiquidity < calculatedBorrowable && (
              <div className="text-xs text-red-600 text-right">
                Limited by pool liquidity (available: {availableLiquidity.toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2})} USDST)
              </div>
            )}
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
            disabled={borrowAmount === 0 || borrowLoading}
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

import { useState, useEffect } from "react";
import { formatUnits } from "ethers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { BORROW_FEE } from "@/lib/constants";
import { safeParseUnits, addCommasToInput, safeParseFloat, formatWeiAmount } from "@/utils/numberUtils";
import { NewLoanData, CollateralData } from "@/interface";

interface BorrowFormProps {
  loans: NewLoanData | null;
  borrowLoading: boolean;
  onBorrow: (amount: string) => void;
  usdstBalance: string;
  collateralInfo: CollateralData[] | null;
}

const BorrowForm = ({ loans, borrowLoading, onBorrow, usdstBalance, collateralInfo }: BorrowFormProps) => {
  const [borrowAmount, setBorrowAmount] = useState<string>("");
  const [borrowDisplayAmount, setBorrowDisplayAmount] = useState("");
  const [riskLevel, setRiskLevel] = useState(0);

  // Calculate risk level for borrow form
  useEffect(() => {
    try {
      const existingBorrowedBigInt = BigInt(loans?.totalAmountOwed || 0);
      const newBorrowAmountBigInt = safeParseUnits(borrowAmount || "0", 18);
      const totalBorrowedBigInt = existingBorrowedBigInt + newBorrowAmountBigInt;
      const collateralValueBigInt = BigInt(loans?.totalCollateralValueUSD || 0);

      if (collateralValueBigInt === 0n) {
        setRiskLevel(0);
        return;
      }

      const risk = Number((totalBorrowedBigInt * 10000n) / collateralValueBigInt) / 100;
      setRiskLevel(Math.min(risk, 100));
    } catch {
      setRiskLevel(0);
    }
  }, [borrowAmount, loans?.totalCollateralValueUSD, loans?.totalAmountOwed]);

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

  const handleBorrowAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, '');
    if (/^\d*\.?\d*$/.test(value)) {
      setBorrowDisplayAmount(addCommasToInput(value));
      setBorrowAmount(value);
    }
  };

  const handleBorrowPercentage = (percentageAmount: string) => {
    setBorrowAmount(percentageAmount);
    setBorrowDisplayAmount(addCommasToInput(percentageAmount));
  };

  const handleBorrow = () => {
    onBorrow(borrowAmount);
    setBorrowAmount("");
    setBorrowDisplayAmount("");
  };

  return (
    <div className="space-y-4 pt-4">
      {/* Loan Details */}
      <div className="space-y-3">
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Available to borrow</span>
          <span className="font-medium">
            USDST {safeParseFloat(formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)) === 0 ? '-' : formatWeiAmount(loans?.maxAvailableToBorrowUSD || '0')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Currently borrowed</span>
          <span className="font-medium">
            USDST {loans?.totalAmountOwed ? formatUnits(loans.totalAmountOwed, 18) : "0.00"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Interest Rate</span>
          <span className="font-medium">
            {loans?.interestRate ? `${loans.interestRate.toFixed(2)}%` : "-"}
          </span>
        </div>
      </div>

      {/* Borrow Amount Input */}
      <div className="space-y-3">
        <label className="text-sm font-medium">Borrow Amount (USDST)</label>
        <div className="flex justify-between items-center text-xs text-gray-500">
          <span>Min: 0.01 USDST</span>
          <div>
            <button
              type="button"
              onClick={() => {
                const availableToBorrowFormatted = formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18);
                setBorrowAmount(availableToBorrowFormatted);
                setBorrowDisplayAmount(addCommasToInput(availableToBorrowFormatted));
              }}
              disabled={safeParseFloat(formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)) === 0}
              className="px-2 py-1 mr-1 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-100"
              title={safeParseFloat(formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)) === 0 ? "No amount available to borrow" : "Set to maximum available amount"}
            >
              Max :
            </button>
            <span>{safeParseFloat(formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)) === 0 ? '-' : formatWeiAmount(loans?.maxAvailableToBorrowUSD || '0')} USDST</span>
          </div>
        </div>
        <div className="relative">
          <Input
            placeholder="0.00"
            className={`pr-16 ${safeParseUnits(borrowAmount || "0", 18) > BigInt(loans?.maxAvailableToBorrowUSD || 0) ? 'text-red-600' : ''}`}
            value={borrowDisplayAmount}
            onChange={handleBorrowAmountChange}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">USDST</span>
        </div>
        <div className="flex gap-2">
          {[10, 25, 50, 100].map((percentage) => {
            const maxAvailable = formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18);
            const percentageAmount = percentage === 100 
              ? maxAvailable 
              : (safeParseFloat(maxAvailable) * (percentage / 100)).toFixed(18);
            const isDisabled = safeParseFloat(maxAvailable) === 0;
            
            return (
              <Button
                key={percentage}
                variant="outline"
                size="sm"
                onClick={() => handleBorrowPercentage(percentageAmount)}
                disabled={isDisabled}
                className={`flex-1 transition-all duration-200 ${!isDisabled ? 'hover:scale-105' : ''}`}
                title={isDisabled ? "No amount available to borrow" : `Set to ${percentage}% of available amount`}
              >
                {percentage}%
              </Button>
            );
          })}
        </div>
      </div>

      {/* Risk Level */}
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

      {/* Transaction Fee */}
      <div className="px-4 py-3 bg-gray-50 rounded-md">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-600">Transaction Fee</span>
          <span className="font-medium">{BORROW_FEE} USDST</span>
        </div>
        {(() => {
          const feeAmount = safeParseUnits(BORROW_FEE, 18);
          const usdstBalanceBigInt = BigInt(usdstBalance || "0");
          const isInsufficientUsdstForFee = usdstBalanceBigInt < feeAmount;

          return isInsufficientUsdstForFee ? (
            <p className="text-yellow-600 text-sm mt-1">
              Insufficient USDST balance for transaction fee ({BORROW_FEE} USDST)
            </p>
          ) : null;
        })()}
      </div>

      {/* Borrow Button */}
      <Button
        onClick={handleBorrow}
        disabled={
          !borrowAmount ||
          borrowLoading ||
          safeParseUnits(borrowAmount || "0", 18) > BigInt(loans?.maxAvailableToBorrowUSD || 0) ||
          (() => {
            const feeAmount = safeParseUnits(BORROW_FEE, 18);
            const usdstBalanceBigInt = BigInt(usdstBalance || "0");
            return usdstBalanceBigInt < feeAmount;
          })()
        }
        className="w-full"
      >
        {borrowLoading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
        ) : null}
        Borrow
      </Button>

      {/* Conditional Warning Messages */}
      {(() => {
        const availableToBorrowFormatted = formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18);
        const isZeroAvailable = safeParseFloat(availableToBorrowFormatted) === 0;
        
        // Check eligible collateral tokens (ETH, BTC, GOLDST, SILVST)
        const eligibleCollateralSymbols = ['ETH', 'BTC', 'GOLDST', 'SILVST'];
        const eligibleCollateralTokens = collateralInfo?.filter(asset => 
          eligibleCollateralSymbols.includes(asset?._symbol || '') && BigInt(asset?.userBalance || 0) > 0n
        ) || [];

        const borrowInfoMessage = (
          <p className="text-gray-600 mt-2">
            Borrowing against your assets allows you to access liquidity
            without selling your holdings. Be mindful of the risk level, as
            high borrowing increases liquidation risk during market
            volatility.
          </p>
        );

        if (isZeroAvailable) {
          return (
            <div className="px-4 py-3 bg-gray-50 rounded-md text-sm">
              {Array.isArray(eligibleCollateralTokens) && eligibleCollateralTokens.length === 0 ? (
                <p className="font-bold">
                  ⚠️ You cannot currently borrow any USDST because you do not have any eligible collateral to borrow against.
                  You will need to buy or swap other assets for ETH, BTC, GOLDST or SILVST which you can borrow against. ⚠️
                </p>
              ) : (
                <p className="font-bold">
                  ⚠️ You cannot currently borrow any USDST because you have not made any of your collateral available to borrow against.
                  Return to the main Borrow page and click on Supply for some of your collateral ⚠️
                </p>
              )}
              {borrowInfoMessage}
            </div>
          );
        }

        // Show info message when user can borrow
        return (
          <div className="px-4 py-3 bg-gray-50 rounded-md">
            {borrowInfoMessage}
          </div>
        );
      })()}
    </div>
  );
};

export default BorrowForm;
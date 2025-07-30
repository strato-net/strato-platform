import { useState, useEffect } from "react";
import { formatUnits } from "ethers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BORROW_FEE } from "@/lib/constants";
import { safeParseUnits, addCommasToInput, formatWeiAmount, safeParseFloat } from "@/utils/numberUtils";
import { NewLoanData, CollateralData, HealthImpactData } from "@/interface";
import { calculateBorrowHealthImpact } from "@/utils/lendingUtils";
import RiskLevelProgress from "@/components/ui/RiskLevelProgress";
import HealthImpactDisplay from "@/components/ui/HealthImpactDisplay";

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
  const [healthImpact, setHealthImpact] = useState<HealthImpactData>({
    currentHealthFactor: 0,
    newHealthFactor: 0,
    healthImpact: 0,
    isHealthy: true,
  });

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

  const handleBorrowAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, '');
    if (/^\d*\.?\d*$/.test(value)) {
      setBorrowDisplayAmount(addCommasToInput(value));
      setBorrowAmount(value);
    }
  };

  const handleBorrowPercentage = (percentageAmount: bigint) => {
    const amountFormatted = formatUnits(percentageAmount, 18);
    setBorrowAmount(amountFormatted);
    setBorrowDisplayAmount(addCommasToInput(amountFormatted));
  };

  const handleBorrow = () => {
    onBorrow(borrowAmount);
    setBorrowAmount("");
    setBorrowDisplayAmount("");
  };

  useEffect(()=>{
    const borrowAmountWei = safeParseUnits(borrowAmount || "0", 18);
    const res = calculateBorrowHealthImpact(borrowAmountWei, loans)    
    setHealthImpact(res)
  },[borrowAmount, loans])

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
            const maxAvailable = BigInt(loans?.maxAvailableToBorrowUSD || 0);
            const availableAfterFee = maxAvailable - safeParseUnits(BORROW_FEE, 18);
            const percentageAmountRaw = (availableAfterFee * BigInt(percentage)) / 100n;
            const borrowAmountRaw = safeParseUnits(borrowAmount || "0", 18);
            const isSelected = borrowAmountRaw === percentageAmountRaw;
            const isDisabled = availableAfterFee <= 0n;
            
            return (
              <Button
                key={percentage}
                variant={isSelected ? "default" : "outline"}
                size="sm"
                onClick={() => handleBorrowPercentage(percentageAmountRaw)}
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
      <RiskLevelProgress riskLevel={riskLevel} />

      {/* Transaction Fee */}
      <div className="px-4 py-3 bg-gray-50 rounded-md">
        <HealthImpactDisplay healthImpact={healthImpact} showWarning={false} className="mb-4" />
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
          safeParseUnits(borrowAmount, 18) <= 0n ||
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
        
        // collateralInfo already contains only eligible collateral (balance > 0)
        const eligibleCollateralTokens = collateralInfo || [];

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
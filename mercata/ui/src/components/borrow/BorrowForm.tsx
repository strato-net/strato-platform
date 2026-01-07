import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BORROW_FEE } from "@/lib/constants";
import { safeParseUnits, addCommasToInput, formatWeiAmount, safeParseFloat, formatUnits } from "@/utils/numberUtils";
import { NewLoanData, CollateralData, HealthImpactData } from "@/interface";
import { calculateBorrowHealthImpact } from "@/utils/lendingUtils";
import RiskLevelProgress from "@/components/ui/RiskLevelProgress";
import HealthImpactDisplay from "@/components/ui/HealthImpactDisplay";
import PercentageButtons from "../ui/PercentageButtons";
import { useLendingContext } from "@/context/LendingContext";
import { useAuthAction } from "@/hooks/useAuthAction";
import { computeMaxTransferable, handleAmountInputChange } from "@/utils/transferValidation";
import { UserRewardsData } from "@/services/rewardsService";
import { CompactRewardsDisplay } from "../rewards/CompactRewardsDisplay";

interface BorrowFormProps {
  loans: NewLoanData | null;
  borrowLoading: boolean;
  onBorrow: (amount: string) => void;
  usdstBalance: string;
  voucherBalance: string;
  collateralInfo: CollateralData[] | null;
  startPolling?: () => void;
  stopPolling?: () => void;
  userRewards?: UserRewardsData | null;
  rewardsLoading?: boolean;
}

const BorrowForm = ({ loans, borrowLoading, onBorrow, usdstBalance, voucherBalance, collateralInfo, startPolling, stopPolling, userRewards, rewardsLoading }: BorrowFormProps) => {
  const { canPerformAction } = useAuthAction();
  const [borrowAmount, setBorrowAmount] = useState<string>("");
  const [borrowAmountError, setBorrowAmountError] = useState<string>("");
  const [feeError, setFeeError] = useState<string>("");
  const [riskLevel, setRiskLevel] = useState(0);
  const [healthImpact, setHealthImpact] = useState<HealthImpactData>({
    currentHealthFactor: 0,
    newHealthFactor: 0,
    healthImpact: 0,
    isHealthy: true,
  });
  const { borrowMax } = useLendingContext();

  const maxAmount = useMemo(() => {
    return computeMaxTransferable(loans?.maxAvailableToBorrowUSD, false, voucherBalance, usdstBalance, safeParseUnits(BORROW_FEE).toString(), setFeeError);
  }, [voucherBalance, usdstBalance, loans?.maxAvailableToBorrowUSD]);

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

  // Consolidated polling handler
  const handlePollingUpdate = (amount: string) => {
    if (amount && parseFloat(amount) > 0) {
      startPolling?.();
    } else {
      stopPolling?.();
    }
  };

  const handleBorrow = async () => {
    const maxWei = BigInt(loans?.maxAvailableToBorrowUSD || 0);
    const wei = safeParseUnits(borrowAmount || "0", 18);

    // If at or within 1 wei of the max available, route via parent as 'ALL' to use on-chain borrowMax and parent UX
    if (maxWei > 0n && (wei >= maxWei || (maxWei > 0n && wei >= (maxWei - 1n)))) {
      onBorrow('ALL');
      setBorrowAmount("");
      setBorrowAmountError("");
      setFeeError("");
      handlePollingUpdate("");
      return;
    }

    onBorrow(borrowAmount);
    setBorrowAmount("");
    setBorrowAmountError("");
    setFeeError("");
    handlePollingUpdate("");
  };

  useEffect(()=>{
    const borrowAmountWei = safeParseUnits(borrowAmount || "0", 18);
    const res = calculateBorrowHealthImpact(borrowAmountWei, loans)    
    setHealthImpact(res)
  },[borrowAmount, loans])

  const interestRateDisplay = (() => {
    const raw = (loans as any)?.interestRate; // bps
    const num = Number(raw);
    if (!isFinite(num)) return "-";
    return `${(num / 100).toFixed(2)}%`;
  })();

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Loan Details */}
      <div className="space-y-2 md:space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-xs md:text-sm text-muted-foreground">Available to borrow</span>
          <span className="text-xs md:text-sm font-medium">
            {safeParseFloat(formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)) === 0 
              ? '-' 
              : `${Number(formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDST`}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs md:text-sm text-muted-foreground">Interest Rate</span>
          <span className="text-xs md:text-sm font-medium">
            {interestRateDisplay}
          </span>
        </div>
      </div>

      {/* Borrow Amount Input */}
      <div className="space-y-2 md:space-y-3">
        <label className="text-xs md:text-sm font-medium">Borrow Amount (USDST)</label>
        <div className="flex justify-between items-center text-[10px] md:text-xs text-muted-foreground">
          <span>Min: 0.01 USDST</span>
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => {
                try {
                  setBorrowAmount(formatUnits(BigInt(maxAmount)));
                  setBorrowAmountError("");
                } catch {}
              }}
              disabled={safeParseFloat(formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)) === 0}
              className="px-1.5 md:px-2 py-0.5 md:py-1 mr-1 bg-muted hover:bg-muted/80 rounded-full text-muted-foreground hover:text-foreground text-[10px] md:text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
              title={safeParseFloat(formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)) === 0 ? "No amount available to borrow" : "Set to safe maximum available amount"}
            >
              Max:
            </button>
            <span>{safeParseFloat(formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)) === 0 
              ? '-' 
              : `${Number(formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} USDST</span>
          </div>
        </div>
        <div className="relative">
          <Input
            placeholder="0.00"
            className={`pr-16 ${safeParseUnits(borrowAmount || "0", 18) > BigInt(loans?.maxAvailableToBorrowUSD || 0) ? 'text-red-600' : ''}`}
            value={addCommasToInput(borrowAmount)}
            onChange={(e)=>{
              const value = e.target.value;
              handleAmountInputChange(value, setBorrowAmount, setBorrowAmountError, maxAmount);
            }}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">USDST</span>
        </div>
        {borrowAmountError && (
          <p className="text-red-600 text-sm">{borrowAmountError}</p>
        )}
        <CompactRewardsDisplay
          userRewards={userRewards}
          activityName="Lending Pool Borrow"
          inputAmount={borrowAmount}
          actionLabel="Borrow"
        />
        <PercentageButtons
          value={borrowAmount}
          maxValue={maxAmount}
          onChange={(val) => {
            setBorrowAmount(val);
          }}
          className="mt-2"
          disabled={BigInt(maxAmount) < 1e15} // Disable if less than 0.001 USDST (1e15 wei)
        />
      </div>

      {/* Risk Level */}
      <RiskLevelProgress riskLevel={riskLevel} />

      {/* Transaction Fee */}
      <div className="px-4 py-3 bg-muted/50 rounded-md">
        <HealthImpactDisplay healthImpact={healthImpact} showWarning={false} className="mb-4" />
        <div className="flex justify-between text-sm mb-2">
          <span className="text-muted-foreground">Transaction Fee</span>
          <span className="font-medium">{BORROW_FEE} USDST ({parseFloat(BORROW_FEE) * 100} voucher)</span>
        </div>
        {feeError && (
          <p className="text-yellow-600 text-sm mt-1">{feeError}</p>
        )}
      </div>

      {/* Borrow Button */}
      <Button
        onClick={handleBorrow}
        disabled={
          !canPerformAction ||
          !borrowAmount ||
          !!borrowAmountError ||
          !!feeError ||
          safeParseUnits(borrowAmount || "0") <= 0n ||
          borrowLoading ||
          safeParseUnits(borrowAmount || "0") > BigInt(maxAmount)
        }
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {borrowLoading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
        ) : null}
        Borrow
      </Button>

      {/* Conditional Warning Messages */}
      {(() => {
        const availableToBorrowFormatted = formatUnits(loans?.maxAvailableToBorrowUSD || 0);
        const isZeroAvailable = safeParseFloat(availableToBorrowFormatted) === 0;
        const eligibleCollateralTokens = collateralInfo || [];

        const borrowInfoMessage = (
          <p className="text-[10px] md:text-xs text-muted-foreground mt-1.5">
            Borrowing against your assets allows you to access liquidity without selling your holdings. Be mindful of the risk level, as high borrowing increases liquidation risk.
          </p>
        );

        if (isZeroAvailable) {
          return (
            <div className="mt-2">
              <p className="text-xs md:text-sm text-muted-foreground">
                No available borrowing power. Supply collateral to enable borrowing.
              </p>
              {borrowInfoMessage}
            </div>
          );
        }

        if (eligibleCollateralTokens.length === 0) {
          return (
            <div className="mt-2">
              <p className="text-xs md:text-sm text-muted-foreground">
                No eligible collateral. Supply assets to enable borrowing.
              </p>
              {borrowInfoMessage}
            </div>
          );
        }

        return null;
      })()}
    </div>
  );
};

export default BorrowForm;
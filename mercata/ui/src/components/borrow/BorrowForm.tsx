import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import { BORROW_FEE } from "@/lib/constants";
import { safeParseUnits, addCommasToInput, formatWeiAmount, safeParseFloat, formatUnits } from "@/utils/numberUtils";
import { NewLoanData, CollateralData } from "@/interface";
import { 
  calculateAvailableToBorrowUSD, 
  calculateHFSliderExtrema, 
  calculateAfterBorrowHealthFactor 
} from "@/utils/lendingUtils";
import { getRiskLabel } from "@/utils/loanUtils";
import { useLendingContext } from "@/context/LendingContext";
import { handleAmountInputChange } from "@/utils/transferValidation";
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
  const [borrowAmount, setBorrowAmount] = useState<string>("");
  const [borrowAmountError, setBorrowAmountError] = useState<string>("");
  const [feeError, setFeeError] = useState<string>("");
  const [targetHealthFactor, setTargetHealthFactor] = useState<number>(2.10);
  const { borrowMax } = useLendingContext();

  // Calculate slider extrema based on collateral configs
  const sliderExtrema = useMemo(() => {
    if (!loans || !collateralInfo || collateralInfo.length === 0) {
      return { min: 1.01, max: 3.00 };
    }
    return calculateHFSliderExtrema(loans, collateralInfo);
  }, [loans, collateralInfo]);

  // Calculate available to borrow based on current health factor setting
  const availableToBorrow = useMemo(() => {
    if (!loans) return 0;
    const emptyCollateral = new Map<CollateralData, bigint>();
    return calculateAvailableToBorrowUSD(loans, targetHealthFactor, emptyCollateral);
  }, [loans, targetHealthFactor]);

  // Calculate the max amount considering fees
  const maxAmount = useMemo(() => {
    const availableWei = BigInt(Math.round(Number(availableToBorrow) * 1e18));
    const feeWei = safeParseUnits(BORROW_FEE, 18);
    const voucherBal = BigInt(voucherBalance || 0);
    const usdstBal = safeParseUnits(usdstBalance || "0", 18);
    
    // Check if user can cover fee with vouchers or USDST
    const canCoverFee = voucherBal >= feeWei * 100n || usdstBal >= feeWei;
    if (!canCoverFee) {
      setFeeError("Insufficient balance to cover transaction fee");
      return "0";
    }
    setFeeError("");
    return availableWei.toString();
  }, [availableToBorrow, voucherBalance, usdstBalance]);

  // Calculate after-borrow health factor
  const afterBorrowHF = useMemo(() => {
    if (!loans || !borrowAmount || parseFloat(borrowAmount) <= 0) {
      return null;
    }
    const emptyCollateral = new Map<CollateralData, bigint>();
    return calculateAfterBorrowHealthFactor(loans, parseFloat(borrowAmount), emptyCollateral);
  }, [loans, borrowAmount]);

  // Current health factor display
  const currentHF = useMemo(() => {
    if (!loans) return null;
    const owed = BigInt(loans.totalAmountOwed || 0);
    if (owed <= 1n) return null; // No loan
    return loans.healthFactor;
  }, [loans]);

  // Get risk indicator color and label
  const getRiskIndicator = (hf: number): { label: string; color: string } => {
    const label = getRiskLabel(hf);
    if (label === 'Low Risk') return { label, color: 'text-green-500' };
    if (label === 'Moderate Risk') return { label, color: 'text-yellow-500' };
    return { label, color: 'text-red-500' };
  };

  const riskIndicator = getRiskIndicator(targetHealthFactor);

  // Consolidated polling handler
  const handlePollingUpdate = (amount: string) => {
    if (amount && parseFloat(amount) > 0) {
      startPolling?.();
    } else {
      stopPolling?.();
    }
  };

  const handleBorrow = async () => {
    const maxWei = BigInt(maxAmount);
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

  // Handle slider change - convert position to HF value
  const handleSliderChange = (values: number[]) => {
    const sliderPos = values[0];
    // Slider goes from max HF (left/0) to min HF (right/range)
    const range = Number(sliderExtrema.max) - Number(sliderExtrema.min);
    const newHF = Number(sliderExtrema.max) - sliderPos;
    setTargetHealthFactor(Math.round(newHF * 100) / 100);
  };

  // Convert HF to slider position
  const sliderPosition = useMemo(() => {
    const range = Number(sliderExtrema.max) - Number(sliderExtrema.min);
    return Number(sliderExtrema.max) - targetHealthFactor;
  }, [targetHealthFactor, sliderExtrema]);

  const interestRateDisplay = (() => {
    const raw = (loans as any)?.interestRate; // bps
    const num = Number(raw);
    if (!isFinite(num)) return "-";
    return `${(num / 100).toFixed(2)}%`;
  })();

  const sliderRange = Number(sliderExtrema.max) - Number(sliderExtrema.min);

  return (
    <div className="space-y-4 pt-4">
      {/* Header: Borrow USDST */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Borrow USDST</h3>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Available to Borrow</span>
          <span className="font-medium">USDST {Number(availableToBorrow).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Interest Rate</span>
          <span className="font-medium">{interestRateDisplay}</span>
        </div>
      </div>

      {/* Borrow Amount Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Borrow Amount</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              placeholder="0"
              className={`pr-20 ${safeParseUnits(borrowAmount || "0", 18) > BigInt(maxAmount) ? 'text-red-600' : ''}`}
              value={addCommasToInput(borrowAmount)}
              onChange={(e) => {
                const value = e.target.value;
                handleAmountInputChange(value, setBorrowAmount, setBorrowAmountError, maxAmount);
                handlePollingUpdate(value);
              }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">USDST</span>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              try {
                setBorrowAmount(formatUnits(BigInt(maxAmount)));
                setBorrowAmountError("");
                handlePollingUpdate(formatUnits(BigInt(maxAmount)));
              } catch {}
            }}
            disabled={Number(availableToBorrow) <= 0}
            className="px-4"
          >
            MAX
          </Button>
        </div>
        {borrowAmountError && (
          <p className="text-red-600 text-sm">{borrowAmountError}</p>
        )}
      </div>

      {/* Health Factor Slider */}
      <TooltipProvider>
        <div className="space-y-3 py-2">
          <div className="flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 cursor-help">
                  <span className="text-base font-semibold">Health Factor</span>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>Target health factor after borrowing. Higher = safer position with less borrowing. Lower = riskier with more borrowing.</p>
              </TooltipContent>
            </Tooltip>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tabular-nums">{targetHealthFactor.toFixed(2)}</span>
              <span className={`text-sm font-medium ${riskIndicator.color}`}>{riskIndicator.label}</span>
            </div>
          </div>

          <Slider
            value={[sliderPosition]}
            min={0}
            max={sliderRange}
            step={0.01}
            onValueChange={handleSliderChange}
            className="w-full"
          />

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Safer</span>
            <span>Riskier</span>
          </div>

          {/* Current Loans Health: Before => After */}
          <div className="flex justify-between items-center text-sm border-t pt-3">
            <span className="text-muted-foreground">Current Loans Health</span>
            <span className="font-medium tabular-nums">
              {currentHF === null ? 'No Loan' : currentHF.toFixed(2)}
              {' → '}
              {afterBorrowHF !== null ? afterBorrowHF.toFixed(2) : (borrowAmount ? targetHealthFactor.toFixed(2) : '-')}
            </span>
          </div>
        </div>
      </TooltipProvider>

      {/* Borrow Button */}
      <Button
        onClick={handleBorrow}
        disabled={
          !borrowAmount ||
          !!borrowAmountError ||
          !!feeError ||
          safeParseUnits(borrowAmount || "0") <= 0n ||
          borrowLoading ||
          safeParseUnits(borrowAmount || "0") > BigInt(maxAmount)
        }
        className="w-full"
      >
        {borrowLoading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
        ) : null}
        Borrow
      </Button>

      {/* Rewards Display */}
      <CompactRewardsDisplay
        userRewards={userRewards}
        activityName="Lending Pool Borrow"
        inputAmount={borrowAmount}
        actionLabel="Borrow"
      />

      {/* Transaction Fee */}
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground underline cursor-help" title="Fee paid to process this transaction">Transaction Fee</span>
        <span className="font-medium">{BORROW_FEE} USDST ({parseFloat(BORROW_FEE) * 100} vouchers)</span>
      </div>
      {feeError && (
        <p className="text-yellow-600 text-sm">{feeError}</p>
      )}

      {/* Conditional Warning Messages */}
      {(() => {
        const isZeroAvailable = Number(availableToBorrow) <= 0;
        const eligibleCollateralTokens = collateralInfo || [];

        if (isZeroAvailable && eligibleCollateralTokens.length === 0) {
          return (
            <p className="text-muted-foreground text-sm mt-2">
              You have no eligible collateral. Supply assets to enable borrowing.
            </p>
          );
        }

        if (isZeroAvailable) {
          return (
            <p className="text-muted-foreground text-sm mt-2">
              You currently have no available borrowing power. Supply collateral to enable borrowing.
            </p>
          );
        }

        return null;
      })()}
    </div>
  );
};

export default BorrowForm;
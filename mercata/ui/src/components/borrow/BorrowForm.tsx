import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BORROW_FEE } from "@/lib/constants";
import { safeParseUnits, addCommasToInput, formatWeiAmount, safeParseFloat, formatUnits } from "@/utils/numberUtils";
import { NewLoanData, CollateralData, HealthImpactData } from "@/interface";
import { calculateBorrowHealthImpact } from "@/utils/lendingUtils";
import HealthImpactDisplay from "@/components/ui/HealthImpactDisplay";
import { useLendingContext } from "@/context/LendingContext";
import { computeMaxTransferable, handleAmountInputChange } from "@/utils/transferValidation";
import { UserRewardsData } from "@/services/rewardsService";
import { CompactRewardsDisplay } from "../rewards/CompactRewardsDisplay";
import { Slider } from "@/components/ui/slider";

interface BorrowFormProps {
  loans: NewLoanData | null;
  borrowLoading: boolean;
  onBorrow: (amount: string) => Promise<boolean> | boolean;
  usdstBalance: string;
  voucherBalance: string;
  collateralInfo: CollateralData[] | null;
  disableBorrow?: boolean;
  plannedDepositAsset?: CollateralData | null;
  plannedDepositAmount?: string;
  startPolling?: () => void;
  stopPolling?: () => void;
  userRewards?: UserRewardsData | null;
  rewardsLoading?: boolean;
}

const BorrowForm = ({ loans, borrowLoading, onBorrow, usdstBalance, voucherBalance, collateralInfo, disableBorrow, plannedDepositAsset, plannedDepositAmount, startPolling, stopPolling, userRewards, rewardsLoading }: BorrowFormProps) => {
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

  const HF_MIN = 1.05;
  const HF_MAX = 10;
  const [targetHealthFactor, setTargetHealthFactor] = useState<number>(HF_MAX);

  const plannedDepositWei = useMemo(() => {
    if (!plannedDepositAsset) return 0n;
    return safeParseUnits(plannedDepositAmount || "0", plannedDepositAsset.customDecimals ?? 18);
  }, [plannedDepositAsset, plannedDepositAmount]);

  const loanForPreview = useMemo<NewLoanData | null>(() => {
    if (!loans) return null;
    if (!plannedDepositAsset || plannedDepositWei <= 0n) return loans;

    try {
      const currentCollUSD = BigInt(loans.totalCollateralValueUSD || "0"); // USD 1e18, threshold-adjusted
      const hfRaw = BigInt(loans.healthFactorRaw || "0"); // 1e18

      const assetPrice = BigInt(plannedDepositAsset.assetPrice || "0"); // USD 1e18 per token
      const liqThreshold = BigInt(plannedDepositAsset.liquidationThreshold || "0"); // bps
      const tokenDecimals = 10n ** BigInt(plannedDepositAsset.customDecimals ?? 18);

      const amountValueUSD = (plannedDepositWei * assetPrice) / tokenDecimals;
      const amountValueWithThreshold = (amountValueUSD * liqThreshold) / 10000n;
      const newCollUSD = currentCollUSD + amountValueWithThreshold;

      // Preserve current debt by updating HF raw consistently when there is debt.
      if (hfRaw > 0n && currentCollUSD > 0n) {
        const currentBorrowUSD = (currentCollUSD * 10n ** 18n) / hfRaw;
        const newHFRaw = currentBorrowUSD === 0n ? 0n : (newCollUSD * 10n ** 18n) / currentBorrowUSD;
        return {
          ...loans,
          totalCollateralValueUSD: newCollUSD.toString(),
          healthFactorRaw: newHFRaw.toString(),
        };
      }

      return {
        ...loans,
        totalCollateralValueUSD: newCollUSD.toString(),
      };
    } catch {
      return loans;
    }
  }, [loans, plannedDepositAsset, plannedDepositWei]);

  // Max achievable HF for this action is the HF when borrowing 0 USDST (can't borrow negative).
  // If the calculator returns 0/invalid for the no-debt case (effectively ∞), fall back to HF_MAX.
  const hfAtZeroBorrow = useMemo(() => {
    if (!loanForPreview) return HF_MAX;
    try {
      const hf0 = Number(calculateBorrowHealthImpact(0n, loanForPreview).newHealthFactor);
      if (!isFinite(hf0) || hf0 <= 0) return HF_MAX;
      return hf0;
    } catch {
      return HF_MAX;
    }
  }, [loanForPreview]);

  const hfSliderMax = useMemo(() => {
    // Ensure the slider range is always valid.
    return Math.max(HF_MIN, Math.min(HF_MAX, hfAtZeroBorrow));
  }, [hfAtZeroBorrow]);

  const maxAvailableToBorrowForPreviewWei = useMemo(() => {
    if (!loans) return 0n;
    const current = (() => {
      try {
        return BigInt(loans.maxAvailableToBorrowUSD || "0");
      } catch {
        return 0n;
      }
    })();

    if (!plannedDepositAsset || plannedDepositWei <= 0n) return current;

    try {
      const assetPrice = BigInt(plannedDepositAsset.assetPrice || "0"); // USD 1e18
      const ltvBP = BigInt(plannedDepositAsset.ltv || "0"); // bps
      const tokenDecimals = 10n ** BigInt(plannedDepositAsset.customDecimals ?? 18);
      const amountValueUSD = (plannedDepositWei * assetPrice) / tokenDecimals;
      const addedBorrowCapUSD = (amountValueUSD * ltvBP) / 10000n;
      return current + addedBorrowCapUSD;
    } catch {
      return current;
    }
  }, [loans, plannedDepositAsset, plannedDepositWei]);

  const hasPreviewBorrowPower = useMemo(() => {
    try {
      return BigInt(maxAvailableToBorrowForPreviewWei || 0n) > 0n;
    } catch {
      return false;
    }
  }, [maxAvailableToBorrowForPreviewWei]);

  const maxAmount = useMemo(() => {
    return computeMaxTransferable(
      maxAvailableToBorrowForPreviewWei.toString(),
      false,
      voucherBalance,
      usdstBalance,
      safeParseUnits(BORROW_FEE).toString(),
      setFeeError
    );
  }, [voucherBalance, usdstBalance, maxAvailableToBorrowForPreviewWei]);

  // Calculate risk level for borrow form
  useEffect(() => {
    try {
      const existingBorrowedBigInt = BigInt(loanForPreview?.totalAmountOwed || 0);
      const newBorrowAmountBigInt = safeParseUnits(borrowAmount || "0", 18);
      const totalBorrowedBigInt = existingBorrowedBigInt + newBorrowAmountBigInt;
      const collateralValueBigInt = BigInt(loanForPreview?.totalCollateralValueUSD || 0);

      if (collateralValueBigInt === 0n) {
        setRiskLevel(0);
        return;
      }

      const risk = Number((totalBorrowedBigInt * 10000n) / collateralValueBigInt) / 100;
      setRiskLevel(Math.min(risk, 100));
    } catch {
      setRiskLevel(0);
    }
  }, [borrowAmount, loanForPreview?.totalCollateralValueUSD, loanForPreview?.totalAmountOwed]);

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
      const ok = await onBorrow('ALL');
      if (ok !== false) {
        setBorrowAmount("");
        setBorrowAmountError("");
        setFeeError("");
        handlePollingUpdate("");
      }
      return;
    }

    const ok = await onBorrow(borrowAmount);
    if (ok !== false) {
      setBorrowAmount("");
      setBorrowAmountError("");
      setFeeError("");
      handlePollingUpdate("");
    }
  };

  useEffect(() => {
    // Health Impact should be:
    // - "before": current on-chain position (no planned deposit, no new borrow)
    // - "after": position after planned deposit + entered borrow amount
    if (!loans || !loanForPreview) return;

    const borrowAmountWei = safeParseUnits(borrowAmount || "0", 18);

    // Before: exclude planned deposit by using the real loan snapshot.
    const before = calculateBorrowHealthImpact(0n, loans);
    // After: include planned deposit by using preview loan + entered borrow.
    const after = calculateBorrowHealthImpact(borrowAmountWei, loanForPreview);

    setHealthImpact({
      ...after,
      currentHealthFactor: before.currentHealthFactor,
      newHealthFactor: after.newHealthFactor,
      healthImpact: after.newHealthFactor - before.currentHealthFactor,
    });
  }, [borrowAmount, loans, loanForPreview]);

  useEffect(() => {
    // When user types a borrow amount, reflect the resulting HF on the slider.
    const hf = Number(healthImpact?.newHealthFactor);
    if (!isFinite(hf) || hf <= 0) return;
    setTargetHealthFactor(Math.min(hfSliderMax, Math.max(HF_MIN, hf)));
  }, [healthImpact?.newHealthFactor, hfSliderMax]);

  const handleHealthFactorSliderChange = (values: number[]) => {
    const targetHf = values?.[0];
    if (!isFinite(targetHf)) return;
    if (!loanForPreview) return;
    const clampedTarget = Math.min(hfSliderMax, Math.max(HF_MIN, targetHf));
    setTargetHealthFactor(clampedTarget);

    const maxWei = (() => {
      try {
        return BigInt(maxAmount || "0");
      } catch {
        return 0n;
      }
    })();

    if (maxWei <= 0n) {
      return;
    }

    const hasExistingDebt = (() => {
      try {
        return BigInt(loanForPreview.totalAmountOwed || "0") > 0n;
      } catch {
        return false;
      }
    })();

    // If there is no existing debt, HF = collateral / borrow -> borrow = collateral / HF (clamped to borrow cap).
    if (!hasExistingDebt) {
      try {
        const collUSD = BigInt(loanForPreview.totalCollateralValueUSD || "0"); // USD 1e18 (threshold-adjusted)
        if (collUSD <= 0n) return;

        // targetHFScaled is HF * 1e18
        const targetHFScaled = BigInt(Math.round(clampedTarget * 1e18));
        if (targetHFScaled <= 0n) return;

        // borrowWei (USD 1e18) = collUSD * 1e18 / targetHFScaled
        const borrowWei = (collUSD * 10n ** 18n) / targetHFScaled;
        const clamped = borrowWei > maxWei ? maxWei : borrowWei;

        const amt = formatUnits(clamped, 18);
        setBorrowAmount(amt);
        setBorrowAmountError("");
        handlePollingUpdate(amt);
      } catch {
        // noop
      }
      return;
    }

    const hfForBorrow = (borrowWei: bigint): number => {
      // With no debt, 0 borrow should imply ∞ health factor (calculator returns 0).
      if (!hasExistingDebt && borrowWei === 0n) return Infinity;
      const hf = calculateBorrowHealthImpact(borrowWei, loanForPreview).newHealthFactor;
      // Guard against 0 for the no-debt case.
      if (!hasExistingDebt && (!isFinite(hf) || hf === 0)) return Infinity;
      return hf;
    };

    // If target is at or above the health factor with 0 additional borrow, borrow amount should be 0.
    const hfAtZero = hasExistingDebt ? hfForBorrow(0n) : Infinity;
    if (!isFinite(hfAtZero) || clampedTarget >= hfAtZero) {
      setBorrowAmount("");
      setBorrowAmountError("");
      handlePollingUpdate("");
      return;
    }

    // Health factor generally decreases as borrow increases -> binary search for amount that approaches target.
    let lo = 0n;
    let hi = maxWei;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2n;
      const midHf = hfForBorrow(mid);
      if (!isFinite(midHf)) break;

      if (midHf > clampedTarget) {
        // Still safer than target -> can borrow more
        lo = mid + 1n;
      } else {
        hi = mid;
      }
    }

    const amt = formatUnits(hi, 18);
    setBorrowAmount(amt);
    setBorrowAmountError("");
    handlePollingUpdate(amt);
  };

  const interestRateDisplay = (() => {
    type LoanWithInterestRate = NewLoanData & { interestRate?: unknown };
    const raw = (loans as LoanWithInterestRate | null)?.interestRate; // bps
    const num = Number(raw);
    if (!isFinite(num)) return "-";
    return `${(num / 100).toFixed(2)}%`;
  })();

  return (
    <div className="space-y-4 pt-4">
      {/* Borrow USDST */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
        <div className="font-medium">Borrow USDST</div>

        {/* Loan Details */}
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Available to borrow</span>
            <span className="font-medium">
              USDST {hasPreviewBorrowPower ? formatWeiAmount(maxAvailableToBorrowForPreviewWei.toString(), 18) : '-'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Total Amount Owed</span>
            <span className="font-medium">
              {(() => {
                const owed = (() => { try { return BigInt(loans?.totalAmountOwed || 0); } catch { return 0n; } })();
                const display = owed <= 1n ? 0n : owed;
                return `USDST ${formatUnits(display, 18)}`;
              })()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Interest Rate</span>
            <span className="font-medium">
              {interestRateDisplay}
            </span>
          </div>
        </div>

        {/* Borrow Amount Input */}
        <div className="space-y-3">
          <label className="text-sm font-medium">Borrow Amount (USDST)</label>
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>Min: 0.01 USDST</span>
            <div>
              <button
                type="button"
                onClick={() => {
                  try {
                    setBorrowAmount(formatUnits(BigInt(maxAmount)));
                    setBorrowAmountError("");
                  } catch {}
                }}
                disabled={!hasPreviewBorrowPower}
                className="px-2 py-1 mr-1 bg-muted hover:bg-muted/80 rounded-full text-muted-foreground hover:text-foreground text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-muted"
                title={!hasPreviewBorrowPower ? "No amount available to borrow" : "Set to safe maximum available amount"}
              >
                Max :
              </button>
              <span>{hasPreviewBorrowPower ? formatWeiAmount(maxAvailableToBorrowForPreviewWei.toString(), 18) : '-'} USDST</span>
            </div>
          </div>
          <div className="relative">
            <Input
              placeholder="0.00"
              className={`pr-16 ${(() => { try { return safeParseUnits(borrowAmount || "0", 18) > BigInt(maxAmount || "0"); } catch { return false; } })() ? 'text-red-600' : ''}`}
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
        </div>
      </div>

      {/* Health Factor */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Health Factor</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{targetHealthFactor.toFixed(2)}</span>
              <span
                className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                  riskLevel < 30
                    ? "bg-green-50 text-green-700"
                    : riskLevel < 70
                      ? "bg-yellow-50 text-yellow-700"
                      : "bg-red-50 text-red-700"
                }`}
              >
                {riskLevel < 30 ? "Low Risk" : riskLevel < 70 ? "Moderate Risk" : "High Risk"}
              </span>
            </div>
          </div>
          <Slider
            value={[targetHealthFactor]}
            min={HF_MIN}
            max={hfSliderMax}
            step={0.05}
            onValueChange={handleHealthFactorSliderChange}
            disabled={!loanForPreview || !hasPreviewBorrowPower}
            trackClassName="h-3"
            thumbClassName="h-6 w-6"
            className="py-2"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Riskier</span>
            <span>Safer</span>
          </div>
        </div>

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

        <Button
          onClick={handleBorrow}
          disabled={
            !!disableBorrow ||
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

        {/* Conditional Warning Messages */}
        {(() => {
          const isZeroAvailable = !hasPreviewBorrowPower;
          const eligibleCollateralTokens = collateralInfo || [];

          const borrowInfoMessage = (
            <p className="text-muted-foreground mt-2">
              Borrowing against your assets allows you to access liquidity
              without selling your holdings. Be mindful of the risk level, as
              high borrowing increases liquidation risk during market
              volatility.
            </p>
          );

          if (isZeroAvailable) {
            return (
              <div className="mt-2">
                <p className="text-muted-foreground">
                  You currently have no available borrowing power. Supply collateral to enable borrowing.
                </p>
                {borrowInfoMessage}
              </div>
            );
          }

          if (eligibleCollateralTokens.length === 0) {
            return (
              <div className="mt-2">
                <p className="text-muted-foreground">
                  You have no eligible collateral. Supply assets to enable borrowing.
                </p>
                {borrowInfoMessage}
              </div>
            );
          }

          return null;
        })()}
      </div>
    </div>
  );
};

export default BorrowForm;
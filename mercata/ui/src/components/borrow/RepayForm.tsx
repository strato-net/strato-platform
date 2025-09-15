import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { formatUnits } from "viem";
import { Button } from "@/components/ui/button";
import { REPAY_FEE, usdstAddress, VOUCHERS_PER_UNIT } from "@/lib/constants";
import { safeParseUnits, formatCurrency, safeParseFloat } from "@/utils/numberUtils";
import { NewLoanData } from "@/interface";
import { calculateRepayHealthImpact } from "@/utils/lendingUtils";
import RiskLevelProgress from "@/components/ui/RiskLevelProgress";
import HealthImpactDisplay from "@/components/ui/HealthImpactDisplay";
import TokenInput from "@/components/shared/TokenInput";
import { useLendingContext } from "@/context/LendingContext";
import { useUserTokens } from "@/context/UserTokensContext";

// Centralized parsing helpers
const toWei18 = (x?: string) => safeParseUnits(x || "0", 18);
const toBig = (x?: string | number | bigint) => {
  if (typeof x === "bigint") return x;
  if (typeof x === "number") return BigInt(Math.trunc(x));
  const s = String(x ?? "0").trim();
  if (!/^\d+$/.test(s)) return 0n; // fallback
  return BigInt(s);
};

// Constants
const DUST_USD_WEI = toWei18("0.00000000000000001");

// Hoisted presentational components
const FeeNotice = ({ fee, canPay, vouchersRequired }: { fee: string; canPay: boolean; vouchersRequired: number }) => (
  <div className="px-4 py-3 bg-gray-50 rounded-md">
    <div className="flex justify-between text-sm mb-2">
      <span className="text-gray-600">Transaction Fee</span>
      <span className="font-medium">
        {fee} USDST ({vouchersRequired} vouchers)
      </span>
    </div>
    {!canPay && (
      <p className="text-yellow-600 text-sm mt-1">
        Insufficient fee coverage. Add USDST or vouchers.
      </p>
    )}
  </div>
);

interface RepayFormProps {
  loans: NewLoanData | null;
  usdstBalance: string;
  onActionComplete?: () => void;
}

const RepayForm = ({ loans, usdstBalance, onActionComplete }: RepayFormProps) => {
  const [repayAmount, setRepayAmount] = useState<string>("");
  const [repayAmountError, setRepayAmountError] = useState<string>("");
  const { voucherBalance } = useUserTokens();
  const { repayLoan, repayAll, loading } = useLendingContext();
  
  // Track previous max to detect changes
  const prevMaxRef = useRef<bigint>(0n);
  const [isUpdating, setIsUpdating] = useState(false);

  // Centralized parsing - once per render
  const totalOwed = toBig(loans?.totalAmountOwed);
  const collatUSD = toBig(loans?.totalCollateralValueUSD);
  const repayWei = toWei18(repayAmount);
  const usdstBal = toBig(usdstBalance);
  const voucherBal = toBig(voucherBalance);

  // Derived state via useMemo
  const maxTransferable = useMemo(() => {
    // For repaying, max is the amount owed, but we need to ensure user can pay the fee
    const feeWei = toWei18(REPAY_FEE);
    const totalAvailableForFee = usdstBal + voucherBal;
    
    // If user can't pay the fee, they can't repay anything
    if (totalAvailableForFee < feeWei) {
      return 0n;
    }
    
    // If vouchers cover the fee, user can repay up to totalOwed
    if (voucherBal >= feeWei) {
      return totalOwed;
    }
    
    // If vouchers don't cover the fee, user needs to reserve some USDST for the fee
    const usdstNeededForFee = feeWei - voucherBal;
    const availableForRepay = usdstBal - usdstNeededForFee;
    
    // Return the minimum of what they owe and what they can afford
    return availableForRepay > 0n ? (availableForRepay < totalOwed ? availableForRepay : totalOwed) : 0n;
  }, [totalOwed, voucherBal, usdstBal]);

  const riskLevel = useMemo(() => {
    if (collatUSD <= DUST_USD_WEI) return 0;
    const newBorrowedAmount = totalOwed - repayWei;
    if (newBorrowedAmount <= 0n) return 0;
    const bp = Number((newBorrowedAmount * 10000n) / collatUSD) / 100;
    return Math.max(0, Math.min(bp, 100));
  }, [repayWei, totalOwed, collatUSD]);

  const healthImpact = useMemo(
    () => calculateRepayHealthImpact(repayWei, loans),
    [repayWei, loans]
  );

  const remainingOwed = useMemo(() => {
    const remaining = totalOwed - repayWei;
    return remaining > 0n ? remaining : 0n;
  }, [totalOwed, repayWei]);

  const remainingDisplay = useMemo(() => {
    return formatCurrency(formatUnits(remainingOwed, 18));
  }, [remainingOwed]);

  // Initialize prev max once to avoid first-render clamp
  useEffect(() => {
    prevMaxRef.current = maxTransferable;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Make the "shrink input if max drops" effect robust
  useEffect(() => {
    const prevMax = prevMaxRef.current;
    
    // Always trigger animation when max changes (regardless of user input)
    if (prevMax !== 0n && maxTransferable !== prevMax) {
      setIsUpdating(true);
      setTimeout(() => setIsUpdating(false), 300);
    }
    
    // Only adjust user input if they have entered an amount
    if (repayAmount) {
      const inputWei = toWei18(repayAmount);
      if (maxTransferable > 0n && inputWei > maxTransferable) {
        setRepayAmount(formatUnits(maxTransferable, 18));
        setRepayAmountError("");
      }
    }
    
    prevMaxRef.current = maxTransferable;
  }, [maxTransferable, repayAmount]);

  // Callbacks for side effects
  const onAmountChange = useCallback((v: string) => {
    setRepayAmount(v);
    setRepayAmountError("");
  }, []);

  const onMaxClick = useCallback(() => {
    if (maxTransferable <= 0n) return;        // no-op
    setRepayAmount(formatUnits(maxTransferable, 18));
    setRepayAmountError("");
  }, [maxTransferable]);


  const handleRepay = useCallback(async () => {
    const isFullRepay = repayWei >= totalOwed && totalOwed > 0n;
    
    try {
      if (isFullRepay) {
        await repayAll();
      } else {
        const feeWei = toWei18(REPAY_FEE);
        const availableWei = usdstBal > feeWei ? (usdstBal - feeWei) : 0n;
        const safeAvailableWei = availableWei > 1n ? (availableWei - 1n) : 0n; // 1-wei safety
        const finalRepayWei = repayWei > totalOwed ? totalOwed : (repayWei > safeAvailableWei ? safeAvailableWei : repayWei);
        await repayLoan({ amount: finalRepayWei.toString() } as any);
      }
      
      setRepayAmount("");
      setRepayAmountError("");
    } finally {
      onActionComplete?.();
    }
  }, [repayWei, totalOwed, usdstBal, repayAll, repayLoan, onActionComplete]);

  // Memoized vouchers calculation
  const vouchersRequired = useMemo(
    () => Math.ceil(safeParseFloat(REPAY_FEE) * VOUCHERS_PER_UNIT),
    []
  );

  // Precomputed button state
  const repayAmountValid = repayWei > 0n && repayWei <= maxTransferable && !repayAmountError;
  const repayDisabled = loading || !repayAmountValid;


  if (!loans) {
    return (
      <div className="text-center text-gray-500 py-8">
        No active loan to repay
      </div>
    );
  }

  const canPayFee = usdstBal + voucherBal >= toWei18(REPAY_FEE);

  return (
    <div className="space-y-4 pt-4">
      {/* Loan Details */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">Total Amount Owed</span>
          <div className="flex items-center gap-2">
            <span className={`font-normal transition-opacity duration-300 ${isUpdating ? 'opacity-50' : 'opacity-100'}`}>
              USDST {formatUnits(totalOwed <= 1n ? 0n : totalOwed, 18)}
            </span>
            {loading && (
              <div className="animate-spin rounded-full h-3 w-3 border-t border-b border-blue-500"></div>
            )}
          </div>
        </div>

        {loans?.totalAmountOwedPreview && (
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Projected Debt</span>
            <span className={`font-medium transition-opacity duration-300 ${isUpdating ? 'opacity-50' : 'opacity-100'}`}>
              USDST {formatUnits(toBig(loans?.totalAmountOwedPreview) <= 1n ? 0n : toBig(loans?.totalAmountOwedPreview), 18)}
            </span>
          </div>
        )}
      </div>

      {/* Repay Amount Input */}
      <TokenInput
        value={repayAmount}
        error={repayAmountError}
        tokenName="Repay Amount (USDST)"
        tokenSymbol="USDST"
        maxTransferable={maxTransferable}
        decimals={18}
        disabled={loading || maxTransferable === 0n}
        loading={loading}
        onValueChange={onAmountChange}
        onErrorChange={setRepayAmountError}
        onMaxClick={onMaxClick}
        showPercentageButtons
      />

      {/* Risk Level */}
      <RiskLevelProgress riskLevel={riskLevel} />

      {/* Health Impact Section */}
      <HealthImpactDisplay healthImpact={healthImpact} />

      {/* Payment Summary */}
      <div className="space-y-2 pt-3 border-t">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">Payment Amount</span>
          <span className="font-medium">
            {repayAmount ? `${formatCurrency(repayAmount)} USDST` : "0.00 USDST"}
          </span>
        </div>
        
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">Remaining Balance</span>
          <span className="font-medium">
            {remainingDisplay} USDST
          </span>
        </div>
      </div>

      {/* Transaction Fee */}
      <FeeNotice fee={REPAY_FEE} canPay={canPayFee} vouchersRequired={vouchersRequired} />

      {/* Repay Button */}
      <Button
        type="button"
        onClick={handleRepay}
        disabled={repayDisabled}
        className="w-full"
      >
        {loading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
        ) : (
          "Repay"
        )}
      </Button>
    </div>
  );
};

export default RepayForm;
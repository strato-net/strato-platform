import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { formatUnits } from "ethers";
import { Button } from "@/components/ui/button";
import { BORROW_FEE, VOUCHERS_PER_UNIT } from "@/lib/constants";
import { safeParseUnits, formatWeiAmount, safeParseFloat } from "@/utils/numberUtils";
import { NewLoanData, CollateralData } from "@/interface";
import { calculateBorrowHealthImpact } from "@/utils/lendingUtils";
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

interface BorrowFormProps {
  loans: NewLoanData | null;
  usdstBalance: string;
  collateralInfo: CollateralData[] | null;
  onActionComplete?: () => void;
}

const BorrowForm = ({ loans, usdstBalance, collateralInfo, onActionComplete }: BorrowFormProps) => {
  const [borrowAmount, setBorrowAmount] = useState<string>("");
  const [borrowAmountError, setBorrowAmountError] = useState<string>("");
  const { borrowMax, borrowAsset, loading } = useLendingContext();
  const { voucherBalance } = useUserTokens();
  
  // Track previous max to detect changes
  const prevMaxRef = useRef<bigint>(0n);
  const [isUpdating, setIsUpdating] = useState(false);

  // Centralized parsing - once per render
  const loansMax = toBig(loans?.maxAvailableToBorrowUSD);
  const totalOwed = toBig(loans?.totalAmountOwed);
  const collatUSD = toBig(loans?.totalCollateralValueUSD);
  const borrowWei = toWei18(borrowAmount);
  const usdstBal = toBig(usdstBalance);
  const voucherBal = toBig(voucherBalance);

  // Memoized constants
  const feeWei = useMemo(() => toWei18(BORROW_FEE), []);
  const EPS = 1n;

  // Derived state via useMemo
  const canPayFee = useMemo(() => usdstBal + voucherBal >= feeWei, [usdstBal, voucherBal, feeWei]);

  const maxTransferable = useMemo(
    () => (canPayFee ? loansMax : 0n),
    [canPayFee, loansMax]
  );

  const riskLevel = useMemo(() => {
    if (collatUSD <= DUST_USD_WEI) return 0;
    const totalBorrowed = totalOwed + borrowWei;
    const bp = Number((totalBorrowed * 10000n) / collatUSD) / 100;
    return Math.max(0, Math.min(bp, 100));
  }, [borrowWei, totalOwed, collatUSD]);

  const healthImpact = useMemo(
    () => calculateBorrowHealthImpact(borrowWei, loans),
    [borrowWei, loans]
  );

  const interestRateDisplay = useMemo(() => {
    const num = Number(loans?.interestRate);
    return Number.isFinite(num) ? `${(num / 100).toFixed(2)}%` : "-";
  }, [loans?.interestRate]);

  const availableIsZero = useMemo(() => loansMax === 0n, [loansMax]);
  const availableStr = useMemo(
    () => formatWeiAmount(String(loansMax)),
    [loansMax]
  );

  const owedDisplay = useMemo(() => {
    const d = totalOwed <= 1n ? 0n : totalOwed;
    return formatUnits(d, 18);
  }, [totalOwed]);

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
    if (borrowAmount) {
      const inputWei = toWei18(borrowAmount);
      if (maxTransferable > 0n && inputWei > maxTransferable) {
        setBorrowAmount(formatUnits(maxTransferable, 18));
        setBorrowAmountError("");
      }
    }
    
    prevMaxRef.current = maxTransferable;
  }, [maxTransferable, borrowAmount]);

  // Callbacks for side effects
  const onAmountChange = useCallback((v: string) => {
    setBorrowAmount(v);
    setBorrowAmountError("");
  }, []);

  const onMaxClick = useCallback(() => {
    if (maxTransferable <= 0n) return;        // no-op
    setBorrowAmount(formatUnits(maxTransferable, 18));
    setBorrowAmountError("");
  }, [maxTransferable]);

  const handleBorrow = useCallback(async () => {
    const nearMaxNow = loansMax > 0n && borrowWei + EPS >= loansMax;
    try {
      await (nearMaxNow ? borrowMax() : borrowAsset({ amount: borrowWei.toString() }));
      setBorrowAmount("");
      setBorrowAmountError("");
    } finally {
      onActionComplete?.();
    }
  }, [loansMax, borrowWei, EPS, borrowMax, borrowAsset, onActionComplete]);

  // Precomputed button state
  const borrowAmountValid = borrowWei > 0n && borrowWei <= maxTransferable && !borrowAmountError;
  const borrowDisabled = loading || !borrowAmountValid;

  // Memoized vouchers calculation
  const vouchersRequired = useMemo(
    () => Math.ceil(safeParseFloat(BORROW_FEE) * VOUCHERS_PER_UNIT),
    []
  );


  const BorrowingTips = () => {
    const hasCollateral = (collateralInfo?.length ?? 0) > 0;
    
    // Only show tips if there's no borrowing power
    if (!availableIsZero) {
      return null; // Normal state - no message needed
    }
    
    // Case 1: No collateral at all (no assets with balance > 0)
    if (!hasCollateral && availableIsZero) {
      return (
        <p className="text-yellow-600 text-xs mt-1">
          No assets available. Supply collateral to enable borrowing.
        </p>
      );
    }
    
    // Case 2: Has assets but no borrowing power (already at max or insufficient value)
    if (availableIsZero) {
      return (
        <p className="text-yellow-600 text-xs mt-1">
          Insufficient collateral value. Add more collateral or reduce existing debt.
        </p>
      );
    }
    
    return null;
  };

  return (
    <div className="space-y-4 pt-4">
      {/* Loan Details */}
      <div className="space-y-3">
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">
            Available to borrow {canPayFee ? "" : "(fee required)"}
          </span>
          <div className="flex items-center gap-2">
            <span className={`font-medium transition-opacity duration-300 ${isUpdating ? 'opacity-50' : 'opacity-100'}`}>
              USDST {availableIsZero ? "-" : availableStr}
            </span>
            {loading && (
              <div className="animate-spin rounded-full h-3 w-3 border-t border-b border-blue-500"></div>
            )}
          </div>
        </div>
        <BorrowingTips />
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Total Amount Owed</span>
          <span className={`font-medium transition-opacity duration-300 ${isUpdating ? 'opacity-50' : 'opacity-100'}`}>
            USDST {owedDisplay}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Interest Rate</span>
          <span className="font-medium">
            {interestRateDisplay}
          </span>
        </div>
      </div>

      {/* Borrow Amount Input */}
      <TokenInput
        value={borrowAmount}
        error={borrowAmountError}
        tokenName="Borrow Amount (USDST)"
        tokenSymbol="USDST"
        maxTransferable={maxTransferable}
        decimals={18}
        disabled={loading || maxTransferable === 0n}
        loading={loading}
        onValueChange={onAmountChange}
        onErrorChange={setBorrowAmountError}
        onMaxClick={onMaxClick}
        showPercentageButtons
      />

      {/* Risk Level */}
      <RiskLevelProgress riskLevel={riskLevel} />

      {/* Health Impact */}
      <HealthImpactDisplay healthImpact={healthImpact} showWarning={false} />

      {/* Transaction Fee */}
      <FeeNotice fee={BORROW_FEE} canPay={canPayFee} vouchersRequired={vouchersRequired} />

      {/* Borrow Button */}
        <Button
          type="button"
          onClick={handleBorrow}
          disabled={borrowDisabled}
          className="w-full"
        >
        {loading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
        ) : null}
        Borrow
      </Button>

    </div>
  );
};

export default BorrowForm;
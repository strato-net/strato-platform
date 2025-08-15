import { useState, useEffect } from "react";
import { formatUnits } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REPAY_FEE } from "@/lib/constants";
import { safeParseUnits, addCommasToInput, formatCurrency } from "@/utils/numberUtils";
import { NewLoanData } from "@/interface";
import { calculateRepayHealthImpact } from "@/utils/lendingUtils";
import RiskLevelProgress from "@/components/ui/RiskLevelProgress";
import HealthImpactDisplay from "@/components/ui/HealthImpactDisplay";
import PercentageButtons from "../ui/PercentageButtons";

interface RepayFormProps {
  loans: NewLoanData | null;
  repayLoading: boolean;
  onRepay: (amount: string) => void;
  usdstBalance: string;
}

const RepayForm = ({ loans, repayLoading, onRepay, usdstBalance }: RepayFormProps) => {
  const [repayAmount, setRepayAmount] = useState<string>("");
  const [repayDisplayAmount, setRepayDisplayAmount] = useState("");
  const [riskLevel, setRiskLevel] = useState(0);
  const [healthImpact, setHealthImpact] = useState({
    currentHealthFactor: 0,
    newHealthFactor: 0,
    healthImpact: 0,
    isHealthy: true,
  });

  // Calculate risk level when repay amount changes
  useEffect(() => {
    try {
      if (!loans?.totalCollateralValueUSD || !loans?.totalAmountOwed) {
        setRiskLevel(0);
        return;
      }

      const totalBorrowedBigInt = BigInt(loans.totalAmountOwed);
      const collateralValueBigInt = BigInt(loans.totalCollateralValueUSD);
      const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
      const newBorrowedAmount = totalBorrowedBigInt - repayAmountWei;
      
      if (newBorrowedAmount <= 0n) {
        setRiskLevel(0);
        return;
      }

      const risk = Number((newBorrowedAmount * 10000n) / collateralValueBigInt) / 100;
      setRiskLevel(Math.min(risk, 100));
    } catch {
      setRiskLevel(0);
    }
  }, [repayAmount, loans?.totalCollateralValueUSD, loans?.totalAmountOwed]);

  // Calculate health impact when repay amount changes
  useEffect(() => {
    const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
    const impact = calculateRepayHealthImpact(repayAmountWei, loans);
    setHealthImpact(impact);
  }, [repayAmount, loans]);

  const handleRepayAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, '');
    if (/^\d*\.?\d*$/.test(value)) {
      setRepayDisplayAmount(addCommasToInput(value));
      setRepayAmount(value);
    }
  };

  const handleRepayPercentage = (percentageAmount: string) => {
    setRepayAmount(percentageAmount);
    setRepayDisplayAmount(addCommasToInput(percentageAmount));
  };

  const handleRepay = () => {
    const feeWei = safeParseUnits(REPAY_FEE, 18);
    const totalOwedWei = BigInt(loans?.totalAmountOwed || "0");
    const inputWei = safeParseUnits(repayAmount || "0", 18);
    const availableWei = BigInt(usdstBalance || "0") > feeWei ? (BigInt(usdstBalance || "0") - feeWei) : 0n;
    const repayWei = inputWei > totalOwedWei ? totalOwedWei : (inputWei > availableWei ? availableWei : inputWei);
    onRepay(formatUnits(repayWei, 18));
    setRepayAmount(""); setRepayDisplayAmount("");
  };

  if (!loans) {
    return (
      <div className="text-center text-gray-500 py-8">
        No active loan to repay
      </div>
    );
  }

  const feeWei = safeParseUnits(REPAY_FEE, 18);           // bigint
  const balWei = BigInt(usdstBalance || "0");             // bigint
  const availWei = balWei > feeWei ? (balWei - feeWei) : 0n;

  return (
    <div className="space-y-4 pt-4">
      {/* Loan Details */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">Total Amount Owed</span>
          <span className="font-normal">
            USDST {formatUnits(BigInt(loans?.totalAmountOwed ?? "0"), 18)}
          </span>
        </div>

        {loans?.totalAmountOwedPreview && (
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Projected Debt</span>
            <span className="font-medium">
              USDST {formatUnits(BigInt(loans?.totalAmountOwedPreview ?? "0"), 18)}
            </span>
          </div>
        )}
        
      </div>

      {/* Repay Amount Input */}
      <div className="space-y-3">
        <label className="text-sm font-medium">Repay Amount (USDST)</label>
        <div className="flex justify-between items-center text-xs text-gray-500">
          <span>Min: 0.01 USDST</span>
          <div>
            <button
              type="button"
              onClick={() => {
                const totalOwed = BigInt(loans?.totalAmountOwed || 0);
                const available = BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18);
                const max = available > 0n && available < totalOwed ? available : totalOwed;
                const maxFormatted = formatUnits(max > 0n ? max : 0n, 18);
                setRepayAmount(maxFormatted);
                setRepayDisplayAmount(addCommasToInput(maxFormatted));
              }}
              disabled={(() => {
                const totalOwed = BigInt(loans?.totalAmountOwed || 0);
                const available = BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18);
                const max = available > 0n && available < totalOwed ? available : totalOwed;
                return max === 0n;
              })()}
              className="px-2 py-1 mr-1 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-100"
              title={(() => {
                const totalOwed = BigInt(loans?.totalAmountOwed || 0);
                const available = BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18);
                const max = available > 0n && available < totalOwed ? available : totalOwed;
                return max === 0n ? "No amount available to repay" : "Set to maximum repayable amount";
              })()}
            >
              Max :
            </button>
            <span>{(() => {
              const totalOwed = BigInt(loans?.totalAmountOwed || 0);
              const available = BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18);
              const max = available < totalOwed ? available : totalOwed;
              return max <= 0n ? '-' : formatCurrency(formatUnits(max, 18));
            })()} USDST</span>
          </div>
        </div>
        <div className="relative">
          <Input
            placeholder="0.00"
            className={`pr-16 ${(() => { 
              const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
              const totalOwed = BigInt(loans?.totalAmountOwed || 0);
              const available = BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18);
              return repayAmountWei > totalOwed || repayAmountWei > available ? 'text-red-600' : ''; 
            })()}`}
            value={repayDisplayAmount}
            onChange={handleRepayAmountChange}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">USDST</span>
        </div>
        
        {/* USDST Balance Display */}
        <div className="text-xs text-gray-500">
          Your USDST Balance: {formatCurrency(formatUnits(balWei, 18))} USDST ({formatCurrency(formatUnits(availWei, 18))} USDST available for repayment)
        </div>  

        {/* Balance validation warnings */}
        {(() => {
          const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
          const totalNeeded = repayAmountWei + safeParseUnits(REPAY_FEE, 18);
          const balance = BigInt(usdstBalance || "0");
          
          return repayAmount && totalNeeded > balance ? (
            <p className="text-red-600 text-sm mt-1">
              Insufficient USDST balance. You need {formatCurrency(formatUnits(totalNeeded, 18))} USDST ({formatCurrency(formatUnits(repayAmountWei, 18))} + {REPAY_FEE} fee) but have {formatCurrency(formatUnits(balance, 18))} USDST.
            </p>
          ) : null;
        })()}
        
        {/* Max amount validation warnings */}
        {(() => {
          const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
          const totalOwed = BigInt(loans?.totalAmountOwed || 0);
          const available = BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18);
          const maxAmount = available < totalOwed ? available : totalOwed;
          
          return repayAmount && repayAmountWei > maxAmount ? (
            <p className="text-red-600 text-sm mt-1">
              Amount cannot exceed {formatCurrency(formatUnits(maxAmount, 18))} USDST.
            </p>
          ) : null;
        })()}
        
        {/* Percentage Buttons */}
        <PercentageButtons
          value={repayAmount}
          maxValue={(() => {
            const maxAvailable = BigInt(loans?.totalAmountOwed || 0);
            const availableAfterFee = BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18);
            const maxAmount = availableAfterFee > 0n && availableAfterFee < maxAvailable ? availableAfterFee : maxAvailable;
            return maxAmount.toString();
          })()}
          onChange={(val) => {
            handleRepayPercentage(val);
          }}
          className="pt-2"
        />
      </div>

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
            {(() => {
              try {
                const totalOwed = BigInt(loans?.totalAmountOwed || 0);
                const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
                const remaining = totalOwed - repayAmountWei;
                return `${formatCurrency(formatUnits(remaining > 0n ? remaining : 0n, 18))} USDST`;
              } catch {
                return `${formatCurrency(formatUnits(BigInt(loans?.totalAmountOwed || "0"), 18))} USDST`;
              }
            })()}
          </span>
        </div>
      </div>

      {/* Transaction Fee */}
      <div className="px-4 py-3 bg-gray-50 rounded-md">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-600">Transaction Fee</span>
          <span className="font-medium">{REPAY_FEE} USDST</span>
        </div>
        {(() => {
          const feeAmount = safeParseUnits(REPAY_FEE, 18);
          const usdstBalanceBigInt = BigInt(usdstBalance || "0");
          const isInsufficientUsdstForFee = usdstBalanceBigInt < feeAmount;
          
          return isInsufficientUsdstForFee ? (
            <p className="text-yellow-600 text-sm mt-1">
              Insufficient USDST balance for transaction fee ({REPAY_FEE} USDST)
            </p>
          ) : null;
        })()}
      </div>

      {/* Repay Button */}
      <Button
        onClick={handleRepay}
        disabled={
          repayLoading ||
          !repayAmount ||
          (() => { try { return safeParseUnits(repayAmount || "0", 18) === 0n; } catch { return true; } })() ||
          (() => { try { return safeParseUnits(repayAmount || "0", 18) > BigInt(loans?.totalAmountOwed || 0); } catch { return true; } })() ||
          (() => {
            const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
            const totalNeeded = repayAmountWei + safeParseUnits(REPAY_FEE, 18);
            return BigInt(usdstBalance || "0") < totalNeeded;
          })()
        }
        className="w-full"
      >
        {repayLoading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
        ) : (
          `Repay ${repayAmount ? `${formatCurrency(repayAmount)} USDST` : "0.00 USDST"}`
        )}
      </Button>
    </div>
  );
};

export default RepayForm;
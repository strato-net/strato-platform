import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REPAY_FEE } from "@/lib/constants";
import { safeParseUnits, addCommasToInput, formatCurrency, formatUnits } from "@/utils/numberUtils";
import { NewLoanData } from "@/interface";
import { calculateRepayHealthImpact } from "@/utils/lendingUtils";
import RiskLevelProgress from "@/components/ui/RiskLevelProgress";
import HealthImpactDisplay from "@/components/ui/HealthImpactDisplay";
import PercentageButtons from "../ui/PercentageButtons";
import { computeMaxTransferable, handleAmountInputChange } from "@/utils/transferValidation";

interface RepayFormProps {
  loans: NewLoanData | null;
  repayLoading: boolean;
  onRepay: (amount: string) => void;
  usdstBalance: string;
  voucherBalance: string;
}

const RepayForm = ({ loans, repayLoading, onRepay, usdstBalance, voucherBalance }: RepayFormProps) => {
  const [repayAmount, setRepayAmount] = useState<string>("");
  const [repayAmountError, setRepayAmountError] = useState<string>("");
  const [feeError, setFeeError] = useState<string>("");
  const [riskLevel, setRiskLevel] = useState(0);
  const [healthImpact, setHealthImpact] = useState({
    currentHealthFactor: 0,
    newHealthFactor: 0,
    healthImpact: 0,
    isHealthy: true,
  });
  const maxAmount = useMemo(
    () =>
      computeMaxTransferable(
        BigInt(loans?.totalAmountOwed || 0) < (BigInt(usdstBalance) - 1n)
          ? loans?.totalAmountOwed
          : (BigInt(usdstBalance) - 1n).toString(),
        true,
        voucherBalance,
        (BigInt(usdstBalance) - 1n).toString(),
        safeParseUnits(REPAY_FEE).toString(),
        setFeeError
      ),
    [voucherBalance, usdstBalance, loans?.totalAmountOwed]
  );

  // Calculate risk level when repay amount changes
  useEffect(() => {
    try {
      if (!loans?.totalCollateralValueUSD || !loans?.totalAmountOwed) {
        setRiskLevel(0);
        return;
      }

      const totalBorrowedBigInt = BigInt(loans.totalAmountOwed);
      const collateralValueBigInt = BigInt(loans.totalCollateralValueUSD);
      const repayAmountWei = safeParseUnits(repayAmount || "0");
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
    const repayAmountWei = safeParseUnits(repayAmount || "0");
    const impact = calculateRepayHealthImpact(repayAmountWei, loans);
    setHealthImpact(impact);
  }, [repayAmount, loans]);

  const handleRepay = async () => {
    const owed = BigInt(loans?.totalAmountOwed || 0);
    const inputWei = safeParseUnits(repayAmount || "0");
    const isFullRepay = inputWei >= owed && owed > 0n;
    if (isFullRepay) {
      onRepay('ALL');
      setRepayAmount(""); setRepayAmountError(""); setFeeError("");
      return;
    }
    onRepay(formatUnits(inputWei));
    setRepayAmount(""); setRepayAmountError(""); setFeeError("");
  };

  if (!loans) {
    return (
      <div className="text-center text-gray-500 py-8">
        No active loan to repay
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      {/* Loan Details */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">Total Amount Owed</span>
          <span className="font-normal">
            {(() => {
              try {
                const bi = BigInt(loans?.totalAmountOwed ?? "0");
                const display = bi <= 1n ? 0n : bi;
                return `USDST ${formatUnits(display)}`;
              } catch {
                return `USDST 0`;
              }
            })()}
          </span>
        </div>

        {loans?.totalAmountOwedPreview && (
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Projected Debt</span>
            <span className="font-medium">
              {(() => {
                try {
                  const bi = BigInt(loans?.totalAmountOwedPreview ?? "0");
                  const display = bi <= 1n ? 0n : bi;
                  return `USDST ${formatUnits(display)}`;
                } catch {
                  return `USDST 0`;
                }
              })()}
            </span>
          </div>
        )}
        
        <div className="flex justify-between items-center pt-2 border-t">
          <span className="text-lg">{(() => { try { const bi = BigInt(loans?.totalAmountOwed ?? "0"); const display = bi <= 1n ? 0n : bi; return `USDST ${formatUnits(display)}`; } catch { return `USDST 0`; } })()}</span>
        </div>
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
                try {
                  setRepayAmount(formatUnits(BigInt(maxAmount)));
                  setRepayAmountError("");
                } catch {}
              }}
                disabled={(() => {
                return BigInt(maxAmount) === 0n;
              })()}
              className="px-2 py-1 mr-1 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-100"
              title={(() => {
                const owed = BigInt(loans?.totalAmountOwed || 0);
                return owed === 0n ? "No amount available to repay" : "Set to total debt (Repay All)";
              })()}
            >
              Max :
            </button>
            <span>{(() => {
              return BigInt(maxAmount) <= 0n ? '-' : formatCurrency(formatUnits(BigInt(maxAmount)));
            })()} USDST</span>
          </div>
        </div>
        <div className="relative">
          <Input
            placeholder="0.00"
            className={`pr-16 ${(() => { 
              return safeParseUnits(repayAmount || "0") > BigInt(maxAmount) ? 'text-red-600' : ''; 
            })()}`}
            value={addCommasToInput(repayAmount)}
            onChange={(e)=>{
              const value = e.target.value;
              handleAmountInputChange(value, setRepayAmount, setRepayAmountError, maxAmount);
            }}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">USDST</span>
        </div>
        {repayAmountError && (
          <p className="text-red-600 text-sm">{repayAmountError}</p>
        )}
        <PercentageButtons
          value={repayAmount}
          maxValue={(() => {
            return BigInt(maxAmount).toString();
          })()}
          onChange={(val) => {
            setRepayAmount(val);
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
                const repayAmountWei = safeParseUnits(repayAmount || "0");
                const remaining = totalOwed - repayAmountWei;
                return `${formatCurrency(formatUnits(remaining > 0n ? remaining : 0n))} USDST`;
              } catch {
                return `${formatCurrency(formatUnits(BigInt(loans?.totalAmountOwed || "0")))} USDST`;
              }
            })()}
          </span>
        </div>
      </div>

      {/* Transaction Fee */}
      <div className="px-4 py-3 bg-gray-50 rounded-md">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-600">Transaction Fee</span>
          <span className="font-medium">{REPAY_FEE} USDST ({parseFloat(REPAY_FEE) * 100} voucher)</span>
        </div>
        { feeError && (
          <p className="text-yellow-600 text-sm mt-1">{feeError}</p>
        )}
      </div>

      {/* Repay Button */}
      <Button
        onClick={handleRepay}
        disabled={
          repayLoading ||
          !repayAmount ||
          !!feeError ||
          !!repayAmountError ||
          (() => { try { return safeParseUnits(repayAmount || "0") === 0n; } catch { return true; } })()
        }
        className="w-full"
      >
        {repayLoading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
        ) : (
          "Repay"
        )}
      </Button>
    </div>
  );
};

export default RepayForm;
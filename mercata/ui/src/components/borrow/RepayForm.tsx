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
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface RepayFormProps {
  loans: NewLoanData | null;
  repayLoading: boolean;
  onRepay: (amount: string) => void;
  usdstBalance: string;
  voucherBalance: string;
}

// Component to display numbers with 2 decimals, showing full value on hover
const FormattedAmount = ({ 
  value, 
  symbol = "USDST", 
  className = "" 
}: { 
  value: string; 
  symbol?: string; 
  className?: string;
}) => {
  // Preserve the original string value for full precision display
  const fullValue = value || "0";
  
  // Format to exactly 2 decimals for display using formatCurrency helper
  const formatted2Decimals = (() => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return "0.00";
    // formatCurrency handles locale formatting, then ensure exactly 2 decimals
    return numValue.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  })();
  
  // Format full value with commas using addCommasToInput helper
  const fullValueFormatted = fullValue === "0" 
    ? "0" 
    : addCommasToInput(fullValue);
  
  // Only show tooltip if the formatted value differs from full value
  const needsTooltip = formatted2Decimals !== fullValueFormatted && fullValueFormatted !== "0";
  
  if (!needsTooltip) {
    return (
      <span className={className}>
        {formatted2Decimals} {symbol}
      </span>
    );
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`cursor-help ${className}`}>
          {formatted2Decimals} {symbol}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{fullValueFormatted} {symbol}</p>
      </TooltipContent>
    </Tooltip>
  );
};

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
  const maxAmount = useMemo(() => {
    const availableBalance = (BigInt(usdstBalance) - 1n).toString();
    const maxTransferable = computeMaxTransferable(
      availableBalance,
      true,
      voucherBalance,
      availableBalance,
      safeParseUnits(REPAY_FEE).toString(),
      setFeeError
    );
    
    const totalOwed = BigInt(loans?.totalAmountOwed || 0);
    return BigInt(maxTransferable) < totalOwed ? maxTransferable : totalOwed.toString();
  }, [voucherBalance, usdstBalance, loans?.totalAmountOwed]);

  // Calculate risk level when repay amount changes
  useEffect(() => {
    try {
      if (!loans?.totalCollateralValueUSD || !loans?.totalAmountOwed) {
        setRiskLevel(0);
        return;
      }

      const totalBorrowedBigInt = BigInt(loans.totalAmountOwed);
      const collateralValueBigInt = BigInt(loans.totalCollateralValueUSD);
      // If there's an error, treat repay amount as 0 (no repayment)
      const repayAmountWei = repayAmountError ? 0n : safeParseUnits(repayAmount || "0");
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
  }, [repayAmount, loans?.totalCollateralValueUSD, loans?.totalAmountOwed, repayAmountError]);

  // Calculate health impact when repay amount changes
  useEffect(() => {
    const repayAmountWei = repayAmountError ? 0n : safeParseUnits(repayAmount || "0");
    const impact = calculateRepayHealthImpact(repayAmountWei, loans);
    setHealthImpact(impact);
  }, [repayAmount, loans, repayAmountError]);

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
      <div className="text-center text-muted-foreground py-8">
        No active loan to repay
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4 pt-4">
      {/* Loan Details */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Total Amount Owed</span>
          <span className="font-normal">
            {(() => {
              try {
                const bi = BigInt(loans?.totalAmountOwed ?? "0");
                const display = bi <= 1n ? 0n : bi;
                return <FormattedAmount value={formatUnits(display)} />;
              } catch {
                return <FormattedAmount value="0" />;
              }
            })()}
          </span>
        </div>

        {loans?.totalAmountOwedPreview && (
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Projected Debt</span>
            <span className="font-medium">
              {(() => {
                try {
                  const bi = BigInt(loans?.totalAmountOwedPreview ?? "0");
                  const display = bi <= 1n ? 0n : bi;
                  return <FormattedAmount value={formatUnits(display)} />;
                } catch {
                  return <FormattedAmount value="0" />;
                }
              })()}
            </span>
          </div>
        )}
        
        <div className="flex justify-between items-center pt-2 border-t">
          <span className="text-lg">
            {(() => {
              try {
                const bi = BigInt(loans?.totalAmountOwed ?? "0");
                const display = bi <= 1n ? 0n : bi;
                return <FormattedAmount value={formatUnits(display)} />;
              } catch {
                return <FormattedAmount value="0" />;
              }
            })()}
          </span>
        </div>
      </div>

      {/* Repay Amount Input */}
      <div className="space-y-3">
        <label className="text-sm font-medium">Repay Amount (USDST)</label>
        <div className="flex justify-between items-center text-xs text-muted-foreground">
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
              className="px-2 py-1 mr-1 bg-muted hover:bg-muted/80 rounded-full text-foreground text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
              title={(() => {
                const owed = BigInt(loans?.totalAmountOwed || 0);
                return owed === 0n ? "No amount available to repay" : "Set to total debt (Repay All)";
              })()}
            >
              Max :
            </button>
            {BigInt(maxAmount) <= 0n ? (
              <span>- USDST</span>
            ) : (
              <FormattedAmount value={formatUnits(BigInt(maxAmount))} />
            )}
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
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">USDST</span>
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
          disabled={BigInt(maxAmount) < 1e15} // Disable if less than 0.001 USDST (1e15 wei)
        />
      </div>

      {/* Risk Level */}
      <RiskLevelProgress riskLevel={riskLevel} />

      {/* Health Impact Section */}
      <HealthImpactDisplay healthImpact={healthImpact} />

      {/* Payment Summary */}
      <div className="space-y-2 pt-3 border-t border-border">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Payment Amount</span>
          <span className="font-medium">
            <FormattedAmount value={repayAmountError ? "0" : (repayAmount || "0")} />
          </span>
        </div>
        
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Remaining Balance</span>
          <span className="font-medium">
            {(() => {
              try {
                const totalOwed = BigInt(loans?.totalAmountOwed || 0);
                // If there's an error, show full amount owed (no repayment)
                if (repayAmountError) {
                  return <FormattedAmount value={formatUnits(totalOwed)} />;
                }
                const repayAmountWei = safeParseUnits(repayAmount || "0");
                const remaining = totalOwed - repayAmountWei;
                return <FormattedAmount value={formatUnits(remaining > 0n ? remaining : 0n)} />;
              } catch {
                return <FormattedAmount value={formatUnits(BigInt(loans?.totalAmountOwed || "0"))} />;
              }
            })()}
          </span>
        </div>
      </div>

      {/* Transaction Fee */}
      <div className="px-4 py-3 bg-muted/50 rounded-md">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-muted-foreground">Transaction Fee</span>
          <span className="font-medium">{REPAY_FEE} USDST ({parseFloat(REPAY_FEE) * 100} voucher)</span>
        </div>
        { feeError && (
          <p className="text-yellow-600 dark:text-yellow-500 text-sm mt-1">{feeError}</p>
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
    </TooltipProvider>
  );
};

export default RepayForm;
import { useState, useEffect } from "react";
import { formatUnits, parseUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { useLendingContext } from "@/context/LendingContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { REPAY_FEE } from "@/lib/contants";
import { safeParseUnits } from "@/utils/numberUtils";

interface RepayModalProps {
  isOpen: boolean;
  onClose: () => void;
  loan: any | null;
  onRepaySuccess: () => void;
  usdstBalance?: string;
}

const formatCurrency = (value: string | number) => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return "0.00";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
};

const addCommasToInput = (value: string) => {
  if (!value) return '';
  
  const parts = value.split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  if (parts.length === 2) {
    return integerPart + '.' + parts[1];
  }
  
  return integerPart;
};

const RepayModal = ({ isOpen, onClose, loan, onRepaySuccess, usdstBalance = "0" }: RepayModalProps) => {  
  const [repayAmount, setRepayAmount] = useState<string>('');
  const [displayAmount, setDisplayAmount] = useState('');
  const [repayLoading, setRepayLoading] = useState(false);

  const { toast } = useToast();
  const { repayLoan: repayLoanFn } = useLendingContext();

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setRepayAmount('');
      setDisplayAmount('');
    }
  }, [isOpen]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, '');
    if (/^\d*\.?\d*$/.test(value)) {
      setRepayAmount(value);
      setDisplayAmount(addCommasToInput(value));
    }
  };

  const repayLoan = async () => {
    try {
      setRepayLoading(true);
      const totalOwedWei = BigInt(loan?.totalAmountOwed || 0);
      let amountInWei = parseUnits(repayAmount || "0", 18);
      
      // Cap at total owed amount
      if (amountInWei > totalOwedWei) {
        amountInWei = totalOwedWei;
      }

      await repayLoanFn({
        amount: amountInWei.toString(),
      });
      
      toast({
        title: "Success",
        description: `Successfully Repaid ${repayAmount} USDST`,
        variant: "success",
      });
      
      // Clear inputs after successful repay
      setRepayAmount("");
      setDisplayAmount("");
      setRepayLoading(false);
      
      // Close modal and call success callback
      onClose();
      onRepaySuccess();
    } catch (error) {
      console.error("Error repaying loan:", error);
      toast({
        title: "Error",
        description: `Repay Error - ${error}`,
        variant: "destructive",
      });
      setRepayLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    setRepayAmount("");
    setDisplayAmount("");
  };

  const handlePercentageClick = (percent?: bigint) => {
    const totalOwed = BigInt(loan?.totalAmountOwed || 0);
    const available = BigInt(usdstBalance || "0") - parseUnits(REPAY_FEE, 18);
    const maxAmount = available < totalOwed ? available : totalOwed;
    const amount = formatUnits((maxAmount * percent) / 100n, 18);
    setRepayAmount(amount);
    setDisplayAmount(addCommasToInput(amount));
  };
  
  if (!loan) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center text-white text-xs font-bold">
              US
            </div>
            Repay USDST Loan
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-2 py-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Principal Balance</span>
            <span className="font-medium">${formatUnits(loan?.principalBalance || 0, 18)}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Accrued Interest</span>
            <span className="font-medium">${formatUnits(loan?.accruedInterest || 0, 18)}</span>
          </div>
          
          <div className="flex justify-between items-center font-bold pt-2 border-t">
            <span>Total Amount Due</span>
            <span className="text-lg">${formatUnits(loan?.totalAmountOwed || 0, 18)}</span>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium">Repay Amount (USDST)</label>
          <div className="flex justify-between text-xs text-gray-500">
            <span>Min: $0.01</span>
            <span>Max: ${(() => {
              const totalOwed = BigInt(loan?.totalAmountOwed || 0);
              const available = BigInt(usdstBalance || "0") - parseUnits(REPAY_FEE, 18);
              const max = available < totalOwed ? available : totalOwed;
              return formatCurrency(formatUnits(max > 0n ? max : 0n, 18));
            })()}</span>
          </div>
          <div className="relative">
            <Input
              placeholder="0.00"
              className={`pr-8 ${(() => { 
                const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
                const totalOwed = BigInt(loan?.totalAmountOwed || 0);
                const available = BigInt(usdstBalance || "0") - parseUnits(REPAY_FEE, 18);
                return repayAmountWei > totalOwed || repayAmountWei > available ? 'text-red-600' : ''; 
              })()}`}
              value={displayAmount}
              onChange={handleAmountChange}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
          </div>
          
          {/* USDST Balance Display */}
          <div className="text-xs text-gray-500">
            Your USDST Balance: ${formatCurrency(formatUnits(usdstBalance || "0", 18))} (${formatCurrency(formatUnits(BigInt(usdstBalance || "0") - parseUnits(REPAY_FEE, 18), 18))} available for repayment)
          </div>
          
          {/* Balance validation warnings */}
          {(() => {
            const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
            const totalNeeded = repayAmountWei + parseUnits(REPAY_FEE, 18);
            const balance = BigInt(usdstBalance || "0");
            
            return repayAmount && totalNeeded > balance ? (
              <p className="text-red-600 text-sm mt-1">
                Insufficient USDST balance. You need ${formatCurrency(formatUnits(totalNeeded, 18))} USDST (${formatCurrency(formatUnits(repayAmountWei, 18))} + ${REPAY_FEE} fee) but have ${formatCurrency(formatUnits(balance, 18))} USDST.
              </p>
            ) : null;
          })()}
          
          <div className="flex gap-2">
            <Button
              variant={safeParseUnits(repayAmount || "0", 18) === (BigInt(loan?.totalAmountOwed || 0) * 10n) / 100n ? "default" : "outline"}
              size="sm"
              onClick={() => handlePercentageClick(10n)}
              className="flex-1"
            >
              10%
            </Button>
            <Button
              variant={safeParseUnits(repayAmount || "0", 18) === (BigInt(loan?.totalAmountOwed || 0) * 25n) / 100n ? "default" : "outline"}
              size="sm"
              onClick={() => handlePercentageClick(25n)}
              className="flex-1"
            >
              25%
            </Button>
            <Button
              variant={safeParseUnits(repayAmount || "0", 18) === (BigInt(loan?.totalAmountOwed || 0) * 50n) / 100n ? "default" : "outline"}
              size="sm"
              onClick={() => handlePercentageClick(50n)}              
              className="flex-1"
            >
              50%
            </Button>
            <Button
              variant={safeParseUnits(repayAmount || "0", 18) === BigInt(loan?.totalAmountOwed || 0) ? "default" : "outline"}
              size="sm"
              onClick={() => handlePercentageClick(100n)}
              className="flex-1"
            >
              100%
            </Button>
          </div>
        </div>

        <div className="space-y-2 pt-3 border-t">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Payment Amount</span>
            <span className="font-medium">
              {repayAmount ? `$${formatCurrency(repayAmount)}` : "$0.00"}
            </span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Remaining Balance</span>
            <span className="font-medium">
              {(() => {
                try {
                  const totalOwed = BigInt(loan?.totalAmountOwed || 0);
                  const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
                  const remaining = totalOwed - repayAmountWei;
                  return `$${formatCurrency(formatUnits(remaining > 0n ? remaining : 0n, 18))}`;
                } catch {
                  return `$${formatCurrency(formatUnits(loan?.totalAmountOwed || 0, 18))}`;
                }
              })()}
            </span>
          </div>
        </div>

        {/* Transaction Fee Display */}
        <div className="px-4 py-3 bg-gray-50 rounded-md">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-600">Transaction Fee</span>
            <span className="font-medium">{REPAY_FEE} USDST</span>
          </div>
          {/* Fee validation warnings */}
          {(() => {
            const feeAmount = parseUnits(REPAY_FEE, 18);
            const usdstBalanceBigInt = BigInt(usdstBalance || "0");
            
            // Check if insufficient USDST for fee
            const isInsufficientUsdstForFee = usdstBalanceBigInt < feeAmount;
            
            return (
              <>
                {isInsufficientUsdstForFee && (
                  <p className="text-yellow-600 text-sm mt-1">
                    Insufficient USDST balance for transaction fee ({REPAY_FEE} USDST)
                  </p>
                )}
              </>
            );
          })()}
        </div>

        <div className="px-4 py-3 bg-gray-50 rounded-md text-sm">
          <p className="text-gray-600">
            Repaying your loan will reduce your debt and may free up collateral. Full repayment will close the loan and unlock all collateral.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            className="mr-2"
          >
            Cancel
          </Button>
          <Button
            onClick={repayLoan}
            disabled={
              repayLoading ||
              !repayAmount ||
              (() => { try { return parseUnits(repayAmount || "0", 18) === 0n; } catch { return true; } })() ||
              (() => { try { return parseUnits(repayAmount || "0", 18) > BigInt(loan?.totalAmountOwed || 0); } catch { return true; } })() ||
              (() => {
                const repayAmountWei = parseUnits(repayAmount || "0", 18);
                const totalNeeded = repayAmountWei + parseUnits(REPAY_FEE, 18);
                return BigInt(usdstBalance || "0") < totalNeeded;
              })()
            }
            className="px-6"
          >
            {repayLoading ? (
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div>
            ) : (
              `Repay ${repayAmount ? `$${formatCurrency(repayAmount)}` : "$0.00"}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RepayModal;
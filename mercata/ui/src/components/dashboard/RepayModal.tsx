import { useState, useEffect } from "react";
import { formatUnits, parseUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { useLendingContext } from "@/context/LendingContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface RepayModalProps {
  isOpen: boolean;
  onClose: () => void;
  loan: any | null;
  onRepaySuccess: () => void;
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

const RepayModal = ({ isOpen, onClose, loan, onRepaySuccess }: RepayModalProps) => {  
  const [repayAmount, setRepayAmount] = useState('');
  const [displayAmount, setDisplayAmount] = useState('');
  const [repayLoading, setRepayLoading] = useState(false);
  const [wrongAmount, setWrongAmount] = useState(false);

  const { toast } = useToast();
  const { repayLoan: repayLoanFn } = useLendingContext();

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setRepayAmount('');
      setDisplayAmount('');
      setWrongAmount(false);
    }
  }, [isOpen]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, ''); // Remove existing commas
    if (/^\d*\.?\d*$/.test(value)) {
      const numValue = parseFloat(value || "0");
      const maxValue = parseFloat(formatUnits(loan?.totalAmountOwed || 0,18))
      
      // Cap the input at the maximum loan balance
      if (numValue <= maxValue || value === "") {
        setRepayAmount(value);
        setDisplayAmount(addCommasToInput(value));
        const totalOwedWei = BigInt(loan?.totalAmountOwed || 0) + BigInt(loan?.interestRate || 0);
        setWrongAmount(parseUnits(value === "" ? "0" : value, 18) > totalOwedWei);
      }
    }
  };

  const repayLoan = async () => {
    try {
      setRepayLoading(true);
      const totalOwedWei = (BigInt(loan?.totalAmountOwed || 0) + BigInt(loan?.interestRate || 0)).toString();
      let amountInWei = parseUnits(repayAmount === "" ? "0" : repayAmount, 18).toString();
      if (BigInt(amountInWei) > BigInt(totalOwedWei)) {
        amountInWei = totalOwedWei; // clip to full repay
      }

      await repayLoanFn({
        amount: amountInWei,
      });
      
      toast({
        title: "Success",
        description: `Successfully Repaid $${formatCurrency(repayAmount)} USDST`,
        variant: "success",
      });
      
      // Close modal and reset state immediately for better UX
      onClose();
      setRepayAmount("");
      setDisplayAmount("");
      setRepayLoading(false);
      
      toast({
        title: "Success",
        description: `Successfully Repaid ${repayAmount} ${loan?.loan.assetSymbol}`,
        variant: "success",
      });
      
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
            <span className="text-sm text-gray-500">Original Loan Amount</span>
            <span className="font-medium">${loan?.totalAmountOwed != null ? formatCurrency(formatUnits(loan.totalAmountOwed.toString(), 18)) : "0.00"}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Accrued Interest</span>
            <span className="font-medium">${formatCurrency(formatUnits(loan?.interestRate || 0, 18))}</span>
          </div>
          
          <div className="flex justify-between items-center font-bold pt-2 border-t">
            <span>Total Amount Due</span>
            <span className="text-lg">${formatCurrency(loan?.balanceHuman)}</span>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium">Repay Amount (USDST)</label>
          <div className="flex justify-between text-xs text-gray-500">
            <span>Min: $0.01</span>
            <span>Max: ${formatCurrency(loan?.balanceHuman)}</span>
          </div>
          <div className="relative">
            <Input
              placeholder={formatCurrency(loan?.balanceHuman)}
              className=""
              value={displayAmount}
              onChange={handleAmountChange}
            />
            {wrongAmount && (
              <p className="text-red-600 text-sm mt-1">
                Insufficient balance
              </p>
            )}
          </div>
          
          <div className="flex gap-2">
            <Button
              variant={repayAmount === (parseFloat((loan?.balanceHuman || "0").toString().replace(/,/g, "")) * 0.1).toFixed(4) ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const amount = (parseFloat((loan?.balanceHuman || "0").toString().replace(/,/g, "")) * 0.1).toFixed(4);
                setRepayAmount(amount);
                setDisplayAmount(addCommasToInput(amount));
              }}
              className="flex-1"
            >
              10%
            </Button>
            <Button
              variant={repayAmount === (parseFloat((loan?.balanceHuman || "0").toString().replace(/,/g, "")) * 0.25).toFixed(4) ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const amount = (parseFloat((loan?.balanceHuman || "0").toString().replace(/,/g, "")) * 0.25).toFixed(4);
                setRepayAmount(amount);
                setDisplayAmount(addCommasToInput(amount));
              }}
              className="flex-1"
            >
              25%
            </Button>
            <Button
              variant={repayAmount === (parseFloat((loan?.balanceHuman || "0").toString().replace(/,/g, "")) * 0.5).toFixed(4) ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const amount = (parseFloat((loan?.balanceHuman || "0").toString().replace(/,/g, "")) * 0.5).toFixed(4);
                setRepayAmount(amount);
                setDisplayAmount(addCommasToInput(amount));
              }}
              className="flex-1"
            >
              50%
            </Button>
            <Button
              variant={repayAmount === loan?.balanceHuman ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setRepayAmount((loan?.balanceHuman || "0").toString().replace(/,/g, ""));
                setDisplayAmount(addCommasToInput((loan?.balanceHuman || "0").toString().replace(/,/g, "")));
              }}
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
              {repayAmount ? 
                (parseFloat(repayAmount) < 0 ? 
                  `-$${formatCurrency(Math.abs(parseFloat(repayAmount)))}` : 
                  `$${formatCurrency(repayAmount)}`
                ) : 
                "$0.00"
              }
            </span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Remaining Balance</span>
            <span className="font-medium">
              ${repayAmount ? formatCurrency((parseFloat((loan?.balanceHuman || "0").toString().replace(/,/g, "")) - parseFloat(repayAmount))) : formatCurrency(loan?.balanceHuman)}
            </span>
          </div>
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
              isNaN(Number(repayAmount)) ||
              Number(repayAmount) <= 0 ||
              Number(repayAmount) > Number((loan?.totalAmountOwed || "0").toString().replace(/,/g, ""))
            }
            className="px-6"
          >
            {repayLoading ? (
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div>
            ) : (
              `Repay $${repayAmount ? formatCurrency(repayAmount) : "0.00"}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RepayModal;
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, AlertTriangle } from "lucide-react";
import { CollateralData, NewLoanData } from "@/interface";
import { formatUnits } from "ethers";
import { useMobileTooltip } from "@/hooks/use-mobile-tooltip";
import { useLendingContext } from "@/context/LendingContext";

interface BorrowingSectionProps {
  userCollaterals: CollateralData[];
  loanData: NewLoanData;
}

const InfoTooltip = ({ children, content }: { children: React.ReactNode; content: string }) => {
  const { isMobile, showTooltip, handleToggle } = useMobileTooltip('positions-tooltip-container');

  if (isMobile) {
    return (
      <div className="relative positions-tooltip-container">
        <div className="inline-flex items-center gap-1 cursor-help" onClick={handleToggle}>
          {children}
          <HelpCircle className="h-3 w-3 text-muted-foreground hover:text-foreground shrink-0" />
        </div>
        {showTooltip && (
          <div className="absolute top-full left-0 mt-2 z-50 bg-popover border rounded-md px-3 py-1.5 text-xs text-popover-foreground shadow-md max-w-xs">
            <p>{content}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex items-center gap-1 cursor-help">
          {children}
          <HelpCircle className="h-3 w-3 text-muted-foreground hover:text-foreground shrink-0" />
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{content}</p>
      </TooltipContent>
    </Tooltip>
  );
};

const formatValue = (value: bigint | string | number, decimals = 18, maxDecimals = 2): string => {
  try {
    const num = Number(formatUnits(BigInt(value || 0), decimals));
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: maxDecimals });
  } catch {
    return "0.00";
  }
};

const PositionSection = ({ loanData }: BorrowingSectionProps) => {
  const { liquidityInfo } = useLendingContext();

  const getHealthFactorColor = (value: number) => {
    if (value >= 3) return 'text-green-600';
    if (value >= 1.5) return 'text-orange-500';
    return 'text-red-500';
  };

  const borrowIndexDisplay = (() => {
    try {
      const idx = liquidityInfo?.borrowIndex;
      if (!idx) return "0";
      const s = formatUnits(BigInt(idx), 27);
      const [w, f = ""] = s.split(".");
      return f ? `${w}.${f.slice(0, 5)}` : w;
    } catch {
      return "0";
    }
  })();

  const totalAmountOwed = (() => {
    try {
      const owed = BigInt(loanData?.totalAmountOwed || 0);
      return owed <= 1n ? 0n : owed;
    } catch {
      return 0n;
    }
  })();

  const totalAmountOwedNum = parseFloat(formatUnits(totalAmountOwed.toString(), 18));

  return (
    <Card className="shadow-sm rounded-xl h-full">
      <CardContent className="pt-4 md:pt-6 px-4 md:px-6">
        <h2 className="text-lg md:text-xl font-bold mb-3 md:mb-4">Your Position</h2>
        
        <div className="space-y-3 md:space-y-4">
          {/* Total Amount Owed */}
          <div className="p-3 md:p-4 bg-muted/50 rounded-lg">
            <span className="text-xs md:text-sm text-muted-foreground block mb-1">Total Amount Owed</span>
            <span className="text-lg md:text-xl font-semibold">{formatValue(totalAmountOwed)} USDST</span>
          </div>

          {/* Health Factor */}
          <div className="p-3 md:p-4 bg-muted/50 rounded-lg">
            <InfoTooltip content="Measures your position's safety. Higher is better. Close to 1.0 means high risk of liquidation. Below 1.0 means your position can be liquidated. No loan means you have no outstanding debt.">
              <span className="text-xs md:text-sm text-muted-foreground">Health Factor</span>
            </InfoTooltip>
            <div className={`text-lg md:text-xl font-semibold mt-1 ${totalAmountOwedNum === 0 ? 'text-orange-500' : getHealthFactorColor(loanData?.healthFactor || 0)}`}>
              {totalAmountOwedNum === 0 ? "No Loan" : (loanData?.healthFactor?.toFixed(2) || "N/A")}
            </div>
          </div>

          {/* Liquidation Warning */}
          {loanData?.healthFactor < 1 && totalAmountOwedNum > 0 && (
            <div className="flex items-center gap-2 text-red-500 text-[10px] md:text-xs p-2.5 border border-red-200 bg-red-50 dark:bg-red-950/20 rounded-lg">
              <AlertTriangle size={14} className="shrink-0" />
              <span>Position at risk—add collateral or repay.</span>
            </div>
          )}

          {/* Available Borrowing Power */}
          <div className="p-3 md:p-4 bg-muted/50 rounded-lg">
            <InfoTooltip content="You need to supply tokens as collateral before you can borrow. Click 'Supply' in the Eligible Collateral table below to get started.">
              <span className="text-xs md:text-sm text-muted-foreground">Available Borrowing Power</span>
            </InfoTooltip>
            <div className="text-lg md:text-xl font-semibold mt-1">{formatValue(loanData?.maxAvailableToBorrowUSD || 0)} USDST</div>
          </div>

          {/* Borrow Index */}
          <div className="p-3 md:p-4 bg-muted/50 rounded-lg">
            <InfoTooltip content="Global borrow index for the lending pool.">
              <span className="text-xs md:text-sm text-muted-foreground">Borrow Index</span>
            </InfoTooltip>
            <div className="text-lg md:text-xl font-semibold mt-1">{borrowIndexDisplay}</div>
          </div>

          {/* Interest Rate */}
          <div className="p-3 md:p-4 bg-muted/50 rounded-lg">
            <InfoTooltip content="Annual percentage rate you pay on borrowed amounts. This rate applies to your total borrowed amount.">
              <span className="text-xs md:text-sm text-muted-foreground">Interest Rate</span>
            </InfoTooltip>
            <div className="text-lg md:text-xl font-semibold mt-1">{((Number(loanData?.interestRate) || 0) / 100).toFixed(2)}%</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PositionSection;

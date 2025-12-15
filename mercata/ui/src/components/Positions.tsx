import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, AlertTriangle } from "lucide-react";
import { CollateralData, NewLoanData } from "@/interface";
import { formatUnits } from "ethers";
import { formatBalance } from "@/utils/numberUtils";
import { useMobileTooltip } from "@/hooks/use-mobile-tooltip";
import { useLendingContext } from "@/context/LendingContext";
import { useLiquidationContext } from "@/context/LiquidationContext";
import { useUser } from "@/context/UserContext";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface BorrowingSectionProps {
  userCollaterals: CollateralData[];
  loanData: NewLoanData;
}

// Optimized InfoTooltip component using hook
const InfoTooltip = ({ children, content }: { children: React.ReactNode; content: string }) => {
  const { isMobile, showTooltip, handleToggle } = useMobileTooltip('positions-tooltip-container');

  if (isMobile) {
    return (
      <div className="relative positions-tooltip-container">
        <div 
          className="inline-flex items-center gap-1 cursor-help"
          onClick={handleToggle}
        >
          {children}
          <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        </div>
        {showTooltip && (
          <div className="absolute top-full left-0 mt-2 z-50 bg-popover border rounded-md px-3 py-1.5 text-sm text-popover-foreground shadow-md max-w-xs">
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
          <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{content}</p>
      </TooltipContent>
    </Tooltip>
  );
};


const PositionSection = ({ loanData }: BorrowingSectionProps) => {
  const { userAddress } = useUser();
  const { liquidatable, watchlist, loading } = useLiquidationContext();

  function getTextColor(value: number, maxValue = 10) {
  const clamped = Math.min(Math.max(value, 1), maxValue);
  const ratio = (clamped - 1) / (maxValue - 1);

  const red = Math.round(255 * (1 - ratio));
  const green = Math.round(255 * ratio);

  return `rgb(${red}, ${green}, 0)`;
}
  const { liquidityInfo } = useLendingContext();
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


  return (
    <Card className="border border-border shadow-sm">
      <CardHeader className="pb-4">
        <div>
          <CardTitle className="text-2xl font-bold">Your Position</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-8">
        <div className="py-6">
          <div className="space-y-8">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col space-y-3 p-4 bg-muted/50 rounded-lg">
                <span className="text-muted-foreground text-sm font-medium">Total Amount Owed</span>
                <span className="font-semibold text-lg">
                  {(() => {
                    try {
                      const owed = BigInt(loanData?.totalAmountOwed || 0);
                      const display = owed <= 1n ? 0n : owed;
                      return formatBalance(display, "USDST", 18, 2, 2);
                    } catch {
                      return formatBalance(loanData?.totalAmountOwed || 0n, "USDST", 18, 2, 2);
                    }
                  })()}
                </span>
              </div>
              <div className="flex flex-col space-y-3 p-4 bg-muted/50 rounded-lg">
                <InfoTooltip content="Measures your position's safety. Higher is better. Close to 1.0 means high risk of liquidation. Below 1.0 means your position can be liquidated. No loan means you have no outstanding debt.">
                  <span className="text-muted-foreground text-sm font-medium">Health Factor</span>
                </InfoTooltip>
                <div className="flex flex-row gap-3 ">
                <span className="font-semibold text-lg mt-3" style={{ color: getTextColor((loanData?.healthFactor)) }}>
                  {(() => {
                    // Check if there's no outstanding debt
                    const totalAmountOwed = loanData?.totalAmountOwed ? parseFloat(formatUnits(loanData.totalAmountOwed.toString(), 18)) : 0;
                    if (totalAmountOwed === 0) {
                      return "No Loan";
                    }
                    // Check if health factor is valid
                    if (loanData?.healthFactor !== undefined && !isNaN((loanData.healthFactor))) {
                      return (loanData.healthFactor).toFixed(2);
                    }
                    return "N/A";
                  })()}
                </span>
                {/* Liquidation Risk Button */}
                {loanData?.healthFactor<1 &&  (
                  <div className="flex items-center gap-2 text-red-500 text-sm border border-red-500 rounded-md p-2 mt-2"> 
                      <AlertTriangle className="flex-shrink-0" />
                      <span className="text-red-500 text-xs sm:text-sm">Your position is at risk—add collateral or repay to restore health.</span>
                  </div>
                )}
              </div>
              </div>
              <div className="flex flex-col space-y-3 p-4 bg-muted/50 rounded-lg">
                <InfoTooltip content="You need to supply tokens as collateral before you can borrow. Click 'Supply' in the Eligible Collateral table below to get started.">
                  <span className="text-muted-foreground text-sm font-medium">Available Borrowing Power</span>
                </InfoTooltip>
                <span className="font-semibold text-lg">
                  {formatBalance(loanData?.maxAvailableToBorrowUSD || 0n, "USDST", 18, 2, 2)}
                </span>
              </div>
              <div className="flex flex-col space-y-3 p-4 bg-muted/50 rounded-lg">
                <InfoTooltip content="Global borrow index for the lending pool.">
                  <span className="text-muted-foreground text-sm font-medium">Borrow Index</span>
                </InfoTooltip>
                <span className="font-semibold text-lg">{borrowIndexDisplay}</span>
              </div>
              <div className="flex flex-col space-y-3 p-4 bg-muted/50 rounded-lg">
                <InfoTooltip content="Annual percentage rate you pay on borrowed amounts. This rate applies to your total borrowed amount.">
                  <span className="text-muted-foreground text-sm font-medium">Interest Rate</span>
                </InfoTooltip>
                <span className="font-semibold text-lg">{((Number(loanData?.interestRate) || 0) / 100).toFixed(2)}%</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PositionSection;

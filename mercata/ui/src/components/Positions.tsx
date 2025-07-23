import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import { CollateralData, NewLoanData } from "@/interface";
import { formatUnits } from "ethers";
import { formatBalance } from "@/utils/numberUtils";
import { useMobileTooltip } from "@/hooks/use-mobile-tooltip";

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
          <HelpCircle className="h-4 w-4 text-gray-400 hover:text-gray-600" />
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
          <HelpCircle className="h-4 w-4 text-gray-400 hover:text-gray-600" />
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{content}</p>
      </TooltipContent>
    </Tooltip>
  );
};

// Optimized ButtonTooltip component using hook
const ButtonTooltip = ({ children, content }: { children: React.ReactNode; content: string }) => {
  const { isMobile, showTooltip, handleToggle } = useMobileTooltip('positions-tooltip-container');

  if (isMobile) {
    return (
      <div className="relative positions-tooltip-container">
        <div onClick={handleToggle}>
          {children}
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
        {children}
      </TooltipTrigger>
      <TooltipContent>
        <p>{content}</p>
      </TooltipContent>
    </Tooltip>
  );
};

const PositionSection = ({ userCollaterals, loanData }: BorrowingSectionProps) => {

  function getTextColor(value: number, maxValue = 10) {
  const clamped = Math.min(Math.max(value, 1), maxValue);
  const ratio = (clamped - 1) / (maxValue - 1);

  const red = Math.round(255 * (1 - ratio));
  const green = Math.round(255 * ratio);

  return `rgb(${red}, ${green}, 0)`;
}
  
  return (
    <Card className="border border-gray-100 shadow-sm">
      <CardHeader className="pb-4">
        <div>
          <CardTitle className="text-2xl font-bold">Your Position</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-8">
        <div className="py-6">
          <div className="space-y-8">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col space-y-3 p-4 bg-gray-50 rounded-lg">
                <span className="text-gray-600 text-sm font-medium">Total Borrowed</span>
                <span className="font-semibold text-lg">
                  {formatBalance(loanData?.totalAmountOwed || 0n, "USDST", 18, 2, 2)}
                </span>
              </div>
              <div className="flex flex-col space-y-3 p-4 bg-gray-50 rounded-lg">
                <InfoTooltip content="Measures your position's safety. Higher is better. Close to 1.0 means high risk of liquidation. Below 1.0 means your position can be liquidated. No loan means you have no outstanding debt.">
                  <span className="text-gray-600 text-sm font-medium">Health Factor</span>
                </InfoTooltip>
                <span className="font-semibold text-lg" style={{ color: getTextColor((loanData?.healthFactor)) }}>
                  {(() => {
                    // Check if there's no outstanding debt
                    const totalAmountOwed = loanData?.totalAmountOwed ? parseFloat(formatUnits(loanData.totalAmountOwed.toString(), 18)) : 0;
                    if (totalAmountOwed === 0) {
                      return "No Loan";
                    }
                    // Check if health factor is valid
                    if (loanData?.healthFactor && !isNaN((loanData.healthFactor))) {
                      return (loanData.healthFactor).toFixed(2);
                    }
                    return "N/A";
                  })()}
                </span>
              </div>
              <div className="flex flex-col space-y-3 p-4 bg-gray-50 rounded-lg">
                <InfoTooltip content="You need to supply tokens as collateral before you can borrow. Click 'Supply' in the Eligible Collateral table below to get started.">
                  <span className="text-gray-600 text-sm font-medium">Available Borrowing Power</span>
                </InfoTooltip>
                <span className="font-semibold text-lg">
                  {formatBalance(loanData?.maxAvailableToBorrowUSD || 0n, "USDST", 18, 2, 2)}
                </span>
              </div>
              <div className="flex flex-col space-y-3 p-4 bg-gray-50 rounded-lg">
                <InfoTooltip content="Accumulated interest on your borrowed amount. This increases over time and should be repaid along with your principal.">
                  <span className="text-gray-600 text-sm font-medium">Interest Owed</span>
                </InfoTooltip>
                <span className="font-semibold text-lg">
                  {formatBalance(loanData?.accruedInterest || 0n, "USDST", 18, 2, 2)}
                </span>
              </div>
              <div className="flex flex-col space-y-3 p-4 bg-gray-50 rounded-lg">
                <InfoTooltip content="Annual percentage rate you pay on borrowed amounts. This rate applies to your total borrowed amount.">
                  <span className="text-gray-600 text-sm font-medium">Interest Rate</span>
                </InfoTooltip>
                <span className="font-semibold text-lg">{loanData?.interestRate || 0}%</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PositionSection;

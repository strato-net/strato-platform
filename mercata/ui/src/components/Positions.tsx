import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import { CollateralData, NewLoanData } from "@/interface";
import { formatUnits } from "ethers";
import { formatBalance } from "@/utils/numberUtils";

interface BorrowingSectionProps {
  userCollaterals: CollateralData[];
  loanData: NewLoanData;
  handleBorrow: () => void;
  handleRepay: () => void;
}

// Reusable InfoTooltip component
const InfoTooltip = ({ children, content }: { children: React.ReactNode; content: string }) => (
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

const PositionSection = ({ userCollaterals, loanData, handleBorrow, handleRepay }: BorrowingSectionProps) => {

  function getTextColor(value: number, maxValue = 10) {
  const clamped = Math.min(Math.max(value, 1), maxValue);
  const ratio = (clamped - 1) / (maxValue - 1);

  const red = Math.round(255 * (1 - ratio));
  const green = Math.round(255 * ratio);

  return `rgb(${red}, ${green}, 0)`;
}
  
  return (
    <Card className="border border-gray-100 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-2xl font-bold">Your Position</CardTitle>
        </div>
        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={handleBorrow} className="flex items-center gap-2">
                Borrow
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Borrow USDST against your supplied collateral. You'll need to supply tokens first to enable borrowing.</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={handleRepay} className="flex items-center gap-2">
                Repay
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Repay your borrowed USDST to reduce debt and improve your position's health factor.</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent>
        <div className="py-4">
          <div className="space-y-6">

            {/* Added extra spacing with mt-8 to separate indicators from data */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-x-8 gap-y-6 mt-8">
              <div className="flex flex-col">
                <span className="text-gray-600">Total Borrowed</span>
                <span className="font-semibold">
                  {formatBalance(loanData?.totalAmountOwed || 0n, "USDST", 18, 2, 2)}
                </span>
              </div>
              <div className="flex flex-col">
                <InfoTooltip content="Measures your position's safety. Higher is better. Below 1.0 means risk of liquidation. No loan means you have no outstanding debt.">
                  <span className="text-gray-600">Health Factor</span>
                </InfoTooltip>
                <span className="font-semibold text-green-500" style={{ color: getTextColor((loanData?.healthFactor)) }}>
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
              <div className="flex flex-col">
                <InfoTooltip content="You need to supply tokens as collateral before you can borrow. Click 'Supply' in the Eligible Collateral table below to get started.">
                  <span className="text-gray-600">Available Borrowing Power</span>
                </InfoTooltip>
                <span className="font-semibold">
                  {formatBalance(loanData?.maxAvailableToBorrowUSD || 0n, "USDST", 18, 2, 2)}
                </span>
              </div>
              <div className="flex flex-col">
                <InfoTooltip content="Accumulated interest on your borrowed amount. This increases over time and should be repaid along with your principal.">
                  <span className="text-gray-600">Interest Owed</span>
                </InfoTooltip>
                <span className="font-semibold">
                  {formatBalance(loanData?.accruedInterest || 0n, "USDST", 18, 2, 2)}
                </span>
              </div>
              <div className="flex flex-col">
                <InfoTooltip content="Annual percentage rate you pay on borrowed amounts. This rate applies to your total borrowed amount.">
                  <span className="text-gray-600">Interest Rate</span>
                </InfoTooltip>
                <span className="font-semibold">{loanData?.interestRate || 0}%</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PositionSection;

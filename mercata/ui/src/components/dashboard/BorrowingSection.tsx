import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { formatUnits } from "ethers";
import { NewLoanData } from "@/interface";
import RiskLevelProgress from "@/components/ui/RiskLevelProgress";

interface BorrowingSectionProps {
  loanData?: NewLoanData;
}

const BorrowingSection = ({ loanData }: BorrowingSectionProps) => {
  const navigate = useNavigate()

  function getTextColor(value: number, maxValue = 10) {
    const clamped = Math.min(Math.max(value, 1), maxValue);
    const ratio = (clamped - 1) / (maxValue - 1);

    const red = Math.round(255 * (1 - ratio));
    const green = Math.round(255 * ratio);

    return `rgb(${red}, ${green}, 0)`;
  }

  // Calculate available borrowing power from loanData
  const availableBorrowingPower = loanData?.maxAvailableToBorrowUSD 
    ? parseFloat(formatUnits(loanData.maxAvailableToBorrowUSD, 18))
    : 0;

  // Calculate current borrowed amount
  const currentBorrowed = loanData?.totalAmountOwed 
    ? parseFloat(formatUnits(loanData.totalAmountOwed.toString(), 18))
    : 0;

  // Calculate risk level using the same logic as other components
  const calculateRiskLevel = () => {
    try {
      if (!loanData?.totalCollateralValueUSD || !loanData?.totalAmountOwed) {
        return 0;
      }

      const totalBorrowedBigInt = BigInt(loanData.totalAmountOwed);
      const collateralValueBigInt = BigInt(loanData.totalCollateralValueUSD);

      if (collateralValueBigInt === 0n) {
        return 0;
      }

      const risk = Number((totalBorrowedBigInt * 10000n) / collateralValueBigInt) / 100;
      return Math.min(risk, 100);
    } catch {
      return 0;
    }
  };

  const riskLevel = calculateRiskLevel();

  return (
    <Card className="border border-gray-100 shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-2 space-y-2 sm:space-y-0">
        <div>
          <CardTitle className="text-xl font-bold">My Borrowing</CardTitle>
          <CardDescription className="text-gray-500">Leverage your assets with secured loans</CardDescription>
        </div>
        <div className="hidden sm:block">
          <Button onClick={()=> navigate('/dashboard/borrow')} className="flex items-center gap-2">
            <ArrowUpRight size={16} /> Start Borrowing
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="py-4">
          <div className="space-y-6">
            {/* Risk Level Progress Bar */}
            <RiskLevelProgress riskLevel={riskLevel} />

            {/* Added extra spacing with mt-8 to separate indicators from data */}
            <div className="flex flex-col gap-2 mt-8">
              <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0">
                <span className="text-gray-600 text-sm sm:text-base">Available Borrowing Power</span>
                <span className="font-semibold text-sm sm:text-base">
                  {availableBorrowingPower.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} USDST
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0">
                <span className="text-gray-600 text-sm sm:text-base">Total Amount Owed</span>
                <span className="font-semibold text-sm sm:text-base">
                  {currentBorrowed.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} USDST
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0">
                <span className="text-gray-600 text-sm sm:text-base">Interest Rate</span>
                <span className="font-semibold text-sm sm:text-base">{loanData?.interestRate || 0}%</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0">
                <span className="text-gray-600 text-sm sm:text-base">Interest Owed</span>
                <span className="font-semibold text-sm sm:text-base">
                  {parseFloat(formatUnits(loanData?.accruedInterest || 0, 18)).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} USDST
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0">
                <span className="text-gray-600 text-sm sm:text-base">Health Factor</span>
                <span className="font-semibold text-sm sm:text-base" style={{ color: getTextColor((loanData?.healthFactor || 0)) }}>
                  {(() => {
                    // Check if there's no outstanding debt
                    if (currentBorrowed === 0) {
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
            </div>
            
            {/* Mobile Button */}
            <div className="sm:hidden mt-6">
              <Button onClick={()=> navigate('/dashboard/borrow')} className="flex items-center justify-center gap-2 w-full">
                <ArrowUpRight size={16} /> Start Borrowing
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BorrowingSection;

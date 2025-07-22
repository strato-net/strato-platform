import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { formatUnits } from "ethers";
import { NewLoanData } from "@/interface";

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

  // Calculate LTV ratio for risk assessment
  let ltvRatio = availableBorrowingPower > 0 ? currentBorrowed / availableBorrowingPower : 0;
  if(availableBorrowingPower === 0 && currentBorrowed > 0){
    ltvRatio = 1;
  }else if(availableBorrowingPower === 0 && currentBorrowed === 0){
    ltvRatio = 0;
  }

  const riskPercentage = Math.min(ltvRatio * 100, 100); // cap at 100%

  // Risk level mapping
  let riskLevel = 'Low';
  let riskColor = '#22c55e'; // green
  let badgeColor = 'bg-green-50 text-green-600';

  if (ltvRatio >= 0.3 && ltvRatio < 0.6) {
    riskLevel = 'Moderate';
    riskColor = '#facc15'; // yellow
    badgeColor = 'bg-yellow-50 text-yellow-600';
  } else if (ltvRatio >= 0.6) {
    riskLevel = 'High';
    riskColor = '#ef4444'; // red
    badgeColor = 'bg-red-50 text-red-600';
  }

  // Assume liquidation threshold is at 80%
  const liquidationThreshold = 80;

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
            {/* Bar graph now appears first */}
            <div className="mb-2">
              {/* Dynamic risk bar */}
              <div className="w-[97%] bg-gray-200 rounded-full h-2 relative mb-3">
                <div className="h-2 rounded-full" style={{ width: `${riskPercentage}%`, backgroundColor: riskColor,}}></div>

                {/* Collateral Value Marker */}
                <div className="absolute right-0 top-0 flex flex-col items-center" style={{ transform: 'translateX(50%)' }}>
                  <div className="h-4 w-0.5 bg-blue-500"></div>
                  <div className="mt-1 text-xs text-blue-600 whitespace-nowrap hidden sm:block">Collateral Value</div>
                  <div className="mt-1 text-xs text-blue-600 whitespace-nowrap sm:hidden">Collateral</div>
                </div>

                {/* Liquidation Marker */}
                <div className="absolute top-0 flex flex-col items-center" style={{ left: `${liquidationThreshold}%`, transform: 'translateX(-50%)' }}>
                  <div className="h-4 w-0.5 bg-red-500"></div>
                  <div className="mt-1 text-xs text-red-600 whitespace-nowrap">Liquidation</div>
                </div>
              </div>

              {/* Risk Level Label */}
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-3 space-y-2 sm:space-y-0">
                <div className="flex items-center">
                  <span className="text-gray-600 mr-2 text-sm sm:text-base">Risk Level:</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}>
                    {riskLevel}
                  </span>
                </div>
              </div>
            </div>

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
                <span className="text-gray-600 text-sm sm:text-base">Current Borrowed</span>
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

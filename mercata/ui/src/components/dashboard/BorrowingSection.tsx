import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";

interface BorrowingSectionProps {
  availableBorrowingPower?: string;
  currentBorrowed?: string;
  averageInterestRate?: string;
}

const BorrowingSection = ({ 
  availableBorrowingPower = "$0.00", 
  currentBorrowed = "$0.00", 
  averageInterestRate = "0.00%" 
}: BorrowingSectionProps) => {
  const navigate = useNavigate()

  const ltvRatio = parseFloat(availableBorrowingPower.split('$')[1].replace(/,/g, '')) > 0 ? parseFloat(currentBorrowed.split('$')[1].replace(/,/g, '')) / parseFloat(availableBorrowingPower.split('$')[1].replace(/,/g, '')) : 0;
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
              <div className="w-full sm:w-4/5 mx-auto bg-gray-200 rounded-full h-2 relative mb-3">
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
                {/* Removed the percentage display that was here */}
              </div>
            </div>

            {/* Added extra spacing with mt-8 to separate indicators from data */}
            <div className="flex flex-col gap-1 mt-8">
              <div className="flex flex-col sm:flex-row sm:justify-between">
                <span className="text-gray-600 text-sm sm:text-base">Available Borrowing Power</span>
                <span className="font-semibold text-sm sm:text-base">{availableBorrowingPower}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between">
                <span className="text-gray-600 text-sm sm:text-base">Current Borrowed</span>
                <span className="font-semibold text-sm sm:text-base">{currentBorrowed}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between">
                <span className="text-gray-600 text-sm sm:text-base">Interest Rate</span>
                <span className="font-semibold text-sm sm:text-base">{averageInterestRate}</span>
              </div>
            </div>
            
            {/* Mobile Button */}
            <div className="sm:hidden mt-6">
              <Button onClick={()=> navigate('/dashboard/borrow')} className="flex items-center gap-2 w-full">
                <ArrowUpRight size={16} /> Borrow
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BorrowingSection;

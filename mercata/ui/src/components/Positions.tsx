import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewLoanData } from "@/interface";
import { formatUnits } from "ethers";

interface BorrowingSectionProps {
  loanData: NewLoanData;
  handleBorrow: () => void;
  handleRepay: () => void;
}

const PositionSection = ({ loanData, handleBorrow, handleRepay }: BorrowingSectionProps) => {

  function getTextColor(value: number, maxValue = 10) {
  const clamped = Math.min(Math.max(value, 1), maxValue);
  const ratio = (clamped - 1) / (maxValue - 1);

  const red = Math.round(255 * (1 - ratio));
  const green = Math.round(255 * ratio);

  return `rgb(${red}, ${green}, 0)`;
}

  // Use the available borrowing power from loanData (which is calculated correctly in backend)
  const availableBorrowingPower = loanData?.maxAvailableToBorrowUSD 
    ? parseFloat(formatUnits(loanData.maxAvailableToBorrowUSD, 18))
    : 0;
  
  return (
    <Card className="border border-gray-100 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-2xl font-bold">Your Position</CardTitle>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleBorrow} className="flex items-center gap-2">
            Borrow
          </Button>
          <Button onClick={handleRepay} className="flex items-center gap-2">
            Repay
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="py-4">
          <div className="space-y-6">

            {/* Added extra spacing with mt-8 to separate indicators from data */}
            <div className="flex justify-between mt-8">
              <div className="flex flex-col">
                <span className="text-gray-600">Total Borrowed</span>
                <span className="font-semibold">
                  {loanData?.totalAmountOwed != null
                    ? `${parseFloat(formatUnits(loanData.totalAmountOwed.toString(), 18)).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })} USDST`
                    : "0 USDST"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-gray-600">Health Factor</span>
                <span className="font-semibold text-green-500" style={{ color: getTextColor(parseFloat(loanData?.healthFactor.toString())) }}>
                  {(() => {
                    // Check if there's no outstanding debt
                    const totalAmountOwed = loanData?.totalAmountOwed ? parseFloat(formatUnits(loanData.totalAmountOwed.toString(), 18)) : 0;
                    if (totalAmountOwed === 0) {
                      return "No Loan";
                    }
                    // Check if health factor is valid
                    if (loanData?.healthFactor && !isNaN(parseFloat(loanData.healthFactor.toString()))) {
                      return parseFloat(loanData.healthFactor.toString()).toFixed(2);
                    }
                    return "N/A";
                  })()}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-gray-600">Available Borrowing Power</span>
                <span className="font-semibold">
                  {availableBorrowingPower.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} USDST
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-gray-600">Interest Owed</span>
                <span className="font-semibold">
                  {parseFloat(formatUnits(loanData?.accruedInterest || 0, 18)).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} USDST
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-gray-600">Interest Rate</span>
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

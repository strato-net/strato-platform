import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { formatUnits } from "ethers";
import { NewLoanData } from "@/interface";
import RiskLevelProgress from "@/components/ui/RiskLevelProgress";
import { getTextColor } from "@/utils/lendingUtils";

interface BorrowingSectionProps {
  loanData?: NewLoanData;
  guestMode?: boolean;
}

const BorrowingSection = ({ loanData, guestMode = false }: BorrowingSectionProps) => {
  const navigate = useNavigate()

  // Calculate available borrowing power from loanData
  const availableBorrowingPower = loanData?.maxAvailableToBorrowUSD 
    ? parseFloat(formatUnits(loanData.maxAvailableToBorrowUSD, 18))
    : 0;

  // Calculate current borrowed amount
  const currentBorrowed = loanData?.totalAmountOwed 
    ? parseFloat(formatUnits((() => { try { return (BigInt(loanData.totalAmountOwed) <= 1n ? 0n : BigInt(loanData.totalAmountOwed)); } catch { return 0n; } })(), 18))
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
    <Card className="border border-border shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-2 space-y-4 sm:space-y-0">
        <div>
          <CardTitle className="text-xl font-bold">My Borrowing</CardTitle>
          <CardDescription className="text-muted-foreground">Leverage your assets with secured loans</CardDescription>
        </div>
        {/* Mobile: full width button */}
        <Button 
          onClick={() => navigate('/dashboard/borrow')} 
          className="w-full sm:hidden flex items-center justify-center gap-2"
        >
          <Plus size={16} /> Borrow
        </Button>
        {/* Desktop: small button */}
        <Button 
          onClick={() => navigate('/dashboard/borrow')} 
          className="hidden sm:flex items-center gap-2"
        >
          <Plus size={16} /> Borrow
        </Button>
      </CardHeader>
      <CardContent>
        <div className="py-4">
          <div className="space-y-6">
            {/* Risk Level Progress Bar */}
            <RiskLevelProgress riskLevel={riskLevel} />

            {/* Added extra spacing with mt-8 to separate indicators from data */}
            <div className="flex flex-col gap-2 mt-8">
              <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0">
                <span className="text-muted-foreground text-sm sm:text-base">Available Borrowing Power</span>
                <span className="font-semibold text-sm sm:text-base">
                  {guestMode ? "-" : `${availableBorrowingPower.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} USDST`}
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0">
                <span className="text-muted-foreground text-sm sm:text-base">Total Amount Owed</span>
                <span className="font-semibold text-sm sm:text-base">
                  {guestMode ? "-" : `${currentBorrowed.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} USDST`}
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0">
                <span className="text-muted-foreground text-sm sm:text-base">Interest Rate</span>
                <span className="font-semibold text-sm sm:text-base">
                  {guestMode ? "-" : `${((Number(loanData?.interestRate) || 0) / 100).toFixed(2)}%`}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0">
                <span className="text-muted-foreground text-sm sm:text-base">Health Factor</span>
                <span className="font-semibold text-sm sm:text-base" style={{ color: guestMode ? undefined : getTextColor((loanData?.healthFactor || 0), 3, currentBorrowed === 0) }}>
                  {guestMode ? "-" : (() => {
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
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BorrowingSection;

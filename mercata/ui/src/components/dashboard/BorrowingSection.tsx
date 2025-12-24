import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { formatUnits } from "ethers";
import { NewLoanData } from "@/interface";

interface BorrowingSectionProps {
  loanData?: NewLoanData;
}

const BorrowingSection = ({ loanData }: BorrowingSectionProps) => {
  const navigate = useNavigate();

  const getHealthFactorColor = (value: number) => {
    if (value >= 3) return 'text-green-500';
    if (value >= 1.5) return 'text-orange-500';
    return 'text-red-500';
  };

  const getRiskBadge = (riskLevel: number) => {
    if (riskLevel < 30) return { label: 'Low', color: 'bg-green-50 text-green-600 border-green-200' };
    if (riskLevel < 60) return { label: 'Medium', color: 'bg-yellow-50 text-yellow-600 border-yellow-200' };
    return { label: 'High', color: 'bg-red-50 text-red-600 border-red-200' };
  };

  const availableBorrowingPower = loanData?.maxAvailableToBorrowUSD 
    ? parseFloat(formatUnits(loanData.maxAvailableToBorrowUSD, 18))
    : 0;

  const currentBorrowed = loanData?.totalAmountOwed 
    ? parseFloat(formatUnits((() => { try { return (BigInt(loanData.totalAmountOwed) <= 1n ? 0n : BigInt(loanData.totalAmountOwed)); } catch { return 0n; } })(), 18))
    : 0;

  const calculateRiskLevel = () => {
    try {
      if (!loanData?.totalCollateralValueUSD || !loanData?.totalAmountOwed) return 0;
      const totalBorrowedBigInt = BigInt(loanData.totalAmountOwed);
      const collateralValueBigInt = BigInt(loanData.totalCollateralValueUSD);
      if (collateralValueBigInt === 0n) return 0;
      const risk = Number((totalBorrowedBigInt * 10000n) / collateralValueBigInt) / 100;
      return Math.min(risk, 100);
    } catch {
      return 0;
    }
  };

  const riskLevel = calculateRiskLevel();
  const riskBadge = getRiskBadge(riskLevel);

  return (
    <Card className="bg-card border border-border shadow-sm rounded-xl p-4 md:p-6">
      {/* Header - Different layout for mobile vs desktop */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between mb-4 md:mb-6">
        <h2 className="text-xl font-bold mb-3 md:mb-0">My Borrowing</h2>
        
        {/* Mobile: Full-width button below title */}
        <Button 
          onClick={() => navigate('/dashboard/borrow')} 
          className="w-full md:w-auto bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 mb-3 md:mb-0"
        >
          <Plus size={16} /> Borrow
        </Button>
      </div>
      
      {/* Subtitle - Shows after button on mobile */}
      <p className="text-sm text-muted-foreground mb-4 md:hidden">Leverage your assets with secured loans</p>

      <CardContent className="p-0 space-y-5">
        {/* Desktop subtitle */}
        <p className="text-sm text-muted-foreground hidden md:block -mt-4">Leverage your assets with secured loans</p>
        
        {/* Risk Level Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Risk Level:</span>
            <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full border ${riskBadge.color}`}>
              {riskBadge.label}
            </span>
          </div>
          
          <div className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="absolute left-0 top-0 h-full bg-primary rounded-full transition-all"
              style={{ width: `${Math.max(riskLevel, 2)}%` }}
            />
          </div>
          
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="text-primary font-medium">Safe</span>
            <span>Risk Increases →</span>
            <span>Liquidation</span>
          </div>
        </div>

        {/* Stats - Single column on mobile, 2x2 grid on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-x-8 md:gap-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Available Borrowing Power</p>
            <p className="text-lg font-bold">
              {availableBorrowingPower.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDST
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Total Amount Owed</p>
            <p className="text-lg font-bold">
              {currentBorrowed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDST
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Interest Rate</p>
            <p className="text-lg font-bold">{((Number(loanData?.interestRate) || 0) / 100).toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Health Factor</p>
            <p className={`text-lg font-bold ${currentBorrowed === 0 ? 'text-foreground' : getHealthFactorColor(loanData?.healthFactor || 0)}`}>
              {currentBorrowed === 0 ? "No Loan" : (loanData?.healthFactor?.toFixed(2) || "N/A")}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BorrowingSection;

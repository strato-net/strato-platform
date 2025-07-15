import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";

interface PercentageButtonsProps {
  currentAmount: string;
  maxAmount: string;
  onPercentageClick: (amount: string) => void;
  className?: string;
}

const PercentageButtons: React.FC<PercentageButtonsProps> = ({
  currentAmount,
  maxAmount,
  onPercentageClick,
  className = ""
}) => {
  // Calculate percentage amounts with proper precision handling
  const percentageAmounts = useMemo(() => {
    const cleanMaxAmount = parseFloat(maxAmount.replace(/,/g, ""));
    if (isNaN(cleanMaxAmount) || cleanMaxAmount <= 0) {
      return {
        ten: "0",
        quarter: "0", 
        half: "0",
        full: "0"
      };
    }

    // Preserve the original precision by counting decimal places
    const decimalPlaces = (maxAmount.toString().split('.')[1] || '').length;
    const precision = Math.max(decimalPlaces, 2); // At least 2 decimal places

    return {
      ten: (cleanMaxAmount * 0.1).toFixed(precision),
      quarter: (cleanMaxAmount * 0.25).toFixed(precision),
      half: (cleanMaxAmount * 0.5).toFixed(precision),
      full: cleanMaxAmount.toFixed(precision)
    };
  }, [maxAmount]);

  // Helper function to check if current amount matches a percentage
  const getButtonVariant = (expectedAmount: string) => {
    if (!currentAmount || !expectedAmount) return "outline";
    
    // Compare with proper precision handling
    const current = parseFloat(currentAmount);
    const expected = parseFloat(expectedAmount);
    
    // Use a smaller tolerance for higher precision amounts
    const tolerance = Math.max(0.000001, Math.pow(10, -(maxAmount.toString().split('.')[1] || '').length));
    return Math.abs(current - expected) < tolerance ? "default" : "outline";
  };

  // Helper function to handle button clicks with toggle behavior
  const handlePercentageClick = (expectedAmount: string) => {
    const current = parseFloat(currentAmount || "0");
    const expected = parseFloat(expectedAmount);
    
    // Use a smaller tolerance for higher precision amounts
    const tolerance = Math.max(0.000001, Math.pow(10, -(maxAmount.toString().split('.')[1] || '').length));
    const isCurrentlySelected = Math.abs(current - expected) < tolerance;
    
    // If already selected, deselect (set to 0), otherwise select the amount
    const newAmount = isCurrentlySelected ? "0" : expectedAmount;
    onPercentageClick(newAmount);
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      <Button
        variant={getButtonVariant(percentageAmounts.ten)}
        size="sm"
        onClick={() => handlePercentageClick(percentageAmounts.ten)}
        className="flex-1"
      >
        10%
      </Button>
      <Button
        variant={getButtonVariant(percentageAmounts.quarter)}
        size="sm"
        onClick={() => handlePercentageClick(percentageAmounts.quarter)}
        className="flex-1"
      >
        25%
      </Button>
      <Button
        variant={getButtonVariant(percentageAmounts.half)}
        size="sm"
        onClick={() => handlePercentageClick(percentageAmounts.half)}
        className="flex-1"
      >
        50%
      </Button>
      <Button
        variant={getButtonVariant(percentageAmounts.full)}
        size="sm"
        onClick={() => handlePercentageClick(percentageAmounts.full)}
        className="flex-1"
      >
        100%
      </Button>
    </div>
  );
};

export default PercentageButtons; 
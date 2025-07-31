// Reusable PercentageButtons component for consistent percentage selection across modals
import React, { useMemo } from "react";
import { Button } from "./button";
import { safeParseUnits } from "@/utils/numberUtils";
import { formatUnits } from "ethers";

interface PercentageButtonsProps {
  value: string;
  maxValue: string;
  onChange: (value: string) => void;
  percentages?: number[];
  className?: string;
}

const PercentageButtons: React.FC<PercentageButtonsProps> = ({
  value,
  maxValue,
  onChange,
  percentages = [0.25, 0.5, 0.75, 1],
  className = ""
}) => {
  const maxValueBigInt = useMemo(() => BigInt(maxValue || "0"), [maxValue]);
  const valueBigInt = useMemo(() => safeParseUnits(value || "0", 18), [value]);

  const calculatePercentage = (value: bigint, percent: number): bigint => {
    const result = (value * BigInt(Math.round(percent * 10000))) / 10000n;
    return result;
  };

  const handlePercentageClick = (percent: number) => {
    const percentValueBigInt = calculatePercentage(maxValueBigInt, percent);

    // Toggle behavior: if clicking the same percentage, deselect it
    if (valueBigInt === percentValueBigInt) {
      onChange(""); // Clear the value when deselecting
    } else {
      onChange(formatUnits(percentValueBigInt, 18));
    }
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      {percentages.map((percent) => {
        const percentValue = calculatePercentage(maxValueBigInt, percent);
        const isActive = valueBigInt === percentValue;
        const isDisabled = maxValueBigInt <= 0n;

        return (
          <Button
            key={percent}
            variant={isActive ? "default" : "outline"}
            size="sm"
            onClick={() => handlePercentageClick(percent)}
            disabled={isDisabled}
            className={`flex-1 transition-all duration-200 ${!isDisabled ? "hover:scale-105" : ""}`}
            title={isDisabled ? "No amount available" : `Set to ${percent * 100}% of available`}
          >
            {Math.round(percent * 100)}%
          </Button>
        );
      })}
    </div>
  );
};

export default PercentageButtons;
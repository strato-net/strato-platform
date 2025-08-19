// Reusable PercentageButtons component for consistent percentage selection across modals
import React, { useMemo } from "react";
import { Button } from "./button";
import { safeParseUnits } from "@/utils/numberUtils";
import { formatUnits, parseUnits } from "ethers";

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
  const maxValueBigInt = useMemo(() => {
    const s = String(maxValue || "0").replace(/,/g, "").trim();
    if (!s) return 0n;
    // If decimal string, parse to 18d units; otherwise treat as wei bigint
    if (s.includes(".")) {
      try { return parseUnits(s, 18); } catch { return 0n; }
    }
    try { return BigInt(s); } catch { return 0n; }
  }, [maxValue]);

  const valueBigInt = useMemo(() => safeParseUnits(value || "0", 18), [value]);

  const calculatePercentage = (value: bigint, percent: number): bigint => {
    const scaled = BigInt(Math.round(percent * 10000));
    return (value * scaled) / 10000n;
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

  const percentageValues = useMemo(() => {
    return percentages.map((percent) => ({
      percent,
      percentValue: calculatePercentage(maxValueBigInt, percent),
    }));
  }, [percentages, maxValueBigInt]);

  const isDisabled = maxValueBigInt <= 0n;
  
  return (
    <div className={`flex gap-2 ${className}`}>
      {percentageValues.map(({percent, percentValue}) => {
        const isActive = valueBigInt === percentValue;

        return (
          <Button
            key={percent}
            variant={isActive ? "default" : "outline"}
            size="sm"
            onClick={() => handlePercentageClick(percent)}
            className={`flex-1 transition-all duration-200 ${!isDisabled ? "hover:scale-105" : ""}`}
            disabled={isDisabled}
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
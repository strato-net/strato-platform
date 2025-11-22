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
  decimals?: number;
  disabled?: boolean;
}

const PercentageButtons: React.FC<PercentageButtonsProps> = ({
  value,
  maxValue,
  onChange,
  percentages = [0.25, 0.5, 0.75, 1],
  className = "",
  decimals = 18,
  disabled = false,
}) => {
  const maxValueBigInt = useMemo(() => {
    const s = String(maxValue || "0").replace(/,/g, "").trim();
    if (!s) return 0n;
    // If decimal string, parse to 18d units; otherwise treat as wei bigint
    if (s.includes(".")) {
      try { return parseUnits(s, decimals); } catch { return 0n; }
    }
    try { return BigInt(s); } catch { return 0n; }
  }, [maxValue]);

  const valueBigInt = useMemo(
    () => safeParseUnits(value || "0", decimals),
    [value, decimals],
  );

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
      onChange(formatUnits(percentValueBigInt, decimals));
    }
  };

  const percentageValues = useMemo(() => {
    return percentages.map((percent) => ({
      percent,
      percentValue: calculatePercentage(maxValueBigInt, percent),
    }));
  }, [percentages, maxValueBigInt]);

  return (
    <div className={`flex gap-2 ${className}`}>
      {percentageValues.map(({ percent, percentValue }) => {
        const is100Percent = percent === 1;
        const isZeroAmount = maxValueBigInt <= 0n;
        const isSmallAmount = disabled && maxValueBigInt > 0n && !isZeroAmount; // Only when explicitly disabled due to small amount
        
        // Disable all buttons if no amount available, disabled (loading), or small amount (except 100%)
        const shouldDisable = isZeroAmount || disabled || (isSmallAmount && !is100Percent);
        
        // Only consider active if not disabled
        const isActive = !shouldDisable && valueBigInt === percentValue;

        return (
          <Button
            key={percent}
            variant={isActive ? "default" : "outline"}
            size="sm"
            onClick={() => handlePercentageClick(percent)}
            className={`flex-1 transition-all duration-200 ${!shouldDisable ? "hover:scale-105" : ""}`}
            disabled={shouldDisable}
            title={
              shouldDisable
                ? isZeroAmount
                  ? "No amount available"
                  : "Amount too small for percentage selection"
                : `Set to ${percent * 100}% of available`
            }
          >
            {Math.round(percent * 100)}%
          </Button>
        );
      })}
    </div>
  );
};

export default PercentageButtons;

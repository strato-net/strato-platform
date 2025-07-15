// Reusable PercentageButtons component for consistent percentage selection across modals
import React from "react";
import { Button } from "./button";

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
  // Helper function to calculate percentage with proper precision
  const calculatePercentage = (maxValue: string, percent: number): string => {
    const max = parseFloat(maxValue);
    if (isNaN(max) || max === 0) return "0";
    
    // For 100%, return the exact maxValue
    if (percent === 1) {
      return maxValue;
    }
    
    // For other percentages, calculate with proper precision
    const result = max * percent;
    // Convert to string with full precision
    return result.toString();
  };

  const handlePercentageClick = (percent: number) => {
    const percentValue = calculatePercentage(maxValue, percent);
    
    // Toggle behavior: if clicking the same percentage, deselect it
    if (value === percentValue) {
      onChange(""); // Clear the value when deselecting
    } else {
      onChange(percentValue); // Set the new value when selecting
    }
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      {percentages.map((percent) => {
        const percentValue = calculatePercentage(maxValue, percent);
        const isActive = value === percentValue;
        
        return (
          <Button
            key={percent}
            variant={isActive ? "default" : "outline"}
            size="sm"
            onClick={() => handlePercentageClick(percent)}
            className="flex-1 transition-all duration-200 hover:scale-105"
          >
            {percent * 100}%
          </Button>
        );
      })}
    </div>
  );
};

export default PercentageButtons; 
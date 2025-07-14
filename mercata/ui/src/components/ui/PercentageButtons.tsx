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
  const handlePercentageClick = (percent: number) => {
    const amount = (parseFloat(maxValue) * percent).toString();
    onChange(amount);
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      {percentages.map((percent) => {
        const percentValue = (parseFloat(maxValue) * percent).toString();
        const isActive = value === percentValue;
        
        return (
          <Button
            key={percent}
            variant={isActive ? "default" : "outline"}
            size="sm"
            onClick={() => handlePercentageClick(percent)}
            className="flex-1"
          >
            {percent * 100}%
          </Button>
        );
      })}
    </div>
  );
};

export default PercentageButtons; 
import React from "react";
import { Slider } from "@/components/ui/slider";

interface CRSliderProps {
  projectedCR: number;
  liquidationThreshold: number;
  onCRChange: (cr: number) => void;
  disabled?: boolean;
}

const CRSlider: React.FC<CRSliderProps> = ({
  projectedCR,
  liquidationThreshold,
  onCRChange,
  disabled = false
}) => {
  const sliderMin = liquidationThreshold;
  const sliderMax = 750;
  
  // Determine if CR is out of slider range
  const isOutOfBounds = projectedCR < sliderMin || projectedCR > sliderMax;
  const isSliderDisabled = disabled || projectedCR <= 0;
  
  // Format percentage for display
  const formatPercentage = (num: number, decimals: number = 0): string => {
    if (isNaN(num)) return '0%';
    return num.toFixed(decimals) + '%';
  };
  
  // Handle slider value change
  const handleSliderChange = (values: number[]) => {
    const newCR = values[0];
    onCRChange(newCR);
  };
  
  // Handle slider click when out of bounds
  const handleSliderClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isSliderDisabled) return;
    
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const sliderWidth = rect.width;
    
    // Calculate percentage of click position (0 to 1)
    const clickPercentage = Math.max(0, Math.min(1, clickX / sliderWidth));
    
    // Convert to CR value within slider range
    const newCR = sliderMin + (clickPercentage * (sliderMax - sliderMin));
    
    onCRChange(Math.round(newCR));
  };
  
  // Determine slider value and visibility
  const isInBounds = projectedCR >= sliderMin && projectedCR <= sliderMax;
  const displayValue = isInBounds ? projectedCR : sliderMin; // Default position when out of bounds
  const isPositionDangerous = projectedCR > 0 && projectedCR < liquidationThreshold;
  
  return (
    <div className="space-y-3">
      {/* CR Display */}
      <div className="flex justify-between items-center text-sm font-medium">
        <span>Collateralization Ratio (CR)</span>
        <span className={isPositionDangerous ? 'text-red-500 font-bold' : ''}>
          {projectedCR > 0 ? formatPercentage(projectedCR, 1) : '0.0%'}
        </span>
      </div>
      
      {/* Slider Container with Click Handler */}
      <div 
        className="relative w-full"
        onClick={handleSliderClick}
        style={{ cursor: isSliderDisabled ? 'not-allowed' : 'pointer' }}
      >
        <Slider 
          value={isInBounds ? [displayValue] : []} // Empty array hides the knob when out of bounds
          max={sliderMax} 
          min={sliderMin}
          step={1} 
          onValueChange={handleSliderChange}
          disabled={isSliderDisabled}
          className="w-full"
        />
        
        {/* Custom track styling when out of bounds */}
        {isOutOfBounds && !isSliderDisabled && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="w-full h-2 bg-gray-200 rounded-full mt-2"></div>
          </div>
        )}
      </div>
      
      {/* Slider Labels */}
      <div className="flex justify-between text-xs text-gray-500">
        <span className="text-red-500">LT: {formatPercentage(liquidationThreshold)}</span>
        <span>{formatPercentage(sliderMax)}</span>
      </div>
      
      {/* Status message */}
      {isOutOfBounds && !isSliderDisabled && (
        <div className="text-center text-sm text-blue-600">
          {projectedCR < sliderMin 
            ? `CR below liquidation threshold (${formatPercentage(sliderMin)}) - Click slider to set new CR`
            : projectedCR > sliderMax 
              ? `CR above range - Click slider to set new CR`
              : ""
          }
        </div>
      )}
      
      {isSliderDisabled && (
        <div className="text-center text-sm text-gray-500">
          Slider disabled
        </div>
      )}
    </div>
  );
};

export default CRSlider;

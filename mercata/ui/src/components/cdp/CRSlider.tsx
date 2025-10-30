import React from "react";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface CRSliderProps {
  projectedCR: number;
  minCR: number; // Min collateral ratio for user actions
  onCRChange: (cr: number) => void;
  disabled?: boolean;
  hasCollateral?: boolean; // Whether there's existing collateral or deposit input
  collateralValueUSD?: number; // Total collateral value in USD for tooltip
  totalDebtUSD?: number; // Total debt value in USD for tooltip
}

const CRSlider: React.FC<CRSliderProps> = ({
  projectedCR,
  minCR,
  onCRChange,
  disabled = false,
  hasCollateral = false,
  collateralValueUSD = 0,
  totalDebtUSD = 0
}) => {
  const sliderMin = Math.round(minCR); // Use minCR as slider minimum (ensure whole number)
  const sliderMax = 750;
  
  // Determine if CR is out of slider range
  const isInfinite = projectedCR >= 999999;
  const isOutOfBounds = projectedCR < sliderMin || projectedCR > sliderMax;
  
  // Enable slider if there's collateral (existing or being deposited), even with no debt
  const shouldEnableForCollateral = hasCollateral && isInfinite;
  const isSliderDisabled = disabled || (projectedCR <= 0 && !shouldEnableForCollateral) || (isInfinite && !shouldEnableForCollateral);
  
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
  const isPositionDangerous = projectedCR > 0 && projectedCR < minCR; // Below minCR is dangerous
  const isAtMinCR = projectedCR > 0 && Math.abs(projectedCR - minCR) < 0.1; // Within 0.1% of minCR
  
  // Format numbers for tooltip display
  const formatTooltipNumber = (num: number): string => {
    if (num === 0) return '0';
    if (num < 0.01) return '< 0.01';
    return num.toFixed(2);
  };

  // Generate tooltip content
  const getTooltipContent = (): string => {
    if (totalDebtUSD <= 0) {
      return 'CR = Collateral Value ÷ Debt Value';
    }
    
    const collateralFormatted = formatTooltipNumber(collateralValueUSD);
    const debtFormatted = formatTooltipNumber(totalDebtUSD);
    const crFormatted = formatTooltipNumber(projectedCR);
    
    return `CR = Collateral Value ÷ Debt Value\n$${collateralFormatted} ÷ $${debtFormatted} = ${crFormatted}%`;
  };

  console.log(projectedCR, sliderMin);

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {/* CR Display with Tooltip */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex justify-between items-center text-sm font-medium cursor-help">
              <span>Collateralization Ratio (CR)</span>
              <span className={
                projectedCR >= 999999 
                  ? 'text-green-600' 
                  : isAtMinCR
                    ? 'text-yellow-600 font-bold'
                    : isPositionDangerous 
                      ? 'text-red-600 font-bold' 
                      : ''
              }>
                {projectedCR >= 999999 ? '∞' : projectedCR > 0 ? formatPercentage(projectedCR, 1) : '0.0%'}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="whitespace-pre-line text-center">
              {getTooltipContent()}
            </div>
          </TooltipContent>
        </Tooltip>
      
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
        <span>{formatPercentage(minCR)}</span>
        <span>{formatPercentage(sliderMax)}</span>
      </div>
      
      {/* Status message */}
      {isOutOfBounds && !isSliderDisabled && (
        <div className="text-center text-sm text-blue-600">
          {projectedCR+0.1 < sliderMin 
            ? `CR below minimum safe threshold (${formatPercentage(sliderMin)}) - Click slider to set new CR`
            : projectedCR > sliderMax 
              ? `CR above range - Click slider to set new CR`
              : ""
          }
        </div>
      )}
      
      {isSliderDisabled && (
        <div className="text-center text-sm text-gray-500">
          {isInfinite 
            ? "No debt - CR is infinite"
            : "Slider disabled"
          }
        </div>
      )}
      </div>
    </TooltipProvider>
  );
};

export default CRSlider;

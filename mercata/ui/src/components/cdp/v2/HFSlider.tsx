import React from "react";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface HFSliderProps {
  value: number; // Current slider value (target minimum HF)
  onChange: (hf: number) => void; // Called when slider value changes
  minHF?: number; // Minimum health factor threshold, calculated as max(minCR) / max(LT) from all vaults
  currentHF?: number; // Current position health factor (for display)
  disabled?: boolean;
}

/**
 * HFSlider - Health Factor slider for setting minimum target health factor
 * 
 * Scale: minHF → 3.0
 * 
 * minHF should be calculated as:
 *   minHF = max(minCR across all vaults) / max(liquidationRatio across all vaults)
 * 
 * Example: If vaults have minCR of 150% and liquidationRatio of 133%:
 *   minHF = 150 / 133 = 1.13
 * 
 * Use calculateSliderMinHF() or calculateSliderMinHFFromPercentages() from loanUtils.ts
 * 
 * The slider value acts as a minimum target health factor - higher = safer, lower = riskier
 */
const HFSlider: React.FC<HFSliderProps> = ({
  value,
  onChange,
  minHF = 1.0,
  currentHF,
  disabled = false,
}) => {
  // Slider bounds: 3.0 at left, minHF at right
  const hfMin = Math.round(minHF * 100) / 100;
  const hfMax = 3.0;
  
  // Clamp actual HF value
  const clampedValue = Math.max(hfMin, Math.min(hfMax, value));
  
  // Convert HF to slider position: left=0 (HF=3.0), right=range (HF=minHF)
  const range = hfMax - hfMin;
  const sliderPosition = hfMax - clampedValue; // 0 when HF=3.0, range when HF=minHF
  
  // Determine risk level
  const getRiskLevel = (hf: number): { label: string; color: string } => {
    if (hf >= 2.5) return { label: 'Low Risk', color: 'text-green-600' };
    if (hf >= 2.0) return { label: 'Medium Risk', color: 'text-blue-600' };
    if (hf >= 1.5) return { label: 'Higher Risk', color: 'text-yellow-600' };
    return { label: 'High Risk', color: 'text-red-600' };
  };
  
  const riskLevel = getRiskLevel(clampedValue);
  
  // Format number
  const formatNumber = (num: number, decimals: number = 2): string => {
    if (isNaN(num)) return '0';
    if (num >= 999999) return '∞';
    return num.toFixed(decimals);
  };
  
  // Convert slider position back to HF value
  const handleSliderChange = (values: number[]) => {
    const newHF = hfMax - values[0]; // Convert position back to HF
    onChange(Math.round(newHF * 100) / 100);
  };
  
  // Generate tooltip content
  const getTooltipContent = (): string => {
    return `Target minimum Health Factor\nHigher values = Safer position, less borrowing\nLower values = Riskier position, more borrowing`;
  };

  return (
    <TooltipProvider>
      <div className="space-y-2">
        {/* Header: Label with Tooltip and Value/Risk Level */}
        <div className="flex items-center justify-between">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 cursor-help">
                <span className="text-base font-bold">Health Factor</span>
                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                  <path strokeWidth="2" d="M12 16v-4M12 8h.01"/>
                </svg>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <div className="whitespace-pre-line text-center">
                {getTooltipContent()}
              </div>
            </TooltipContent>
          </Tooltip>
          
          {/* Risk Level and Value */}
          <div className="flex items-baseline gap-3">
            <span className={`text-lg font-medium ${riskLevel.color}`}>{riskLevel.label}</span>
            <span className="text-2xl font-bold tabular-nums">{formatNumber(clampedValue, 2)}</span>
          </div>
        </div>
      
        {/* Slider: 3.0 at left, minHF at right */}
        <Slider 
          value={[sliderPosition]}
          min={0}
          max={range}
          step={0.01} 
          onValueChange={handleSliderChange}
          disabled={disabled}
          className="w-full"
        />
      
        {/* Slider End Labels */}
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">Safer</span>
          <span className="text-muted-foreground">Riskier</span>
        </div>
        
        {/* Current Position Health */}
        <div className="text-sm text-muted-foreground flex items-center justify-between">
          <span>Current Position Health</span>
          <span className="text-blue-600 font-medium tabular-nums">
            {currentHF === 0 || currentHF === undefined ? 'No Position' : currentHF >= 999999 ? '∞' : formatNumber(currentHF, 2)}
            {' → '}
            {formatNumber(clampedValue, 2)}
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default HFSlider;


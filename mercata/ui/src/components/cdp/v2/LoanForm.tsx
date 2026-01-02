import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import MintAmountInput from './MintAmountInput';
import { formatUSD, formatPercentage, getRiskColor, getRiskLabel } from '@/utils/loanUtils';

interface LoanFormProps {
  // Label configuration
  availableLabel?: string; // e.g., "Available to Mint" or "Available to Borrow"
  actionButtonLabel?: string; // e.g., "Confirm Mint" or "Confirm Borrow"
  
  // Data
  availableAmount: string; // Formatted available amount
  averageStabilityFee: number;
  
  // Mint amount state
  mintAmountInput: string;
  onMintAmountChange: (value: string) => void;
  onMaxClick: () => void;
  isMaxMode: boolean;
  
  // Health factor state
  riskBuffer: number;
  onRiskBufferChange: (value: number) => void;
  
  // Action
  onConfirm: () => void;
  isProcessing?: boolean;
  disabled?: boolean;
}

const LoanForm: React.FC<LoanFormProps> = ({
  availableLabel = 'Available to Mint',
  actionButtonLabel = 'Confirm Mint',
  availableAmount,
  averageStabilityFee,
  mintAmountInput,
  onMintAmountChange,
  onMaxClick,
  isMaxMode,
  riskBuffer,
  onRiskBufferChange,
  onConfirm,
  isProcessing = false,
  disabled = false,
}) => {

  return (
    <>
      <style>{`
        .risk-slider-track { background-color: hsl(var(--secondary)) !important; }
        .risk-slider-range { background-color: var(--risk-slider-color, #10b981) !important; transition: background-color 0.2s ease; }
      `}</style>
      <Card>
        <CardContent className="pt-6 space-y-6">
          {/* Available to Mint/Borrow */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{availableLabel}</span>
              <span className="text-sm font-semibold">USDST {availableAmount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Average Stability Fee</span>
              <span className="text-sm font-semibold">{formatPercentage(averageStabilityFee || 1.5)}</span>
            </div>
          </div>

          {/* Mint Amount Input */}
          <MintAmountInput
            value={mintAmountInput}
            onChange={onMintAmountChange}
            onMaxClick={onMaxClick}
            isMaxMode={isMaxMode}
            label="Mint Amount"
            placeholder="0"
            unit="USDST"
          />

          {/* Health Factor Slider */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">Health Factor</Label>
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Health factor determines your liquidation risk. Higher values are safer.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div style={{ '--risk-slider-color': getRiskColor(riskBuffer) } as React.CSSProperties}>
              <Slider
                value={[riskBuffer]}
                onValueChange={(v) => onRiskBufferChange(v[0])}
                min={1.0}
                max={3.0}
                step={0.01}
                className="w-full risk-slider"
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Safer</span>
              <span className="font-semibold">{riskBuffer.toFixed(2)} - {getRiskLabel(riskBuffer)}</span>
              <span className="text-muted-foreground">Riskier</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Current Position Health: No Position → {riskBuffer.toFixed(2)}
            </div>
          </div>

          {/* Confirm Button */}
          <Button
            disabled={disabled || isProcessing}
            onClick={onConfirm}
            className="w-full"
          >
            {isProcessing ? 'Processing...' : actionButtonLabel}
          </Button>
        </CardContent>
      </Card>
    </>
  );
};

export default LoanForm;


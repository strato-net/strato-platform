import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import MintAmountInput from './MintAmountInput';
import HFSlider from './HFSlider';
import { formatUSD, formatPercentage } from '@/utils/loanUtils';

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
  minHF?: number; // Minimum health factor for slider bounds
  currentHF?: number; // Current position health factor
  
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
  minHF,
  currentHF,
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
              <span className="text-sm font-semibold tabular-nums">USDST {availableAmount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Average Stability Fee</span>
              <span className="text-sm font-semibold tabular-nums">{formatPercentage(averageStabilityFee || 1.5)}</span>
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
          <HFSlider
            value={riskBuffer}
            onChange={onRiskBufferChange}
            minHF={minHF}
            currentHF={currentHF}
            disabled={disabled}
          />

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


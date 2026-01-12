import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import MintAmountInput from './MintAmountInput';
import HFSlider from './HFSlider';
import { formatPercentage } from '@/utils/loanUtils';

interface LoanFormProps {
  // Label configuration
  availableLabel?: string; // e.g., "Available to Mint" or "Available to Borrow"
  
  // Data
  availableAmount: string; // Formatted available amount
  averageStabilityFee: number;
  averageVaultHealth?: string | null; // Average health factor across all vaults
  
  // Mint amount state
  mintAmountInput: string;
  onMintAmountChange: (value: string) => void;
  onMaxClick: () => void;
  isMaxMode: boolean;
  exceedsMaxMint?: boolean; // Whether input exceeds max available to mint
  
  // Health factor state
  riskBuffer: number;
  onRiskBufferChange: (value: number) => void;
  minHF?: number; // Minimum health factor for slider bounds
  currentHF?: number; // Current position health factor
  sliderRangeColor?: string; // Custom color for slider range bar
  
  disabled?: boolean; // Disables both input and slider
  inputDisabled?: boolean; // Disables only the input (overrides disabled for input)
  sliderDisabled?: boolean; // Disables only the slider (overrides disabled for slider)
  
  // Optional button props - if provided, button renders inside form
  actionButtonLabel?: string;
  onConfirm?: () => void;
  isProcessing?: boolean;
  showButton?: boolean;
  buttonDisabled?: boolean;
}

const LoanForm: React.FC<LoanFormProps> = ({
  availableLabel = 'Available to Mint',
  availableAmount,
  averageStabilityFee,
  averageVaultHealth,
  mintAmountInput,
  onMintAmountChange,
  onMaxClick,
  isMaxMode,
  exceedsMaxMint = false,
  riskBuffer,
  onRiskBufferChange,
  minHF,
  currentHF,
  sliderRangeColor,
  disabled = false,
  inputDisabled,
  sliderDisabled,
  actionButtonLabel = 'Confirm Mint',
  onConfirm,
  isProcessing = false,
  showButton = false,
  buttonDisabled,
}) => {

  return (
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
            exceedsMax={exceedsMaxMint}
            label="Mint Amount"
            placeholder="0"
            unit="USDST"
            disabled={inputDisabled ?? disabled}
            maxDisabled={!availableAmount || availableAmount === '0' || availableAmount === '0.00' || parseFloat(availableAmount.replace(/,/g, '')) <= 0}
          />

          {/* Health Factor Slider */}
          <HFSlider
            value={riskBuffer}
            onChange={onRiskBufferChange}
            minHF={minHF}
            currentHF={currentHF}
            averageVaultHealth={averageVaultHealth}
            disabled={sliderDisabled ?? disabled}
            rangeColor={sliderRangeColor}
          />

          {/* Confirm Button - only shown when showButton is true */}
          {showButton && onConfirm && (
          <Button
              disabled={(buttonDisabled ?? disabled) || isProcessing}
            onClick={onConfirm}
            className="w-full"
          >
            {isProcessing ? 'Processing...' : actionButtonLabel}
          </Button>
          )}
        </CardContent>
      </Card>
  );
};

export default LoanForm;


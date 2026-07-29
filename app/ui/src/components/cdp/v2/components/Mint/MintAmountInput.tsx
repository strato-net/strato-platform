import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NumericFormat } from 'react-number-format';

interface MintAmountInputProps {
  value: string;
  onChange: (value: string) => void;
  onMaxClick: () => void;
  isMaxMode: boolean;
  exceedsMax?: boolean; // Whether value exceeds maximum available
  maxAvailable?: string; // Maximum available amount for error message
  label?: string;
  placeholder?: string;
  unit?: string;
  disabled?: boolean;
  maxDisabled?: boolean; // Disable MAX button specifically
}

const MintAmountInput: React.FC<MintAmountInputProps> = ({
  value,
  onChange,
  onMaxClick,
  isMaxMode,
  exceedsMax = false,
  maxAvailable,
  label = 'Mint Amount',
  placeholder = '0',
  unit = 'USDST',
  disabled = false,
  maxDisabled = false,
}) => {
  const handleValueChange = (values: { floatValue: number | undefined; formattedValue: string }) => {
    // If empty or undefined, pass empty string
    if (values.floatValue === undefined || values.formattedValue === '') {
      onChange('');
      return;
    }
    
    // Pass the formatted value (with commas) to parent
    onChange(values.formattedValue);
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="relative">
        <NumericFormat
          value={value}
          onValueChange={handleValueChange}
          thousandSeparator=","
          allowNegative={false}
          customInput={Input}
          placeholder={placeholder}
          inputMode="decimal"
          disabled={disabled}
          className={`pr-20 ${
            exceedsMax 
              ? 'border-red-500 focus-visible:ring-red-500 text-red-600 dark:text-red-400' 
              : isMaxMode 
              ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800' 
              : ''
          }`}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          <span className="text-muted-foreground text-sm">{unit}</span>
          <Button
            type="button"
            variant={isMaxMode ? 'default' : 'ghost'}
            size="sm"
            className={`h-6 px-2 text-xs font-medium ${isMaxMode ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-primary hover:text-primary/80'}`}
            onClick={onMaxClick}
            disabled={disabled || maxDisabled}
          >
            MAX
          </Button>
        </div>
      </div>
      {exceedsMax && (
        <p className="text-xs text-red-600 dark:text-red-400">
          Insufficient collateral. Maximum available: {maxAvailable ? `${maxAvailable} ${unit}` : `${unit}`}. Try decreasing the mint amount or moving the Risk Slider to the right.
        </p>
      )}
    </div>
  );
};

export default MintAmountInput;


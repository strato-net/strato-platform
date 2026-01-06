import React, { useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatNumberWithCommas, parseCommaNumber } from '@/utils/numberUtils';

interface MintAmountInputProps {
  value: string;
  onChange: (value: string) => void;
  onMaxClick: () => void;
  isMaxMode: boolean;
  label?: string;
  placeholder?: string;
  unit?: string;
  disabled?: boolean;
}

const MintAmountInput: React.FC<MintAmountInputProps> = ({
  value,
  onChange,
  onMaxClick,
  isMaxMode,
  label = 'Mint Amount',
  placeholder = '0',
  unit = 'USDST',
  disabled = false,
}) => {
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const cursorPosition = e.target.selectionStart || 0;
    
    if (rawValue === '') {
      onChange('');
      return;
    }
    
    const beforeCursor = rawValue.substring(0, cursorPosition);
    const beforeCursorNoCommas = parseCommaNumber(beforeCursor);
    const parsed = parseCommaNumber(rawValue);
    
    if (parsed === '' || parsed === '.' || /^\d*\.?\d*$/.test(parsed)) {
      const formatted = formatNumberWithCommas(parsed);
      onChange(formatted);
      
      setTimeout(() => {
        const input = e.target;
        if (input) {
          let unformattedPos = 0;
          let formattedPos = 0;
          while (formattedPos < formatted.length && unformattedPos < beforeCursorNoCommas.length) {
            if (formatted[formattedPos] !== ',') unformattedPos++;
            formattedPos++;
          }
          input.setSelectionRange(formattedPos, formattedPos);
        }
      }, 0);
    }
  }, [onChange]);

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="relative">
        <Input
          value={value}
          onChange={handleInputChange}
          placeholder={placeholder}
          inputMode="decimal"
          disabled={disabled}
          className={`pr-20 ${isMaxMode ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800' : ''}`}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          <Button
            type="button"
            variant={isMaxMode ? 'default' : 'ghost'}
            size="sm"
            className={`h-6 px-2 text-xs font-medium ${isMaxMode ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-primary hover:text-primary/80'}`}
            onClick={onMaxClick}
            disabled={disabled}
          >
            MAX
          </Button>
          <span className="text-muted-foreground text-sm">{unit}</span>
        </div>
      </div>
    </div>
  );
};

export default MintAmountInput;


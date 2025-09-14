import { Input } from "@/components/ui/input";
import { handleSimpleAmountInputChange } from "@/utils/validationUtils";
import { formatMaxDisplay, formatUnits } from "@/utils/numberUtils";
import PercentageButtons from "@/components/ui/PercentageButtons";

interface TokenInputProps {
  value: string;
  error: string;
  tokenName: string;
  tokenSymbol: string;
  maxTransferable: bigint | undefined;
  decimals: number;
  disabled: boolean;
  loading: boolean;
  onValueChange: (value: string) => void;
  onErrorChange: (error: string) => void;
  onMaxClick: () => void;
  rightButton?: React.ReactNode;
  showPercentageButtons?: boolean;
}

const TokenInput = ({
  value,
  error,
  tokenName,
  tokenSymbol,
  maxTransferable,
  decimals,
  disabled,
  loading,
  onValueChange,
  onErrorChange,
  onMaxClick,
  rightButton,
  showPercentageButtons = false,
}: TokenInputProps) => {

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">
          {tokenName} (
          <button
            type="button"
            onClick={onMaxClick}
            disabled={disabled || loading}
            className={`font-medium focus:outline-none ${
              disabled || loading
                ? "text-gray-400 cursor-not-allowed"
                : "text-blue-600 hover:underline"
            }`}
          >
            Max: {maxTransferable ? formatMaxDisplay(maxTransferable, tokenSymbol, decimals) : "—"}
          </button>
          )
        </h3>
        {rightButton && <div className="w-16 h-6 flex items-center justify-center">{rightButton}</div>}
      </div>
      
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(e) => handleSimpleAmountInputChange(
            e.target.value,
            onValueChange,
            onErrorChange,
            maxTransferable || 0n,
            tokenSymbol,
            decimals
          )}
          disabled={disabled}
            aria-invalid={!!error}
            aria-busy={loading}
            className={`pl-16 ${error ? 'border-red-500' : ''} ${disabled ? 'bg-gray-100 cursor-not-allowed' : ''}`}
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">
          {tokenSymbol}
        </span>
      </div>
      
      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
      
      {showPercentageButtons && !disabled && (
        <PercentageButtons
          value={value}
          maxValue={maxTransferable ? formatUnits(maxTransferable, decimals) : "0"}
          onChange={onValueChange}
          decimals={decimals}
          className="mt-3"
        />
      )}
    </div>
  );
};

export default TokenInput;

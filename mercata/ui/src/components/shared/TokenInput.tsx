import { Input } from "@/components/ui/input";
import { useAmountValidation } from "@/utils/validationUtils";
import { formatMaxDisplay, formatUnits } from "@/utils/numberUtils";

interface TokenInputProps {
  value: string;
  error: string;
  tokenName: string;
  tokenSymbol: string;
  tokenAddress: string;
  maxAmount: bigint;
  transactionFee: string;
  decimals: number;
  disabled: boolean;
  loading: boolean;
  onValueChange: (value: string) => void;
  onErrorChange: (error: string) => void;
}

const TokenInput = ({
  value,
  error,
  tokenName,
  tokenSymbol,
  tokenAddress,
  maxAmount,
  transactionFee,
  decimals,
  disabled,
  loading,
  onValueChange,
  onErrorChange,
}: TokenInputProps) => {
  const { handleInput, getMaxTransferable } = useAmountValidation();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    
    handleInput(
      inputValue,
      onValueChange,
      onErrorChange,
      {
        maxAmount,
        symbol: tokenSymbol,
        tokenAddress,
        transactionFee,
        decimals,
      }
    );
  };

  const maxTransferable = getMaxTransferable(maxAmount, tokenAddress, transactionFee);
  const isMaxDisabled = loading || disabled || maxTransferable === 0n;
  
  const handleMaxClick = () => {
    const maxValue = formatUnits(maxTransferable, decimals);
    handleInput(
      maxValue,
      onValueChange,
      onErrorChange,
      {
        maxAmount,
        symbol: tokenSymbol,
        tokenAddress,
        transactionFee,
        decimals,
      }
    );
  };

  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-medium mb-3">
        {tokenName}
        <>{" ("}
          <button
            type="button"
            onClick={handleMaxClick}
            disabled={isMaxDisabled}
            className={`font-medium focus:outline-none ${
              isMaxDisabled
                ? "text-gray-400 cursor-not-allowed"
                : "text-blue-600 hover:underline"
            }`}
          >
            Max: {formatMaxDisplay(maxTransferable, tokenSymbol, decimals)}
          </button>
          {")"}</>
      </h3>
      
      <div className="flex flex-col sm:flex-row items-stretch sm:items-start space-y-2 sm:space-y-0 sm:space-x-2">
        <div className="relative flex-1">
          <Input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={value}
            onChange={handleChange}
            disabled={disabled}
            aria-invalid={!!error}
            aria-busy={loading}
            className={`pl-16 ${error ? 'border-red-500' : ''} ${disabled ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">
            {tokenSymbol}
          </span>
        </div>
      </div>
      
      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
    </div>
  );
};

export default TokenInput;

import { Input } from "@/components/ui/input";
import { handleAmountInputChange } from "@/utils/validationUtils";
import { formatMaxDisplay, formatUnits } from "@/utils/numberUtils";

interface TokenInputProps {
  value: string;
  error: string;
  tokenName: string;
  tokenSymbol: string;
  tokenAddress: string;
  maxAmount: bigint;
  maxTransferable: bigint | undefined;
  transactionFee: string;
  decimals: number;
  disabled: boolean;
  loading: boolean;
  usdstBalance: bigint;
  voucherBalance: bigint;
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
  maxTransferable,
  transactionFee,
  decimals,
  disabled,
  loading,
  usdstBalance,
  voucherBalance,
  onValueChange,
  onErrorChange,
}: TokenInputProps) => {

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    
    handleAmountInputChange(
      inputValue,
      onValueChange,
      onErrorChange,
      {
        maxAmount,
        symbol: tokenSymbol,
        tokenAddress,
        transactionFee,
        decimals,
        voucherBalance: voucherBalance,
        usdstBalance: usdstBalance,
      }
    );
  };

  const isMaxDisabled = loading || disabled || !maxTransferable || maxTransferable === 0n;
  
  const handleMaxClick = () => {
    if (!maxTransferable) return;
    const maxValue = formatUnits(maxTransferable, decimals);
    handleAmountInputChange(
      maxValue,
      onValueChange,
      onErrorChange,
      {
        maxAmount,
        symbol: tokenSymbol,
        tokenAddress,
        transactionFee,
        decimals,
        voucherBalance: voucherBalance,
        usdstBalance: usdstBalance,
      }
    );
  };

  // Filter out fee-related errors - these should be handled by the parent modal
  const displayError = error && !error.includes('Insufficient USDST + vouchers for transaction fee') ? error : '';

  return (
    <div className="rounded-lg border p-3">
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
            Max: {maxTransferable ? formatMaxDisplay(maxTransferable, tokenSymbol, decimals) : "—"}
          </button>
          {")"}</>
      </h3>
      
      <div className="relative">
          <Input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={value}
            onChange={handleChange}
            disabled={disabled}
            aria-invalid={!!displayError}
            aria-busy={loading}
            className={`pl-16 ${displayError ? 'border-red-500' : ''} ${disabled ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">
            {tokenSymbol}
          </span>
      </div>
      
      {displayError && <p className="text-sm text-red-500 mt-1">{displayError}</p>}
    </div>
  );
};

export default TokenInput;

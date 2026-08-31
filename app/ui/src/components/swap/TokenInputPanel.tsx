import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { SwapToken } from "@/interface";
import { formatBalance, toWei } from "@/utils/numberUtils";

// ============================================================================
// TOKEN AVATAR
// ============================================================================
interface TokenAvatarProps {
  token: { images?: Array<{ value: string }>; _name: string; _symbol?: string };
  size?: string;
}

export const TokenAvatar = ({ token, size = "w-4 h-4" }: TokenAvatarProps) => {
  return token.images?.[0]?.value ? (
    <img
      src={token.images[0].value}
      alt={token._name}
      className={`${size} rounded-full object-cover`}
    />
  ) : (
    <div
      className={`${size} rounded-full flex items-center justify-center text-xs text-muted-foreground font-medium bg-muted`}
    >
      {token._symbol?.slice(0, 1)}
    </div>
  );
};

// ============================================================================
// LOADING / ANIMATED VALUE
// ============================================================================
export const LoadingSpinner = () => (
  <Loader2 className="h-5 w-5 animate-spin text-current" />
);

export const AnimatedNumber = ({ value, isLoading, hideLoader = false }: { value: string | undefined; isLoading: boolean; hideLoader?: boolean }) => {
  const [displayValue, setDisplayValue] = useState(value);
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    if (isLoading || value === undefined) {
      // Don't fade out during loading or when value is undefined
      return;
    }

    // Only animate if the value actually changed
    if (value !== displayValue) {
      setIsChanging(true);
      setDisplayValue(value);

      // Reset the changing state after animation completes
      const timer = setTimeout(() => setIsChanging(false), 200);
      return () => clearTimeout(timer);
    }
  }, [value, isLoading, displayValue]);

  // Show spinner when value is undefined (unless hideLoader is true)
  if (value === undefined && !hideLoader) {
    return <LoadingSpinner />;
  }

  if (value === undefined && hideLoader) {
    return <>0</>;
  }

  return <>{displayValue}</>;
};

// ============================================================================
// TOKEN SELECTOR
// ============================================================================
interface TokenSelectorProps {
  asset?: SwapToken;
  onSelect: (asset: SwapToken) => void;
  tokens: SwapToken[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}

const TokenSelectorComponent = ({ asset, onSelect, tokens, isOpen, onOpenChange, disabled = false }: TokenSelectorProps) => (
  <Popover open={isOpen && !disabled} onOpenChange={(open) => { if (!disabled) onOpenChange(open); }}>
    <PopoverTrigger asChild>
      <Button variant="outline" className="flex items-center gap-1 md:gap-2 justify-between text-xs md:text-sm px-1.5 md:px-3 py-1.5 md:py-2 h-8 md:h-10" disabled={disabled}>
        <div className="flex items-center gap-1 md:gap-2">
          {asset ? <TokenAvatar token={asset} size="w-3.5 h-3.5 md:w-4 md:h-4" /> : null}
          <span className="whitespace-nowrap text-[11px] md:text-sm">{asset?._symbol || "Select"}</span>
        </div>
        <ChevronDown className="h-3 w-3 md:h-4 md:w-4 flex-shrink-0" />
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-56 max-w-[calc(100vw-2rem)] p-0 z-50" align="end" sideOffset={5}>
      <div className="flex flex-col">
        {tokens.length > 0 ? (
          tokens.map((token) => (
            <Button
              key={token._symbol}
              variant="ghost"
              className="justify-start gap-2"
              onClick={() => {
                if (disabled) return;
                onOpenChange(false);
                onSelect(token);
              }}
              disabled={disabled}
            >
              <div className="flex items-center gap-2">
                <TokenAvatar token={token} />
                <span>{token._symbol}</span>
              </div>
              {token._symbol === asset?._symbol && <Check className="h-4 w-4 ml-auto" />}
            </Button>
          ))
        ) : (
          <span className="p-2">No tokens available</span>
        )}
      </div>
    </PopoverContent>
  </Popover>
);

export const TokenSelector = React.memo(TokenSelectorComponent);

// ============================================================================
// TOKEN INPUT PANEL (amount input + token picker + balances)
// ============================================================================
interface TokenInputPanelProps {
  label: string;
  amount: string;
  onChange: (value: string) => void;
  asset?: SwapToken;
  onSelect: (asset: SwapToken) => void;
  tokens: SwapToken[];
  userBalanceWei: string;
  poolBalanceWei: string;
  /** From side: spendable balance after fees; drives the Max button */
  maxAmountWei: string;
  isFromInput: boolean;
  onMaxClick?: () => void;
  amountError?: string;
  loading: boolean;
  disabled?: boolean;
  /** hide the user-balance line and Max button (e.g. signed-out guests) */
  showUserBalance?: boolean;
}

export const TokenInputPanel = ({
  label,
  amount,
  onChange,
  asset,
  onSelect,
  tokens,
  userBalanceWei,
  poolBalanceWei,
  maxAmountWei,
  isFromInput,
  onMaxClick,
  amountError,
  loading,
  disabled = false,
  showUserBalance = true,
}: TokenInputPanelProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-muted/50 p-3 md:p-4 rounded-lg border border-border">
      <div className="flex flex-col sm:flex-row sm:justify-between mb-2">
        <label className="text-sm text-muted-foreground font-semibold">{label}</label>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <input
            type="text"
            value={amount}
            onChange={e => { if (!disabled) onChange(e.target.value); }}
            placeholder="0.00"
            inputMode="decimal"
            disabled={disabled}
            className={`p-1 md:p-2 bg-transparent border-none text-sm md:text-lg font-medium focus:outline-none text-foreground placeholder:text-muted-foreground w-full tabular-nums ${
              amountError ? " border border-destructive rounded-md" : ""
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          />
          {amountError && (
            <p className="text-destructive text-xs md:text-sm mt-1">{amountError}</p>
          )}
        </div>
        <div className="flex-shrink-0">
          <TokenSelector
            asset={asset}
            onSelect={onSelect}
            tokens={tokens}
            isOpen={isOpen}
            onOpenChange={setIsOpen}
            disabled={disabled}
          />
        </div>
      </div>
      {asset && (
        <div className="mt-2 flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-2">
          {showUserBalance && (isFromInput ? (
            <span className="text-xs md:text-sm text-muted-foreground flex flex-wrap items-center gap-1">
              <span className="whitespace-nowrap">Your balance:</span>
              <span className="whitespace-nowrap tabular-nums">
                <AnimatedNumber
                  value={maxAmountWei !== "0" ? formatBalance(maxAmountWei, asset._symbol || "", undefined, 2, 6) : "0"}
                  isLoading={loading}
                  hideLoader={disabled}
                />
              </span>
              <button
                type="button"
                className={`text-primary hover:text-primary/80 font-medium text-xs ${(disabled || toWei(maxAmountWei) === 0n) ? "opacity-50 cursor-not-allowed" : ""}`}
                onClick={() => { if (!disabled) onMaxClick?.(); }}
                disabled={disabled || toWei(maxAmountWei) === 0n}
              >
                Max
              </button>
            </span>
          ) : (
            <span className="text-xs md:text-sm text-muted-foreground flex flex-wrap items-center gap-1">
              <span className="whitespace-nowrap">Your balance:</span>
              <span className="whitespace-nowrap tabular-nums">
                <AnimatedNumber
                  value={userBalanceWei !== "0" ? formatBalance(userBalanceWei, asset._symbol || "", undefined, 2, 6) : "0"}
                  isLoading={loading}
                  hideLoader={disabled}
                />
              </span>
            </span>
          ))}
          <span className={`text-xs md:text-sm text-muted-foreground flex flex-wrap items-center gap-1 ${
            showUserBalance ? "" : "sm:ml-auto"
          }`}>
            <span className="whitespace-nowrap">Pool balance:</span>
              <span className="whitespace-nowrap tabular-nums">
                <AnimatedNumber
                  value={poolBalanceWei !== "0" ? formatBalance(poolBalanceWei, asset._symbol || "", undefined, 2, 6) : "0"}
                  isLoading={loading}
                  hideLoader={disabled}
                />
              </span>
          </span>
        </div>
      )}
    </div>
  );
};

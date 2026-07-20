import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ArrowDownUp, Check, ChevronDown, HelpCircle } from "lucide-react";
import { Pool, SwapToken, PoolV3, PoolV3Quote } from "@/interface";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTokenContext } from "@/context/TokenContext";
import { useLendingContext } from "@/context/LendingContext";
import { useToast } from '@/hooks/use-toast';
import { useSwapContext } from "@/context/SwapContext";
import { Slider } from "@/components/ui/slider";
import { usdstAddress, SWAP_FEE } from "@/lib/constants";
import { safeParseUnits, formatBalance, formatAmount, formatUnits, toWei } from "@/utils/numberUtils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePoolPolling } from "@/hooks/useSmartPolling";
import { calculateSwapOutput, calculateSwapInput, calculateImpact, isMultiTokenPool, getMultiTokenExchangeRate, calculateMultiTokenSwapOutput, calculateMultiTokenSwapInput } from "@/helpers/swapCalculations";
import { computeMaxTransferable, handleAmountInputChange } from "@/utils/transferValidation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import { UserRewardsData } from "@/services/rewardsService";

// ============================================================================
// CONSTANTS
// ============================================================================
const DEFAULT_SLIPPAGE = 4; // 4%
const POLL_INTERVAL = 10000; // 10 seconds

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const isValidInputAmount = (amount: string): boolean => {
  return amount && amount !== "." && amount !== "0." && !isNaN(Number(amount));
};

const calculateExchangeRates = (pool: Pool | null, fromAsset: SwapToken | null, toAsset: SwapToken | null) => {
  if (!pool || !fromAsset?.address || !toAsset?.address) return {
    exchangeRateRaw: undefined,
    exchangeRate: undefined,
    oracleExchangeRate: undefined,
    invertedExchangeRate: undefined,
    invertedOracleExchangeRate: undefined,
    isFractionalRate: false,
    isFractionalOracleRate: false
  };

  // Multi-token pool: use oracle-based rates from coins
  if (isMultiTokenPool(pool)) {
    const rate = getMultiTokenExchangeRate(pool, fromAsset.address, toAsset.address);
    const invertedRate = getMultiTokenExchangeRate(pool, toAsset.address, fromAsset.address);
    const cleanRate = rate && rate !== "0" ? rate : undefined;
    const isFractional = cleanRate ? parseFloat(cleanRate) < 1 : false;

    return {
      exchangeRateRaw: cleanRate,
      exchangeRate: cleanRate ? formatAmount(cleanRate) : undefined,
      oracleExchangeRate: cleanRate ? formatAmount(cleanRate) : undefined,
      invertedExchangeRate: invertedRate && invertedRate !== "0" ? formatAmount(invertedRate) : undefined,
      invertedOracleExchangeRate: invertedRate && invertedRate !== "0" ? formatAmount(invertedRate) : undefined,
      isFractionalRate: isFractional,
      isFractionalOracleRate: isFractional
    };
  }

  const isAToB = pool.tokenA?.address === fromAsset.address;
  const poolRate = isAToB ? pool.aToBRatio : pool.bToARatio;
  const oracleRate = isAToB ? pool.oracleAToBRatio : pool.oracleBToARatio;

  // Strip commas from raw rate in case backend sends pre-formatted data
  const cleanRate = poolRate && poolRate !== "0" ? String(poolRate).replace(/,/g, '') : undefined;
  const cleanOracleRate = oracleRate && oracleRate !== "0" ? String(oracleRate).replace(/,/g, '') : undefined;

  // Get inverted rates for display when rate is fractional
  const invertedPoolRate = isAToB ? pool.bToARatio : pool.aToBRatio;
  const invertedOracleRate = isAToB ? pool.oracleBToARatio : pool.oracleAToBRatio;

  // Check if rates are fractional (less than 1) - these are harder to understand
  const isFractionalRate = cleanRate ? parseFloat(cleanRate) < 1 : false;
  const isFractionalOracleRate = cleanOracleRate ? parseFloat(cleanOracleRate) < 1 : false;

  return {
    exchangeRateRaw: cleanRate,
    exchangeRate: poolRate && poolRate !== "0" ? formatAmount(poolRate) : undefined,
    oracleExchangeRate: oracleRate && oracleRate !== "0" ? formatAmount(oracleRate) : undefined,
    invertedExchangeRate: invertedPoolRate && invertedPoolRate !== "0" ? formatAmount(invertedPoolRate) : undefined,
    invertedOracleExchangeRate: invertedOracleRate && invertedOracleRate !== "0" ? formatAmount(invertedOracleRate) : undefined,
    isFractionalRate,
    isFractionalOracleRate
  };
};

// ============================================================================
// UI COMPONENTS
// ============================================================================
const LoadingSpinner = () => (
  <span className="inline-flex items-center animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary" />
);

const AnimatedNumber = ({ value, isLoading, hideLoader = false }: { value: string | undefined; isLoading: boolean; hideLoader?: boolean }) => {
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

  // If hideLoader is true and value is undefined, show "0" or empty
  if (value === undefined && hideLoader) {
    return <>0</>;
  }

  return <>{displayValue}</>;
};

// ============================================================================
// COMPONENT INTERFACES
// ============================================================================
interface TokenSelectorProps {
  asset?: SwapToken;
  onSelect: (asset: SwapToken) => void;
  tokens: SwapToken[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}

// ============================================================================
// TOKEN AVATAR COMPONENT
// ============================================================================
interface TokenAvatarProps {
  token: { images?: Array<{ value: string }>; _name: string; _symbol?: string };
  size?: string;
}

const TokenAvatar = ({ token, size = "w-4 h-4" }: TokenAvatarProps) => {
  return token.images?.[0]?.value ? (
    <img
      src={token.images[0].value}
      alt={token._name}
      className={`${size} rounded-full object-cover`}
    />
  ) : (
    <div
      className={`${size} rounded-full flex items-center justify-center text-xs text-white font-medium`}
      style={{ backgroundColor: "red" }}
    >
      {token._symbol?.slice(0, 1)}
    </div>
  );
};

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
// TOKEN INPUT COMPONENT
// ============================================================================
interface TokenInputProps {
  amount: string;
  userBalanceWei: string;
  poolBalanceWei: string;
  maxAmountWei: string;
  onChange: (value: string) => void;
  asset?: SwapToken;
  onSelect: (asset: SwapToken) => void;
  tokens: SwapToken[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  onFocus: () => void;
  isFromInput: boolean;
  onMaxClick: () => void;
  amountError?: string;
  loading: boolean;
  disabled?: boolean;
}

const TokenInput = ({
  amount,
  userBalanceWei,
  poolBalanceWei,
  maxAmountWei,
  onChange,
  asset,
  onSelect,
  tokens,
  isOpen,
  onOpenChange,
  label,
  onFocus,
  isFromInput,
  onMaxClick,
  amountError,
  loading,
  disabled = false,
}: TokenInputProps) => {      
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
            onFocus={onFocus}
            placeholder="0.00"
            inputMode="decimal"
            disabled={disabled || (toWei(maxAmountWei) === 0n && isFromInput)}
            className={`p-1 md:p-2 bg-transparent border-none text-sm md:text-lg font-medium focus:outline-none text-foreground placeholder:text-muted-foreground w-full ${
              amountError ? " border border-red-500 rounded-md" : ""
              } ${(disabled || (toWei(maxAmountWei) === 0n && isFromInput)) ? "opacity-50 cursor-not-allowed" : ""}`}
          />
          {amountError && (
            <p className="text-red-600 text-xs md:text-sm mt-1">{amountError}</p>
          )}
        </div>
        <div className="flex-shrink-0">
          <TokenSelector
            asset={asset}
            onSelect={onSelect}
            tokens={tokens}
            isOpen={isOpen}
            onOpenChange={onOpenChange}
            disabled={disabled}
          />
        </div>
      </div>
      {asset && (
        <div className="mt-2 flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-2">
          {isFromInput ? (
            <span className={`text-xs md:text-sm flex flex-wrap items-center gap-1 ${
              toWei(maxAmountWei) === 0n ? "text-red-600" : "text-muted-foreground"
            }`}>
              <span className="whitespace-nowrap">Your Balance:</span>
              <span className="whitespace-nowrap">
                <AnimatedNumber 
                  value={maxAmountWei !== "0" ? formatBalance(maxAmountWei, asset._symbol || "", undefined, 2, 6) : "0"} 
                  isLoading={loading}
                  hideLoader={disabled}
                />
              </span>
              <button
                type="button"
                className={`text-blue-600 text-xs underline ${(disabled || toWei(maxAmountWei) === 0n) ? "opacity-50 cursor-not-allowed" : ""}`}
                onClick={() => { if (!disabled) onMaxClick(); }}
                disabled={disabled || toWei(maxAmountWei) === 0n}
              >
                Max
              </button>
            </span>
          ) : (
            <span className="text-xs md:text-sm text-muted-foreground flex flex-wrap items-center gap-1">
              <span className="whitespace-nowrap">Your Balance:</span>
              <span className="whitespace-nowrap">
                <AnimatedNumber 
                  value={userBalanceWei !== "0" ? formatBalance(userBalanceWei, asset._symbol || "", undefined, 2, 6) : "0"} 
                  isLoading={loading}
                  hideLoader={disabled}
                />
              </span>
            </span>
          )}
          <span className="text-xs md:text-sm text-muted-foreground flex flex-wrap items-center gap-1">
            <span className="whitespace-nowrap">Pool Balance:</span>
              <span className="whitespace-nowrap">
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

// ============================================================================
// SWAP DIALOG COMPONENT
// ============================================================================
interface SwapDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  fromAmount: string;
  toAmount: string;
  fromAsset?: SwapToken;
  toAsset?: SwapToken;
  exchangeRate?: string;
  invertedExchangeRate?: string;
  isFractionalRate: boolean;
  isHighPriceImpact: boolean;
  toAmountMin: string;
  onConfirm: () => void;
  isLoading: boolean;
}

const SwapDialog = ({
  isOpen,
  onOpenChange,
  fromAmount,
  toAmount,
  fromAsset,
  toAsset,
  exchangeRate,
  invertedExchangeRate,
  isFractionalRate,
  isHighPriceImpact,
  toAmountMin,
  onConfirm,
  isLoading
}: SwapDialogProps) => (
  <Dialog open={isOpen} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-[95vw] sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="text-lg md:text-xl">Confirm Trade</DialogTitle>
        <DialogDescription className="text-xs md:text-sm">
          Please review the details below. Slippage tolerance and fees have already been applied.
        </DialogDescription>
      </DialogHeader>
      <div className="py-4 space-y-4">
        <div className="flex justify-between items-center gap-2">
          <span className="text-sm md:text-base text-muted-foreground flex-shrink-0">You pay:</span>
          <span className="font-semibold text-sm md:text-base text-right break-words">
            {fromAmount} {fromAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between items-center gap-2">
          <span className="text-sm md:text-base text-muted-foreground flex-shrink-0">You receive:</span>
          <span className="font-semibold text-sm md:text-base text-right break-words">
            {toAmount} {toAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between items-start gap-2">
          <span className="text-sm md:text-base text-muted-foreground flex-shrink-0 min-w-[140px]">Minimum received (after slippage):</span>
          <span className="font-semibold text-sm md:text-base text-right break-words">
            {toAmountMin} {toAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between items-start gap-2">
          <span className="text-sm md:text-base text-muted-foreground flex-shrink-0">Exchange rate:</span>
          <span className="flex flex-col items-end gap-0.5 text-right min-w-0 flex-1">
            <span className="font-semibold text-xs md:text-sm break-words">1 {fromAsset?._symbol || ""} ≈ {exchangeRate} {toAsset?._symbol || ""}</span>
            {invertedExchangeRate && (
              <span className="text-muted-foreground/70 text-xs md:text-sm break-words">1 {toAsset?._symbol || ""} ≈ {invertedExchangeRate} {fromAsset?._symbol || ""}</span>
            )}
          </span>
        </div>
        {isHighPriceImpact && (
          <div className="text-yellow-600 text-xs md:text-sm mt-2">
            ⚠️ High price impact — you may receive fewer tokens than expected.
          </div>
        )}
      </div>
      <DialogFooter className="flex-col sm:flex-row gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
          Cancel
        </Button>
        <Button disabled={isLoading} onClick={onConfirm} className="w-full sm:w-auto bg-strato-blue hover:bg-strato-blue/90">
          {isLoading && <LoadingSpinner />} Confirm Trade
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

// ============================================================================
// SLIPPAGE CONTROL COMPONENT
// ============================================================================
interface SlippageControlProps {
  slippage: number;
  autoSlippage: boolean;
  onSlippageChange: (value: number) => void;
  onAutoToggle: (auto: boolean) => void;
  disabled?: boolean;
}

const SlippageControl = ({ slippage, autoSlippage, onSlippageChange, onAutoToggle, disabled = false }: SlippageControlProps) => {
  const isHighSlippage = slippage > 5;
  const isLowSlippage = slippage < 1;
  const slippageClass = isHighSlippage || isLowSlippage
    ? 'border-yellow-400 text-yellow-600'
    : 'border-border text-foreground';

  return (
    <div className="flex flex-col gap-1 mt-2">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-sm mb-1">
        <span className="text-muted-foreground">Max slippage</span>
        <div className="flex items-center gap-1.5 md:gap-2">
          <button
            className={`px-2 md:px-3 py-1 rounded-full text-xs font-medium border ${
              autoSlippage ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground'
              } border-border ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={() => {
              if (disabled) return;
              onAutoToggle(true);
              onSlippageChange(DEFAULT_SLIPPAGE);
            }}
            disabled={disabled}
          >
            Auto
          </button>
          <button
            className={`px-2 md:px-3 py-1 rounded-full text-xs font-medium border ${
              !autoSlippage ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground'
              } border-border ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={() => { if (!disabled) onAutoToggle(false); }}
            disabled={disabled}
          >
            Manual
          </button>
          <span className={`ml-1 md:ml-2 px-2 md:px-3 py-1 rounded-full border text-xs font-semibold ${slippageClass}`}>
            {slippage}%
          </span>
        </div>
      </div>
      {!autoSlippage && (
        <div className="flex items-center gap-2 mt-2">
          <Slider
            value={[slippage]}
            min={0.1}
            max={10}
            step={0.1}
            onValueChange={(value) => { if (!disabled) onSlippageChange(value[0]); }}
            className="w-full"
            disabled={disabled}
          />
        </div>
      )}
      {isHighSlippage && (
        <div className="text-xs text-yellow-600 mt-1 font-bold">⚠️ High slippage</div>
      )}
      {isLowSlippage && (
        <div className="text-xs text-yellow-600 mt-1 font-bold">⚠️ Low slippage</div>
      )}
    </div>
  );
};

// ============================================================================
// VENUE (POOL VERSION) SELECTOR COMPONENT
// ============================================================================
interface VenueSelectorProps {
  venue: 'v2' | 'v3';
  onChange: (venue: 'v2' | 'v3') => void;
  v2Available: boolean;
  v3Available: boolean;
  disabled?: boolean;
}

const VENUE_OPTIONS = [
  { key: 'v2' as const, title: 'V2', subtitle: 'Classic pool' },
  { key: 'v3' as const, title: 'V3', subtitle: 'Concentrated liquidity' },
];

const VenueSelector = ({ venue, onChange, v2Available, v3Available, disabled = false }: VenueSelectorProps) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-sm text-muted-foreground font-semibold">Pool Version</span>
    <div className="grid grid-cols-2 gap-2">
      {VENUE_OPTIONS.map(({ key, title, subtitle }) => {
        const available = key === 'v2' ? v2Available : v3Available;
        const selected = venue === key && available;
        return (
          <button
            key={key}
            type="button"
            onClick={() => { if (!disabled && available) onChange(key); }}
            disabled={disabled || !available}
            className={`rounded-lg border p-2.5 md:p-3 text-left transition-colors ${
              selected ? 'border-strato-blue bg-muted' : 'border-border hover:bg-muted/50'
            } ${(disabled || !available) ? 'opacity-50 cursor-not-allowed hover:bg-transparent' : ''}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm md:text-base font-semibold">{title}</span>
              {selected && <Check className="h-4 w-4 text-strato-blue flex-shrink-0" />}
            </div>
            <div className="text-[11px] md:text-xs text-muted-foreground mt-0.5">
              {available ? subtitle : 'Not available for this pair'}
            </div>
          </button>
        );
      })}
    </div>
  </div>
);

// ============================================================================
// FEE TIER SELECTOR COMPONENT (V3)
// ============================================================================
const FEE_TIER_DESCRIPTIONS: Record<number, string> = {
  100: 'Best for very stable pairs',
  500: 'Best for stable pairs',
  3000: 'Best for most pairs',
  10000: 'Best for exotic pairs',
};

interface FeeTierSelectorProps {
  pools: PoolV3[];
  quotes: Record<string, PoolV3Quote | null>;
  selectedAddress?: string;
  onSelect: (address: string) => void;
  quoteLoading: boolean;
  toSymbol?: string;
  disabled?: boolean;
}

const FeeTierSelector = ({ pools, quotes, selectedAddress, onSelect, quoteLoading, toSymbol, disabled = false }: FeeTierSelectorProps) => {
  // Before an amount is entered there are no quotes yet — show each tier's TVL instead
  const hasQuotes = Object.keys(quotes).length > 0;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground font-semibold">Fee Tier</span>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {pools.map((p) => {
          const q = quotes[p.address];
          const out = q && BigInt(q.amountOut) > 0n ? formatAmount(formatUnits(q.amountOut)) : null;
          const selected = selectedAddress === p.address;
          return (
            <button
              key={p.address}
              type="button"
              onClick={() => { if (!disabled) onSelect(p.address); }}
              disabled={disabled}
              className={`rounded-lg border p-2.5 md:p-3 text-left transition-colors ${
                selected ? 'border-strato-blue bg-muted' : 'border-border hover:bg-muted/50'
              } ${disabled ? 'opacity-50 cursor-not-allowed hover:bg-transparent' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{p.fee / 10000}%</span>
                {selected && <Check className="h-3.5 w-3.5 text-strato-blue flex-shrink-0" />}
              </div>
              {FEE_TIER_DESCRIPTIONS[p.fee] && (
                <div className="text-[11px] text-muted-foreground mt-0.5">{FEE_TIER_DESCRIPTIONS[p.fee]}</div>
              )}
              <div className="text-[11px] text-muted-foreground mt-1 truncate">
                {hasQuotes ? (
                  <>
                    {quoteLoading ? '…' : out ? `≈ ${out} ${toSymbol || ''}` : 'No liquidity'}
                    {q?.partialFill ? ' · partial' : ''}
                  </>
                ) : (
                  `$${p.totalLiquidityUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })} TVL`
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// MAIN SWAP WIDGET COMPONENT
// ============================================================================
interface SwapWidgetProps {
  userRewards?: UserRewardsData | null;
  rewardsLoading?: boolean;
  guestMode?: boolean;
}

const SwapWidget = ({ userRewards, rewardsLoading, guestMode = false }: SwapWidgetProps = {}) => {
  // ========================================================================
  // CONTEXT & HOOKS
  // ========================================================================
  const { swappableTokens, pairableTokens, pairablesLoading, refetchSwappableTokens, fetchPairableTokens, swap, swapMultiToken, getPoolByTokenPair, getPoolByAddress, fromAsset, toAsset, pool, setPool, poolLoading, loading: swapLoading, setFromAsset, setToAsset, refreshSwapHistory, pools, fetchPools, swapVenue, setSwapVenue, v3PairPools, getV3PoolsByPair, quoteV3, swapV3 } = useSwapContext();

  // ========================================================================
  // DERIVED STATE
  // ========================================================================
  const fromOptions = useMemo(
    () => swappableTokens.filter(t => t.address !== toAsset?.address),
    [swappableTokens, toAsset?.address]
  );

  const toOptions = useMemo(
    () => pairableTokens.filter(t => t.address !== fromAsset?.address),
    [pairableTokens, fromAsset?.address]
  );
  const { userAddress } = useUser();
  const { fetchTokens } = useUserTokens();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useTokenContext();
  const { refreshLoans, refreshCollateral } = useLendingContext();
  const { toast } = useToast();

  // ========================================================================
  // STATE
  // ========================================================================
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [fromAmount, setFromAmount] = useState("");
  const [fromAmountError, setFromAmountError] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [toAmountError, setToAmountError] = useState("");
  const [fromPopoverOpen, setFromPopoverOpen] = useState(false);
  const [toPopoverOpen, setToPopoverOpen] = useState(false);
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [autoSlippage, setAutoSlippage] = useState(true);
  const [editingField, setEditingField] = useState<'from' | 'to' | null>(null);
  const [maxTransferableError, setMaxTransferableError] = useState("");
  // All fee-tier quotes for the current pair, keyed by pool address. No auto-optimization —
  // the user picks the tier from the list; `v3Quote` (below) is the selected tier's quote.
  const [v3Quotes, setV3Quotes] = useState<Record<string, PoolV3Quote | null>>({});
  const [selectedV3PoolAddress, setSelectedV3PoolAddress] = useState<string | null>(null);
  const [v3QuoteLoading, setV3QuoteLoading] = useState(false);
  const v3QuoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const v3QuoteAbortRef = useRef<AbortController | null>(null);

  // ========================================================================
  // COMPUTED VALUES
  // ========================================================================
  
  // Exchange rates (both pool and oracle)
  const isMultiToken = pool ? isMultiTokenPool(pool) : false;

  // V3 (concentrated liquidity) derived state
  const isV3 = swapVenue === 'v3' && v3PairPools.length > 0;
  // pool the user has selected among the pair's fee tiers (defaults to the first listed)
  const v3ExecPool: PoolV3 | null = useMemo(() => {
    if (v3PairPools.length === 0) return null;
    return v3PairPools.find(p => p.address === selectedV3PoolAddress) ?? v3PairPools[0];
  }, [v3PairPools, selectedV3PoolAddress]);
  // the selected tier's quote drives the headline amount, rate, and price impact
  const v3Quote: PoolV3Quote | null = v3ExecPool ? (v3Quotes[v3ExecPool.address] ?? null) : null;
  const v3ZeroForOne = !!(v3ExecPool && fromAsset && v3ExecPool.token0.address === fromAsset.address);
  const v3FromPoolBalance = v3ExecPool ? (v3ZeroForOne ? v3ExecPool.token0Balance : v3ExecPool.token1Balance) : "0";
  const v3ToPoolBalance = v3ExecPool ? (v3ZeroForOne ? v3ExecPool.token1Balance : v3ExecPool.token0Balance) : "0";

  const v2Rates = calculateExchangeRates(pool, fromAsset, toAsset);

  // V3 exchange rate from the executing pool's Q64.96 price (token1 per token0, wei scale);
  // the oracle spot rate comes from the price oracle via the backend, like V2's oracle ratios
  const v3Rates = useMemo(() => {
    if (!v3ExecPool) return null;
    try {
      const priceWad = BigInt(v3ExecPool.priceWad);
      if (priceWad === 0n) return null;
      const WAD = 10n ** 18n;
      const rateWei = v3ZeroForOne ? priceWad : (WAD * WAD) / priceWad;
      const invertedWei = v3ZeroForOne ? (WAD * WAD) / priceWad : priceWad;
      const rate = formatUnits(rateWei.toString());
      const inverted = formatUnits(invertedWei.toString());
      const oracleWad = BigInt(v3ExecPool.oraclePriceWad || "0");
      const oracleRate = oracleWad > 0n
        ? formatUnits((v3ZeroForOne ? oracleWad : (WAD * WAD) / oracleWad).toString())
        : undefined;
      const invertedOracleRate = oracleWad > 0n
        ? formatUnits((v3ZeroForOne ? (WAD * WAD) / oracleWad : oracleWad).toString())
        : undefined;
      return {
        exchangeRateRaw: rate,
        exchangeRate: formatAmount(rate),
        oracleExchangeRate: oracleRate ? formatAmount(oracleRate) : undefined,
        invertedExchangeRate: formatAmount(inverted),
        invertedOracleExchangeRate: invertedOracleRate ? formatAmount(invertedOracleRate) : undefined,
        isFractionalRate: parseFloat(rate) < 1,
        isFractionalOracleRate: oracleRate ? parseFloat(oracleRate) < 1 : false,
      };
    } catch {
      return null;
    }
  }, [v3ExecPool, v3ZeroForOne]);

  const { exchangeRateRaw, exchangeRate, oracleExchangeRate, invertedExchangeRate, invertedOracleExchangeRate, isFractionalRate, isFractionalOracleRate } =
    isV3 && v3Rates ? v3Rates : v2Rates;

  // Price impact calculation - V3 comes from the server-side quote; V2 uses raw rate math
  const priceImpact = useMemo(() => {
    if (isV3) return v3Quote ? v3Quote.priceImpact : null;
    return calculateImpact(exchangeRateRaw, fromAmount, toAmount);
  }, [isV3, v3Quote, exchangeRateRaw, fromAmount, toAmount]);

  // Minimum received calculation (after slippage)
  const toAmountMinWei = useMemo(() => {
    if (!toAmount || isNaN(Number(toAmount))) {
      return 0n;
    }
    try {
      const toAmountInWei = safeParseUnits(toAmount);
      const slippageBps = Math.round(slippage * 100);
      return (toAmountInWei * BigInt(10000 - slippageBps)) / 10000n;
    } catch {
      return 0n;
    }
  }, [toAmount, slippage]);

  // Memoized available balance for fromAsset (similar to Transfer.tsx pattern)
  const fromAssetAvailableBalance = useMemo(() => {
    if (!fromAsset) return "0";
    return computeMaxTransferable(
      fromAsset.balance || "0",           // already in wei
      fromAsset.address === usdstAddress,
      voucherBalance,                     // already in wei
      usdstBalance,                       // already in wei
      safeParseUnits(SWAP_FEE).toString(), // already in wei
      setMaxTransferableError
    );
  }, [fromAsset, voucherBalance, usdstBalance]);

  // ========================================================================
  // REFS & CUSTOM HOOKS
  // ========================================================================

  const { startPolling, stopPolling } = usePoolPolling({
    fromAsset,
    toAsset,
    getPoolByTokenPair,
    fetchUsdstBalance,
    interval: POLL_INTERVAL
  });

  // ========================================================================
  // FEE & WARNING LOGIC
  // ========================================================================
  const feeWei = safeParseUnits(SWAP_FEE);
  const fromAmtWei = safeParseUnits(fromAmount || "0");
  const usdstWei = BigInt(usdstBalance || "0");
  const lowThreshWei = safeParseUnits("0.10");

  const canSubtract = usdstWei >= fromAmtWei + feeWei;
  const remaining = canSubtract ? usdstWei - fromAmtWei - feeWei : 0n;

  const isLowBalanceWarning =
    fromAsset?.address === usdstAddress &&
    fromAmtWei > 0n &&
    canSubtract &&
    remaining <= lowThreshWei;

  // ========================================================================
  // EFFECTS
  // ========================================================================
  
  // Clear amounts when pool address changes to prevent stale validation messages
  useEffect(() => {
    setFromAmount("");
    setToAmount("");
    setEditingField(null);
  }, [pool?.address]);

  useEffect(() => {
    if (!guestMode && swappableTokens.length === 0) {
      refetchSwappableTokens();
    }
  }, [guestMode, refetchSwappableTokens, swappableTokens.length]);

  useEffect(() => {
    if (pools.length === 0) {
      fetchPools();
    }
  }, [fetchPools, pools.length]);

  // Initial setup and user-dependent effects
  useEffect(() => {
    fetchUsdstBalance();
    if (swappableTokens.length > 0) {
      initialTokenSetup();
    }
  }, [fetchUsdstBalance, swappableTokens.length]);

  // Fetch pairable tokens when fromAsset changes
  useEffect(() => {
    if (fromAsset?.address) {
      fetchPairableTokens(fromAsset.address);
    }
  }, [fromAsset?.address, fetchPairableTokens]);

  // Handle single pairable token case
  useEffect(() => {
    if (pairableTokens.length === 1 && !toAsset) {
      const token = pairableTokens[0];
      setToAsset({ ...token, balance: token.balance || "0" });
    }
  }, [pairableTokens, toAsset]);

  // Safe auto-select after pairables change
  useEffect(() => {
    if (!fromAsset?.address) return;
    // Don't auto-select while pairables are loading - data may be stale
    if (pairablesLoading) return;
    if (toAsset && toOptions.some(t => t.address === toAsset.address)) return;
    if (toOptions.length) setToAsset(toOptions[0]);
  }, [fromAsset?.address, toOptions, toAsset?.address, pairablesLoading]);

  // Fetch pool immediately when both assets are selected
  useEffect(() => {
    if (fromAsset?.address && toAsset?.address) {
      getPoolByTokenPair(fromAsset.address, toAsset.address);
      getV3PoolsByPair(fromAsset.address, toAsset.address).catch(() => {});
      startPolling();
    } else {
      stopPolling();
    }
  }, [fromAsset?.address, toAsset?.address, getPoolByTokenPair, getV3PoolsByPair, startPolling, stopPolling]);

  // Keep the venue consistent with pool availability: fall back to V2 when no V3 pool
  // exists for the pair, and auto-select V3 when it is the only venue
  useEffect(() => {
    if (swapVenue === 'v3' && v3PairPools.length === 0) {
      setSwapVenue('v2');
    } else if (swapVenue === 'v2' && !pool && !poolLoading && v3PairPools.length > 0) {
      setSwapVenue('v3');
    }
  }, [swapVenue, v3PairPools.length, pool, poolLoading, setSwapVenue]);

  // Clear stale V3 quotes and tier selection when the pair or venue changes
  useEffect(() => {
    setV3Quotes({});
    setSelectedV3PoolAddress(null);
  }, [fromAsset?.address, toAsset?.address, swapVenue]);



  // ========================================================================
  // HELPER FUNCTIONS
  // ========================================================================
  const initialTokenSetup = async () => {
    if (!swappableTokens.length) return;
    const tokenWithBalance = swappableTokens.find(token => 
      token.balance && BigInt(token.balance) > 0n
    );
    if (tokenWithBalance) {
      setFromAsset({ ...tokenWithBalance, balance: tokenWithBalance.balance || "0" });
    }
  }


  // ========================================================================
  // SWAP CALCULATION LOGIC
  // ========================================================================
  const calculateSwapAmount = (inputAmount: string, isFromInput: boolean) => {
    const inputAsset = isFromInput ? fromAsset : toAsset;
    const outputAsset = isFromInput ? toAsset : fromAsset;

    if (!inputAsset?.address || !outputAsset?.address || !pool) return;

    // For multi-token pools, check liquidity using coins array
    if (isMultiToken) {
      const inputCoin = pool.coins?.find(c => c.address === inputAsset.address);
      const outputCoin = pool.coins?.find(c => c.address === outputAsset.address);
      if (!inputCoin || !outputCoin) return;
      if (BigInt(inputCoin.poolBalance || "0") === 0n || BigInt(outputCoin.poolBalance || "0") === 0n) return;
    } else {
      // Check if pool has liquidity (2-token pool)
      const inputPoolBalance = pool.tokenA?.address === inputAsset.address
        ? pool.tokenA.poolBalance || "0"
        : pool.tokenB?.address === inputAsset.address
          ? pool.tokenB.poolBalance || "0"
          : "0";

      const outputPoolBalance = pool.tokenA?.address === outputAsset.address
        ? pool.tokenA.poolBalance || "0"
        : pool.tokenB?.address === outputAsset.address
          ? pool.tokenB.poolBalance || "0"
          : "0";

      if (BigInt(inputPoolBalance) === 0n || BigInt(outputPoolBalance) === 0n) {
        return;
      }
    }

    try {
      // Validate input before parsing
      if (!isValidInputAmount(inputAmount)) {
        return;
      }

      const parsedValue = safeParseUnits(inputAmount);

      if (isMultiToken) {
        // Multi-token pool: use oracle-based calculation
        if (isFromInput) {
          const swapAmount = calculateMultiTokenSwapOutput(parsedValue.toString(), pool, fromAsset!.address, toAsset!.address);
          handleAmountInputChange(formatUnits(swapAmount), setToAmount, setToAmountError, toAsset?.poolBalance || "0");
        } else {
          const requiredInput = calculateMultiTokenSwapInput(parsedValue.toString(), pool, fromAsset!.address, toAsset!.address);
          handleAmountInputChange(formatUnits(requiredInput), setFromAmount, setFromAmountError, fromAssetAvailableBalance);
        }
      } else {
        // Standard 2-token pool
        const isAToB = pool.tokenA?.address === fromAsset?.address;

        if (isFromInput) {
          const swapAmount = calculateSwapOutput(parsedValue.toString(), pool, isAToB);
          handleAmountInputChange(formatUnits(swapAmount), setToAmount, setToAmountError, toAsset?.poolBalance || "0");
        } else {
          const requiredInput = calculateSwapInput(parsedValue.toString(), pool, isAToB);
          handleAmountInputChange(formatUnits(requiredInput), setFromAmount, setFromAmountError, fromAssetAvailableBalance);
        }
      }
    } catch (err) {
      // Show the exact error message
      if (err instanceof Error) {
        if (isFromInput) {
          setFromAmountError(err.message);
        } else {
          setToAmountError(err.message);
        }
      }
      console.error(err);
      return;
    }
  };

  // ========================================================================
  // V3 QUOTE LOGIC (server-side tick-walk; debounced, quotes all fee tiers)
  // ========================================================================
  const calculateV3SwapAmount = useCallback((inputAmount: string, isFromInput: boolean) => {
    if (!fromAsset?.address || !toAsset?.address || v3PairPools.length === 0) return;
    if (!isValidInputAmount(inputAmount)) return;

    if (v3QuoteTimerRef.current) clearTimeout(v3QuoteTimerRef.current);
    v3QuoteAbortRef.current?.abort();

    v3QuoteTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      v3QuoteAbortRef.current = controller;
      setV3QuoteLoading(true);
      try {
        const wei = safeParseUnits(inputAmount);
        if (wei === 0n) return;
        // positive = exact input (editing "from"), negative = exact output (editing "to")
        const amountSpecified = isFromInput ? wei.toString() : (-wei).toString();

        const results = await Promise.all(
          v3PairPools.map(p =>
            quoteV3(p.address, p.token0.address === fromAsset.address, amountSpecified, controller.signal)
              .then((q) => [p.address, q] as const)
          )
        );
        if (controller.signal.aborted) return;

        // Store every tier's quote; the user chooses which to trade (no auto-optimization).
        const quoteMap: Record<string, PoolV3Quote | null> = {};
        for (const [addr, q] of results) quoteMap[addr] = q;
        setV3Quotes(quoteMap);

        // Keep the current selection; default to the first listed tier only if none is set yet.
        const activeAddr =
          selectedV3PoolAddress && v3PairPools.some((p) => p.address === selectedV3PoolAddress)
            ? selectedV3PoolAddress
            : v3PairPools[0].address;
        if (activeAddr !== selectedV3PoolAddress) setSelectedV3PoolAddress(activeAddr);

        // Drive the headline amount off the selected tier's quote.
        const activePool = v3PairPools.find((p) => p.address === activeAddr)!;
        const activeQuote = quoteMap[activeAddr] ?? null;
        if (activeQuote) {
          const zeroForOne = activePool.token0.address === fromAsset.address;
          const toPoolBal = zeroForOne ? activePool.token1Balance : activePool.token0Balance;
          if (isFromInput) {
            handleAmountInputChange(formatUnits(activeQuote.amountOut), setToAmount, setToAmountError, toPoolBal);
          } else {
            handleAmountInputChange(formatUnits(activeQuote.amountIn), setFromAmount, setFromAmountError, fromAssetAvailableBalance);
          }
        } else if (isFromInput) {
          setToAmount("");
        } else {
          setFromAmount("");
        }
      } catch (err) {
        if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') console.error(err);
      } finally {
        if (!v3QuoteAbortRef.current?.signal.aborted || v3QuoteAbortRef.current === controller) {
          setV3QuoteLoading(false);
        }
      }
    }, 350);
  }, [fromAsset?.address, toAsset?.address, v3PairPools, quoteV3, selectedV3PoolAddress, fromAssetAvailableBalance]);

  // ========================================================================
  // EVENT HANDLERS
  // ========================================================================
  const handleAmountChange = (isFromInput: boolean, value: string) => {
    setEditingField(isFromInput ? 'from' : 'to');
    if (isFromInput) {
      handleAmountInputChange(value, setFromAmount, setFromAmountError, fromAssetAvailableBalance);
      // Calculate swap amount immediately
      if (isValidInputAmount(value) && fromAsset && toAsset) {
        if (isV3) calculateV3SwapAmount(value, true);
        else if (pool) calculateSwapAmount(value, true);
      }
    } else {
      handleAmountInputChange(value, setToAmount, setToAmountError, isV3 ? v3ToPoolBalance : (toAsset?.poolBalance || "0"));
      // Calculate swap amount immediately
      if (isValidInputAmount(value) && fromAsset && toAsset) {
        if (isV3) calculateV3SwapAmount(value, false);
        else if (pool) calculateSwapAmount(value, false);
      }
    }
  };

  const handleVenueChange = (venue: 'v2' | 'v3') => {
    if (venue === swapVenue) return;
    setSwapVenue(venue);
    setV3Quotes({});
    setSelectedV3PoolAddress(null);
    // Recompute the passive side for the new venue from the last edited amount
    if (editingField === 'from' && isValidInputAmount(fromAmount)) {
      if (venue === 'v3') calculateV3SwapAmount(fromAmount, true);
      else if (pool) calculateSwapAmount(fromAmount, true);
      else setToAmount("");
    } else if (editingField === 'to' && isValidInputAmount(toAmount)) {
      if (venue === 'v3') calculateV3SwapAmount(toAmount, false);
      else if (pool) calculateSwapAmount(toAmount, false);
      else setFromAmount("");
    }
  };

  // User selects which fee tier to trade against (no auto-optimization). Re-derives the
  // passive amount from the already-fetched quote for that tier — no new fetch.
  const selectV3Pool = (address: string) => {
    setSelectedV3PoolAddress(address);
    const p = v3PairPools.find((x) => x.address === address);
    const q = v3Quotes[address];
    if (!p || !q || !fromAsset) return;
    const isFromInput = editingField !== 'to';
    const zeroForOne = p.token0.address === fromAsset.address;
    const toPoolBal = zeroForOne ? p.token1Balance : p.token0Balance;
    if (isFromInput) {
      handleAmountInputChange(formatUnits(q.amountOut), setToAmount, setToAmountError, toPoolBal);
    } else {
      handleAmountInputChange(formatUnits(q.amountIn), setFromAmount, setFromAmountError, fromAssetAvailableBalance);
    }
  };

  const handleSwapAssets = async () => {
    // swap amounts
    const prevFrom = fromAsset;
    const prevTo = toAsset;
    const prevFromAmount = fromAmount;
    const prevToAmount = toAmount;

    const newFrom = prevTo;
    const newTo = prevFrom;

    // Set new assets first
    setFromAsset(newFrom);
    setToAsset(newTo);
    setEditingField(editingField === 'from' ? 'to' : editingField === 'to' ? 'from' : null);

    // Then validate amounts against the NEW assets' balances
    // prevToAmount becomes the new from amount, validate against newFrom's balance
    handleAmountInputChange(prevToAmount, setFromAmount, setFromAmountError, newFrom?.balance || "0");
    // prevFromAmount becomes the new to amount, validate against newTo's pool balance
    handleAmountInputChange(prevFromAmount, setToAmount, setToAmountError, newTo?.poolBalance || "0");

    if (!newFrom?.address) return;

    const nextPairables = await fetchPairableTokens(newFrom.address); // <-- fresh list
    // Always re-set toAsset after fetch to override any stale effect that ran during the await
    if (nextPairables.length > 0) {
      const newToAddress = newTo?.address?.toLowerCase();
      const validNewTo = nextPairables.find(t => t.address?.toLowerCase() === newToAddress);
      setToAsset(validNewTo || nextPairables[0]);
    }
  };

  const handleSwap = async () => {
    if (!fromAsset || !toAsset) return;
    if (isV3 ? !v3ExecPool : !pool) return;

    try {
      if (!fromAmount || isNaN(Number(fromAmount)) || toAmountMinWei === 0n) {
        throw new Error("Invalid amount values");
      }

      if (isV3) {
        // always executed as exact input; the slippage floor maps to amountLimit
        await swapV3({
          poolAddress: v3ExecPool!.address,
          zeroForOne: v3ZeroForOne,
          amountSpecified: safeParseUnits(fromAmount).toString(),
          amountLimit: toAmountMinWei.toString(),
        });
      } else if (isMultiToken) {
        await swapMultiToken({
          poolAddress: pool.address,
          tokenIn: fromAsset.address,
          tokenOut: toAsset.address,
          amountIn: safeParseUnits(fromAmount).toString(),
          minAmountOut: toAmountMinWei.toString(),
        });
      } else {
        const isAToB = pool.tokenA?.address === fromAsset.address;
        await swap({
          poolAddress: pool.address,
          isAToB,
          amountIn: safeParseUnits(fromAmount).toString(),
          minAmountOut: toAmountMinWei.toString(),
        });
      }

      toast({
        title: "Success",
        description: `Traded ${fromAmount} ${fromAsset._symbol} for ${toAmount} ${toAsset._symbol}`,
        variant: "success",
      });
    } finally {
      // Always refresh and reset regardless of success or failure
      setIsDialogOpen(false);
      setFromAmount('');
      setToAmount('');
      setFromAmountError('');
      setToAmountError('');
      setMaxTransferableError('');
      setEditingField(null);
      setV3Quotes({});
      setSelectedV3PoolAddress(null);

      if (!isV3) await refreshSwapHistory()
      // Refresh all contexts to ensure borrow page shows updated balances
      await Promise.all([
        fetchUsdstBalance(),
        fetchTokens(),           // Refresh UserTokensContext
        refreshLoans(),          // Refresh LendingContext
        refreshCollateral(),     // Refresh LendingContext
        // Refetch pool data to get updated balances and exchange rates
        isV3
          ? fromAsset?.address && toAsset?.address ? getV3PoolsByPair(fromAsset.address, toAsset.address).catch(() => {}) : Promise.resolve()
          : isMultiToken
            ? getPoolByAddress(pool.address).then(p => p && setPool(p))
            : fromAsset?.address && toAsset?.address ? getPoolByTokenPair(fromAsset.address, toAsset.address) : Promise.resolve(),
      ]);
    }
  };

  // ========================================================================
  // VALIDATION HELPERS
  // ========================================================================
  const isSwapDisabled = useCallback(() => {
    // Basic validations
    if (!fromAmount || !toAmount || !fromAsset || !toAsset) {
      return true;
    }

    // Check if there's an error from computeMaxTransferable
    if (maxTransferableError) {
      return true;
    }

    // Check if there's an amount validation error
    if (fromAmountError || toAmountError) {
      return true;
    }

    // V3: wait for a quote before allowing the trade
    if (isV3 && (v3QuoteLoading || !v3Quote)) {
      return true;
    }

    return false;
  }, [fromAmount, toAmount, fromAsset, toAsset, maxTransferableError, fromAmountError, toAmountError, isV3, v3QuoteLoading, v3Quote]);

  const handleMaxClick = useCallback(() => {
    if (!fromAsset) return;
    
    setEditingField('from');
    const formatted = formatUnits(fromAssetAvailableBalance);
    setFromAmount(formatted);
    setFromAmountError('');
    // Calculate swap amount immediately
    if (fromAsset && toAsset) {
      if (isV3) calculateV3SwapAmount(formatted, true);
      else if (pool) calculateSwapAmount(formatted, true);
    }
  }, [fromAsset, toAsset, pool, fromAssetAvailableBalance, isV3, calculateV3SwapAmount]);

  // ========================================================================
  // RENDER
  // ========================================================================
  return (
    <div className="space-y-6">
      {/* Pool version + fee tier selection — shown whenever the pair trades on at least one venue */}
      {(!!pool || v3PairPools.length > 0) && (
        <div className="space-y-3">
          <VenueSelector
            venue={isV3 ? 'v3' : 'v2'}
            onChange={handleVenueChange}
            v2Available={!!pool}
            v3Available={v3PairPools.length > 0}
            disabled={guestMode}
          />
          {isV3 && (
            <FeeTierSelector
              pools={v3PairPools}
              quotes={v3Quotes}
              selectedAddress={v3ExecPool?.address}
              onSelect={selectV3Pool}
              quoteLoading={v3QuoteLoading}
              toSymbol={toAsset?._symbol}
              disabled={guestMode}
            />
          )}
        </div>
      )}

      <TokenInput
        amount={fromAmount}
        userBalanceWei={fromAsset?.balance || "0"}
        poolBalanceWei={isV3 ? v3FromPoolBalance : (fromAsset?.poolBalance || "0")}
        maxAmountWei={fromAssetAvailableBalance}
        onChange={(value) => handleAmountChange(true, value)}
        asset={fromAsset}
        onSelect={(asset) => asset.address !== toAsset?.address && setFromAsset({ ...asset, balance: asset.balance || "0" })}
        tokens={fromOptions}
        isOpen={fromPopoverOpen}
        onOpenChange={setFromPopoverOpen}
        label="From"
        onFocus={() => setEditingField('from')}
        isFromInput={true}
        onMaxClick={() => handleMaxClick()}
        amountError={fromAmountError}
        loading={poolLoading}
        disabled={guestMode}
      />

      <div className="flex justify-center">
        <Button
          onClick={handleSwapAssets}
          variant="outline"
          size="icon"
          className="rounded-full bg-muted hover:bg-muted/80 border-border"
          disabled={guestMode}
        >
          <ArrowDownUp className="h-4 w-4" />
        </Button>
      </div>

      <TokenInput
        amount={toAmount}
        userBalanceWei={toAsset?.balance || "0"}
        poolBalanceWei={isV3 ? v3ToPoolBalance : (toAsset?.poolBalance || "0")}
        maxAmountWei={isV3 ? v3ToPoolBalance : (toAsset?.poolBalance || "0")}
        onChange={(value) => handleAmountChange(false, value)}
        asset={toAsset}
        onSelect={(asset) => asset.address !== fromAsset?.address && setToAsset({ ...asset, balance: asset.balance || "0" })}
        tokens={toOptions}
        isOpen={toPopoverOpen}
        onOpenChange={setToPopoverOpen}
        label="To"
        onFocus={() => setEditingField('to')}
        isFromInput={false}
        onMaxClick={() => {}}
        amountError={toAmountError}
        loading={poolLoading}
        disabled={guestMode}
      />
      {(() => {
        // Find activity by pool address (OneTime swap rewards)
        const activity = userRewards?.activities?.find(
          (a) => a.activity.sourceContract?.toLowerCase() === pool?.address?.toLowerCase()
        );
        if (!activity) return null;

        // Swap rewards are tracked in USD-notional terms via tokenIn price conversion
        // Pass fromAmount (amountIn) and fromAsset address for USD conversion
        return (
          <RewardsWidget
            userRewards={userRewards}
            activityName={activity.activity.name}
            inputAmount={fromAmount}
            swapTokenInAddress={fromAsset?.address}
            actionLabel="Trade"
          />
        );
      })()}

      <div className="flex flex-col gap-3 bg-muted/50 p-3 md:p-4 rounded-lg border border-border">
        {/* Exchange Rate */}
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex flex-col md:flex-row md:justify-between gap-1">
            <span className="text-muted-foreground flex items-center gap-2">
              Exchange Rate
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-semibold">
                {isV3
                  ? `V3${v3ExecPool ? ` · ${v3ExecPool.fee / 10000}%` : ''}`
                  : 'V2'}
              </Badge>
            </span>
            {!exchangeRate ? (
              guestMode ? (
                <span className="font-medium text-foreground text-xs md:text-sm">-</span>
              ) : (
                <LoadingSpinner />
              )
            ) : (
              <span className="font-medium text-foreground text-xs md:text-sm">
                1 {fromAsset?._symbol || ""} ≈ {exchangeRate}{oracleExchangeRate ? ` (${oracleExchangeRate}*)` : ""} {toAsset?._symbol || ""}
              </span>
            )}
          </div>
          {exchangeRate && (
            <>
              <div className="md:text-right">
                <span className="text-muted-foreground/70 text-xs md:text-sm">
                  1 {toAsset?._symbol || ""} ≈ {invertedExchangeRate}{invertedOracleExchangeRate ? ` (${invertedOracleExchangeRate}*)` : ""} {fromAsset?._symbol || ""}
                </span>
              </div>
              {oracleExchangeRate && (
                <div className="md:text-right">
                  <span className="text-xs text-muted-foreground/70">* spot price</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Transaction Fee */}
        <div className="flex flex-col md:flex-row md:justify-between gap-1 text-sm">
          <span className="text-muted-foreground">Transaction Fee</span>
          <span className="font-medium text-xs md:text-sm">{SWAP_FEE} USDST ({parseFloat(SWAP_FEE) * 100} voucher)</span>
        </div>

        {/* Price Impact */}
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-1 text-sm">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Price Impact</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>Difference between the current pool price and your average trade price. Larger trades cause higher impact.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <span className={`font-medium text-xs md:text-sm ${
            priceImpact === null ? 'text-muted-foreground' :
            priceImpact < 1 ? 'text-foreground' :
            priceImpact < 5 ? 'text-yellow-600' :
            'text-red-600'
          }`}>
            {priceImpact === null ? '—' : `${priceImpact.toFixed(2)}% ${priceImpact < 1 ? '(Low)' : priceImpact < 5 ? '(Medium)' : '(High)'}`}
          </span>
        </div>
        {priceImpact !== null && priceImpact >= 5 && (
          <p className="text-yellow-600 text-sm mt-1">
            ⚠️ High price impact — you may receive fewer tokens than expected.
          </p>
        )}
        
        {/* Fee Warnings */}
        {maxTransferableError && (
          <p className="text-yellow-600 text-sm mt-1">
            {maxTransferableError}
          </p>
        )}
        {isLowBalanceWarning && (
          <p className="text-yellow-600 text-sm mt-1">
            Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
          </p>
        )}
        
        <SlippageControl
          slippage={slippage}
          autoSlippage={autoSlippage}
          onSlippageChange={setSlippage}
          onAutoToggle={setAutoSlippage}
          disabled={guestMode}
        />
      </div>

      <Button
        className="w-full bg-strato-blue hover:bg-strato-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={() => setIsDialogOpen(true)}
        disabled={guestMode || isSwapDisabled() || (isV3
          ? (!!v3ExecPool?.isDisabled || !!v3ExecPool?.isPaused)
          : (!!pool?.isDisabled || !!pool?.isPaused))}
      >
        {(isV3 ? v3ExecPool?.isDisabled : pool?.isDisabled)
          ? "This pool is disabled"
          : (isV3 ? v3ExecPool?.isPaused : pool?.isPaused)
            ? "Pool is paused by admin at this time"
            : "Trade Assets"}
      </Button>

      <SwapDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        fromAmount={formatAmount(fromAmount)}
        toAmount={formatAmount(toAmount)}
        fromAsset={fromAsset}
        toAsset={toAsset}
        exchangeRate={exchangeRate}
        invertedExchangeRate={invertedExchangeRate}
        isFractionalRate={isFractionalRate}
        isHighPriceImpact={(priceImpact ?? 0) >= 5}
        toAmountMin={formatAmount(formatUnits(toAmountMinWei))}
        onConfirm={handleSwap}
        isLoading={swapLoading}
      />
    </div>
  );
};

// ============================================================================
// EXPORT
// ============================================================================
export default SwapWidget;

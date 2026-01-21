import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ArrowDownUp, Check, ChevronDown, HelpCircle } from "lucide-react";
import { Pool, SwapToken } from "@/interface";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTokenContext } from "@/context/TokenContext";
import { useLendingContext } from "@/context/LendingContext";
import { useToast } from '@/hooks/use-toast';
import { useSwapContext } from "@/context/SwapContext";
import { Slider } from "@/components/ui/slider";
import { usdstAddress, SWAP_FEE } from "@/lib/constants";
import { setSuppressErrorToasts } from "@/lib/axios";
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
import { calculateSwapOutput, calculateSwapInput, calculateImpact } from "@/helpers/swapCalculations";
import { computeMaxTransferable, handleAmountInputChange } from "@/utils/transferValidation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CompactRewardsDisplay } from "@/components/rewards/CompactRewardsDisplay";
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

const calculateExchangeRates = (pool: Pool | null, fromAsset: SwapToken | null) => {
  if (!pool || !fromAsset?.address) return { 
    exchangeRateRaw: undefined, 
    exchangeRate: undefined, 
    oracleExchangeRate: undefined,
    invertedExchangeRate: undefined,
    invertedOracleExchangeRate: undefined,
    isFractionalRate: false,
    isFractionalOracleRate: false
  };
  
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

const AnimatedNumber = ({ value, isLoading }: { value: string | undefined; isLoading: boolean }) => {
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

  // Show spinner when value is undefined
  if (value === undefined) {
    return <LoadingSpinner />;
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

const TokenSelectorComponent = ({ asset, onSelect, tokens, isOpen, onOpenChange }: TokenSelectorProps) => (
  <Popover open={isOpen} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>
      <Button variant="outline" className="flex items-center gap-1 md:gap-2 justify-between text-xs md:text-sm px-1.5 md:px-3 py-1.5 md:py-2 h-8 md:h-10">
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
                onOpenChange(false);
                onSelect(token);
              }}
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
            onChange={e => onChange(e.target.value)}
            onFocus={onFocus}
            placeholder="0.00"
            inputMode="decimal"
            disabled={toWei(maxAmountWei) === 0n && isFromInput}
            className={`p-1 md:p-2 bg-transparent border-none text-sm md:text-lg font-medium focus:outline-none text-foreground placeholder:text-muted-foreground w-full ${
              amountError ? " border border-red-500 rounded-md" : ""
              } ${(toWei(maxAmountWei) === 0n && isFromInput) ? "opacity-50 cursor-not-allowed" : ""}`}
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
                />
              </span>
              <button
                type="button"
                className={`text-blue-600 text-xs underline ${toWei(maxAmountWei) === 0n ? "opacity-50 cursor-not-allowed" : ""}`}
                onClick={onMaxClick}
                disabled={toWei(maxAmountWei) === 0n}
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
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Confirm Swap</DialogTitle>
        <DialogDescription>
          Please review the details below. Slippage tolerance and fees have already been applied.
        </DialogDescription>
      </DialogHeader>
      <div className="py-4 space-y-4">
        <div className="flex justify-between">
          <span className="text-muted-foreground">You pay:</span>
          <span className="font-semibold">
            {fromAmount} {fromAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">You receive:</span>
          <span className="font-semibold">
            {toAmount} {toAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Minimum received (after slippage):</span>
          <span className="font-semibold">
            {toAmountMin} {toAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Exchange rate:</span>
          <span className="flex flex-col items-end gap-0.5">
            <span className="font-semibold">1 {fromAsset?._symbol || ""} ≈ {exchangeRate} {toAsset?._symbol || ""}</span>
            {invertedExchangeRate && (
              <span className="text-muted-foreground/70">1 {toAsset?._symbol || ""} ≈ {invertedExchangeRate} {fromAsset?._symbol || ""}</span>
            )}
          </span>
        </div>
        {isHighPriceImpact && (
          <div className="text-yellow-600 text-sm mt-2">
            ⚠️ High price impact — you may receive fewer tokens than expected.
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button disabled={isLoading} onClick={onConfirm} className="bg-strato-blue hover:bg-strato-blue/90">
          {isLoading && <LoadingSpinner />} Confirm Swap
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
}

const SlippageControl = ({ slippage, autoSlippage, onSlippageChange, onAutoToggle }: SlippageControlProps) => {
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
              } border-border`}
            onClick={() => {
              onAutoToggle(true);
              onSlippageChange(DEFAULT_SLIPPAGE);
            }}
          >
            Auto
          </button>
          <button
            className={`px-2 md:px-3 py-1 rounded-full text-xs font-medium border ${
              !autoSlippage ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground'
              } border-border`}
            onClick={() => onAutoToggle(false)}
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
            onValueChange={(value) => onSlippageChange(value[0])}
            className="w-full"
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
// MAIN SWAP WIDGET COMPONENT
// ============================================================================
interface SwapWidgetProps {
  userRewards?: UserRewardsData | null;
  rewardsLoading?: boolean;
}

const SwapWidget = ({ userRewards, rewardsLoading }: SwapWidgetProps = {}) => {
  // ========================================================================
  // CONTEXT & HOOKS
  // ========================================================================
  const { swappableTokens, pairableTokens, pairablesLoading, fetchPairableTokens, swap, getPoolByTokenPair, fromAsset, toAsset, pool, poolLoading, loading: swapLoading, setFromAsset, setToAsset, refreshSwapHistory } = useSwapContext();

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

  // ========================================================================
  // COMPUTED VALUES
  // ========================================================================
  
  // Exchange rates (both pool and oracle)
  const { exchangeRateRaw, exchangeRate, oracleExchangeRate, invertedExchangeRate, invertedOracleExchangeRate, isFractionalRate, isFractionalOracleRate } = calculateExchangeRates(pool, fromAsset);

  // Price impact calculation - use raw rate for calculations
  const priceImpact = useMemo(() => {
    return calculateImpact(exchangeRateRaw, fromAmount, toAmount);
  }, [exchangeRateRaw, fromAmount, toAmount]);

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
      // Fetch pool immediately when both assets are selected
      getPoolByTokenPair(fromAsset.address, toAsset.address);
      startPolling();
    } else {
      stopPolling();
    }
  }, [fromAsset?.address, toAsset?.address, getPoolByTokenPair, startPolling, stopPolling]);



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

    // Check if pool has liquidity
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

    // If either pool balance is 0, no liquidity available - don't clear amounts, just don't calculate
    if (BigInt(inputPoolBalance) === 0n || BigInt(outputPoolBalance) === 0n) {
      return;
    }

    try {
      // Validate input before parsing
      if (!isValidInputAmount(inputAmount)) {
        return;
      }

      const parsedValue = safeParseUnits(inputAmount);
      const isAToB = pool.tokenA?.address === fromAsset?.address;

      if (isFromInput) {
        // Forward calculation: input -> output
        const swapAmount = calculateSwapOutput(parsedValue.toString(), pool, isAToB);
        handleAmountInputChange(formatUnits(swapAmount), setToAmount, setToAmountError, toAsset?.poolBalance || "0");
      } else {
        // Reverse calculation: output -> input
        const requiredInput = calculateSwapInput(parsedValue.toString(), pool, isAToB);
        handleAmountInputChange(formatUnits(requiredInput), setFromAmount, setFromAmountError, fromAssetAvailableBalance);
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
  // EVENT HANDLERS
  // ========================================================================
  const handleAmountChange = (isFromInput: boolean, value: string) => {
    setEditingField(isFromInput ? 'from' : 'to');
    if (isFromInput) {
      handleAmountInputChange(value, setFromAmount, setFromAmountError, fromAssetAvailableBalance);
      // Calculate swap amount immediately
      if (isValidInputAmount(value) && fromAsset && toAsset && pool) {
        calculateSwapAmount(value, true);
      }
    } else {
      handleAmountInputChange(value, setToAmount, setToAmountError, toAsset?.poolBalance || "0");
      // Calculate swap amount immediately
      if (isValidInputAmount(value) && fromAsset && toAsset && pool) {
        calculateSwapAmount(value, false);
      }
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
    if (!fromAsset || !toAsset || !pool) return;

    try {
      const isAToB = pool.tokenA?.address === fromAsset.address;

      if (!fromAmount || isNaN(Number(fromAmount)) || toAmountMinWei === 0n) {
        throw new Error("Invalid amount values");
      }

      await swap({
        poolAddress: pool.address,
        isAToB,
        amountIn: safeParseUnits(fromAmount).toString(),
        minAmountOut: toAmountMinWei.toString(),
      });

      toast({
        title: "Success",
        description: `Swapped ${fromAmount} ${fromAsset._symbol} for ${toAmount} ${toAsset._symbol}`,
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

      // Suppress error toasts during background refresh - these are non-critical
      // operations that shouldn't alarm the user if they fail
      setSuppressErrorToasts(true);
      try {
        await refreshSwapHistory()
        // Refresh all contexts to ensure borrow page shows updated balances
        await Promise.all([
          fetchUsdstBalance(),
          fetchTokens(),           // Refresh UserTokensContext
          refreshLoans(),          // Refresh LendingContext
          refreshCollateral(),     // Refresh LendingContext
          // Refetch pool data to get updated balances and exchange rates
          fromAsset?.address && toAsset?.address ? getPoolByTokenPair(fromAsset.address, toAsset.address) : Promise.resolve(),
        ]);
      } catch {
        // Silently ignore refresh errors - the swap already succeeded
      } finally {
        setSuppressErrorToasts(false);
      }
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

    return false;
  }, [fromAmount, toAmount, fromAsset, toAsset, maxTransferableError, fromAmountError, toAmountError]);

  const handleMaxClick = useCallback(() => {
    if (!fromAsset) return;
    
    setEditingField('from');
    const formatted = formatUnits(fromAssetAvailableBalance);
    setFromAmount(formatted);
    setFromAmountError('');
    // Calculate swap amount immediately
    if (fromAsset && toAsset && pool) {
      calculateSwapAmount(formatted, true);
    }
  }, [fromAsset, toAsset, pool, fromAssetAvailableBalance]);

  // ========================================================================
  // RENDER
  // ========================================================================
  return (
    <div className="space-y-6">
      <TokenInput
        amount={fromAmount}
        userBalanceWei={fromAsset?.balance || "0"}
        poolBalanceWei={fromAsset?.poolBalance || "0"}
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
      />

      <div className="flex justify-center">
        <Button
          onClick={handleSwapAssets}
          variant="outline"
          size="icon"
          className="rounded-full bg-muted hover:bg-muted/80 border-border"
        >
          <ArrowDownUp className="h-4 w-4" />
        </Button>
      </div>

      <TokenInput
        amount={toAmount}
        userBalanceWei={toAsset?.balance || "0"}
        poolBalanceWei={toAsset?.poolBalance || "0"}
        maxAmountWei={toAsset?.poolBalance || "0"}
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
      />
      {(() => {
        // Find activity by pool address (OneTime swap rewards)
        const activity = userRewards?.activities?.find(
          (a) => a.activity.sourceContract?.toLowerCase() === pool?.address?.toLowerCase()
        );
        if (!activity) return null;

        // Swap rewards are tracked in USDST terms, so use the USDST side of the swap
        const isFromUsdst = fromAsset?.address?.toLowerCase() === usdstAddress.toLowerCase();
        const inputAmount = isFromUsdst ? fromAmount : toAmount;

        return (
          <CompactRewardsDisplay
            userRewards={userRewards}
            activityName={activity.activity.name}
            inputAmount={inputAmount}
            actionLabel="Swap"
          />
        );
      })()}

      <div className="flex flex-col gap-3 bg-muted/50 p-3 md:p-4 rounded-lg border border-border">
        {/* Exchange Rate */}
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex flex-col md:flex-row md:justify-between gap-1">
            <span className="text-muted-foreground">Exchange Rate</span>
            {!exchangeRate ? (
              <LoadingSpinner />
            ) : (
              <span className="font-medium text-foreground text-xs md:text-sm">
                1 {fromAsset?._symbol || ""} ≈ {exchangeRate} ({oracleExchangeRate}*) {toAsset?._symbol || ""}
              </span>
            )}
          </div>
          {exchangeRate && (
            <>
              <div className="md:text-right">
                <span className="text-muted-foreground/70 text-xs md:text-sm">
                  1 {toAsset?._symbol || ""} ≈ {invertedExchangeRate} ({invertedOracleExchangeRate}*) {fromAsset?._symbol || ""}
                </span>
              </div>
              <div className="md:text-right">
                <span className="text-xs text-muted-foreground/70">* spot price</span>
              </div>
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
        />
      </div>

      <Button
        className="w-full bg-strato-blue hover:bg-strato-blue/90"
        onClick={() => setIsDialogOpen(true)}
        disabled={isSwapDisabled()}
      >
        Swap Assets
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

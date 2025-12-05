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
    oracleExchangeRate: undefined 
  };
  
  const isAToB = pool.tokenA?.address === fromAsset.address;
  const poolRate = isAToB ? pool.aToBRatio : pool.bToARatio;
  const oracleRate = isAToB ? pool.oracleAToBRatio : pool.oracleBToARatio;
  
  // Strip commas from raw rate in case backend sends pre-formatted data
  const cleanRate = poolRate && poolRate !== "0" ? String(poolRate).replace(/,/g, '') : undefined;
  
  return {
    exchangeRateRaw: cleanRate,
    exchangeRate: poolRate && poolRate !== "0" ? formatAmount(poolRate) : undefined,
    oracleExchangeRate: oracleRate && oracleRate !== "0" ? formatAmount(oracleRate) : undefined
  };
};

/**
 * Get activity name for swap rewards based on asset symbol/name
 * Maps to activityType 1 (OneTime) swap activities
 */
const getSwapActivityName = (asset: SwapToken | null | undefined): string | null => {
  if (!asset) return null;
  
  const symbol = asset._symbol?.toUpperCase() || "";
  const name = asset._name?.toUpperCase() || "";
  
  // Check by symbol or name
  if (symbol.includes("ETHST") || name.includes("ETHST")) return "ETHST-USDST Swap";
  if (symbol.includes("WBTCST") || name.includes("WBTCST")) return "WBTCST-USDST Swap";
  if (symbol.includes("GOLDST") || name.includes("GOLDST")) return "GOLDST-USDST Swap";
  if (symbol.includes("SILVST") || name.includes("SILVST")) return "SILVST-USDST Swap";
  
  return null;
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

  return (
    <span 
      className={`transition-opacity duration-200 ${isChanging ? 'opacity-70' : 'opacity-100'}`}
    >
      {displayValue}
    </span>
  );
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
      <Button variant="outline" className="flex items-center gap-2 justify-between text-sm px-3 py-2">
        <div className="flex items-center gap-2">
          {asset ? <TokenAvatar token={asset} /> : null}
          <span className="whitespace-nowrap">{asset?._symbol || "Select Token"}</span>
        </div>
        <ChevronDown className="h-4 w-4 flex-shrink-0" />
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-56 max-w-[calc(100vw-2rem)] p-0" align="end">
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
    <div className="bg-gray-50 p-4 rounded-lg">
      <div className="flex flex-col sm:flex-row sm:justify-between mb-2">
        <label className="text-sm text-gray-600 font-semibold">{label}</label>
        {isFromInput && (
          <span className={`text-sm mt-1 sm:mt-0 flex gap-1 ${
            toWei(maxAmountWei) === 0n ? "text-red-600" : "text-gray-600"
          }`}>
            Available for swap: <AnimatedNumber 
              value={maxAmountWei !== "0" ? formatBalance(maxAmountWei, asset?._symbol || "", undefined, 2, 6) : "0"} 
              isLoading={loading} 
            />
            <button
              type="button"
              className={`text-blue-600 text-xs ml-2 underline ${toWei(maxAmountWei) === 0n ? "opacity-50 cursor-not-allowed" : ""}`}
              onClick={onMaxClick}
              disabled={toWei(maxAmountWei) === 0n}
            >
              Max
            </button>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex flex-col">
          <input
            type="text"
            value={amount}
            onChange={e => onChange(e.target.value)}
            onFocus={onFocus}
            placeholder="0.00"
            inputMode="decimal"
            disabled={toWei(maxAmountWei) === 0n && isFromInput}
            className={`p-2 bg-transparent border-none text-lg font-medium focus:outline-none${
              amountError ? " border border-red-500 rounded-md" : ""
              } ${(toWei(maxAmountWei) === 0n && isFromInput) ? "opacity-50 cursor-not-allowed" : ""}`}
          />
          {amountError && (
            <p className="text-red-600 text-sm mt-1">{amountError}</p>
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
        <div className="mt-2 flex justify-between">
          <span className="text-sm text-gray-500">
            User Balance: <AnimatedNumber 
              value={userBalanceWei !== "0" ? formatBalance(userBalanceWei, asset._symbol || "", undefined, 2, 6) : "0"} 
              isLoading={loading} 
            />
          </span>
          <span className="text-sm text-gray-500">
            Pool Balance: <AnimatedNumber 
              value={poolBalanceWei !== "0" ? formatBalance(poolBalanceWei, asset._symbol || "", undefined, 2, 6) : "0"} 
              isLoading={loading} 
            />
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
  exchangeRate: string;
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
          <span className="text-gray-600">You pay:</span>
          <span className="font-semibold">
            {fromAmount} {fromAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">You receive:</span>
          <span className="font-semibold">
            {toAmount} {toAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Minimum received (after slippage):</span>
          <span className="font-semibold">
            {toAmountMin} {toAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Exchange rate:</span>
          <span>
            1 {fromAsset?._symbol || ""} ≈ {exchangeRate} {toAsset?._symbol || ""}
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
    : 'border-gray-300 text-gray-700';

  return (
    <div className="flex flex-col gap-1 mt-2">
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-600">Max slippage</span>
        <div className="flex items-center gap-2">
          <button
            className={`px-3 py-1 rounded-full text-xs font-medium border ${
              autoSlippage ? 'bg-gray-200 text-gray-700' : 'bg-transparent text-gray-500'
              } border-gray-300`}
            onClick={() => {
              onAutoToggle(true);
              onSlippageChange(DEFAULT_SLIPPAGE);
            }}
          >
            Auto
          </button>
          <button
            className={`px-3 py-1 rounded-full text-xs font-medium border ${
              !autoSlippage ? 'bg-gray-200 text-gray-700' : 'bg-transparent text-gray-500'
              } border-gray-300`}
            onClick={() => onAutoToggle(false)}
          >
            Manual
          </button>
          <span className={`ml-2 px-3 py-1 rounded-full border text-xs font-semibold ${slippageClass}`}>
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
  const { swappableTokens, pairableTokens, fetchPairableTokens, swap, getPoolByTokenPair, fromAsset, toAsset, pool, poolLoading, loading: swapLoading, setFromAsset, setToAsset, refreshSwapHistory } = useSwapContext();

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
  const { exchangeRateRaw, exchangeRate, oracleExchangeRate } = calculateExchangeRates(pool, fromAsset);

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
    if (toAsset && toOptions.some(t => t.address === toAsset.address)) return;
    if (toOptions.length) setToAsset(toOptions[0]);
  }, [fromAsset?.address, toOptions, toAsset?.address]);

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
    if (nextPairables.length > 0 && !nextPairables.some(t => t.address === newTo?.address)) {
      setToAsset(nextPairables[0]); // or undefined
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
          className="rounded-full bg-gray-100"
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
        // Activity name is based on pair type, so check either token
        const activityName = getSwapActivityName(fromAsset) || getSwapActivityName(toAsset);
        if (!activityName) return null;
        
        // Use amount from the reward-eligible token
        const rewardEligibleToken = getSwapActivityName(fromAsset) ? fromAsset : toAsset;
        const inputAmount = rewardEligibleToken === fromAsset ? fromAmount : toAmount;
        
        return (
          <div className="bg-gray-50 p-4 rounded-lg">
            <CompactRewardsDisplay
              userRewards={userRewards}
              activityName={activityName}
              inputAmount={inputAmount}
            />
          </div>
        );
      })()}

      <div className="flex flex-col gap-2 bg-gray-50 p-4 rounded-lg">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600 decoration-2">Exchange Rate</span>
          <span className="font-medium inline-flex items-center gap-1">
            1 {fromAsset?._symbol || ""} ≈ <AnimatedNumber value={exchangeRate} isLoading={poolLoading} /> {toAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Exchange Rate (Spot)</span>
          <span className="font-medium text-gray-400 inline-flex items-center gap-1">
            1 {fromAsset?._symbol || ""} ≈ <AnimatedNumber value={oracleExchangeRate} isLoading={poolLoading} /> {toAsset?._symbol || ""}
          </span>
        </div>
        <div className="my-1"></div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Transaction Fee</span>
          <span className="font-medium">{SWAP_FEE} USDST ({parseFloat(SWAP_FEE) * 100} voucher)</span>
        </div>
        
        <div className="flex justify-between text-sm items-center">
          <div className="flex items-center gap-1">
            <span className="text-gray-600">Price Impact</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>Difference between the current pool price and your average trade price. Larger trades cause higher impact.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <span className={`font-medium ${
            priceImpact === null ? 'text-gray-400' :
            priceImpact < 1 ? 'text-gray-700' :
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

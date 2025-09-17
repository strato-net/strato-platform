import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ArrowDownUp, Check, ChevronDown } from "lucide-react";
import { LiquidityPool, SwappableToken } from "@/interface";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useLendingContext } from "@/context/LendingContext";
import { useToast } from '@/hooks/use-toast';
import { useSwapContext } from "@/context/SwapContext";
import { Slider } from "@/components/ui/slider";
import { usdstAddress, SWAP_FEE } from "@/lib/constants";
import { safeParseUnits, formatBalance, formatAmount, formatWeiAmountDisplay, formatUnits } from "@/utils/numberUtils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePoolPolling } from "@/hooks/useSmartPolling";
import { calculateSwapOutput, calculateSwapInput } from "@/helpers/swapCalculations";

// ============================================================================
// CONSTANTS
// ============================================================================
const DEFAULT_SLIPPAGE = 4; // 4%
const POLL_INTERVAL = 10000; // 10 seconds
const DECIMALS = 18;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const isValidInputAmount = (amount: string): boolean => {
  return amount && amount !== "." && amount !== "0." && !isNaN(Number(amount));
};

const calculateExchangeRates = (pool: LiquidityPool | null, fromAsset: SwappableToken | null) => {
  if (!pool || !fromAsset?.address) return { exchangeRate: "0", oracleExchangeRate: "0" };
  
  const isAToB = pool.tokenA?.address === fromAsset.address;
  const poolRate = isAToB ? pool.aToBRatio : pool.bToARatio;
  const oracleRate = isAToB ? pool.oracleAToBRatio : pool.oracleBToARatio;
  
  return {
    exchangeRate: poolRate && poolRate !== "0" ? formatAmount(poolRate) : "0",
    oracleExchangeRate: oracleRate && oracleRate !== "0" ? formatAmount(oracleRate) : "0"
  };
};

// ============================================================================
// UI COMPONENTS
// ============================================================================
const LoadingSpinner = () => (
  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary" />
);

const AnimatedNumber = ({ value, isLoading }: { value: string; isLoading: boolean }) => {
  const [displayValue, setDisplayValue] = useState(value);
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    if (isLoading) {
      // Don't fade out during loading, just keep showing current value
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
  asset?: SwappableToken;
  onSelect: (asset: SwappableToken) => void;
  tokens: SwappableToken[];
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
  onChange: (value: string) => void;
  asset?: SwappableToken;
  wrongAmount: boolean;
  onSelect: (asset: SwappableToken) => void;
  tokens: SwappableToken[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  onFocus: () => void;
  isFromInput: boolean;
  pool: LiquidityPool;
  poolLoading: boolean;
  showMaxButton: boolean;
  onMaxClick: () => void;
  disabled?: boolean;
}

const TokenInput = ({
  amount,
  onChange,
  asset,
  wrongAmount,
  onSelect,
  tokens,
  isOpen,
  onOpenChange,
  label,
  onFocus,
  isFromInput,
  pool,
  poolLoading,
  showMaxButton,
  onMaxClick,
  disabled = false
}: TokenInputProps) => {
  
  // Get pool balance
  const poolBalance = useMemo(() => {
    if (!pool || !asset) return "0";
    return pool.tokenA?.address === asset.address
      ? pool.tokenABalance || "0"
      : pool.tokenB?.address === asset.address
        ? pool.tokenBBalance || "0"
        : "0";
  }, [pool, asset?.address]);
      
  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      <div className="flex flex-col sm:flex-row sm:justify-between mb-2">
        <label className="text-sm text-gray-600 font-semibold">{label}</label>
        <span className={`text-sm mt-1 sm:mt-0 flex gap-1 ${(() => {
          let balance = asset?.balance || "0";
          if (asset?.address === usdstAddress && isFromInput) {
            const fee = safeParseUnits(SWAP_FEE, DECIMALS);
            const balanceBigInt = BigInt(balance);
            balance = (balanceBigInt > fee ? balanceBigInt - fee : 0n).toString();
          }
          return BigInt(balance) === 0n && isFromInput ? "text-red-600" : "text-gray-600";
        })()}`}>
          User Balance: {(() => {
            let balance = asset?.balance || "0";
            if (asset?.address === usdstAddress && isFromInput) {
              const fee = safeParseUnits(SWAP_FEE, DECIMALS);
              const balanceBigInt = BigInt(balance);
              balance = (balanceBigInt > fee ? balanceBigInt - fee : 0n).toString();
            }
            return formatBalance(balance, asset?._symbol || "", DECIMALS, 2, 6);
          })()}
          {showMaxButton && (
            <button
              type="button"
              className="text-blue-600 text-xs ml-2 underline"
              onClick={onMaxClick}
            >
              Max
            </button>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex flex-col">
          <input
            type="text"
            value={amount}
            onChange={(e) => {
              const value = e.target.value;
              if (value === '' || /^\d*\.?\d{0,18}$/.test(value)) {
                onChange(value);
              }
            }}
            onFocus={onFocus}
            placeholder="0.00"
            inputMode="decimal"
            disabled={disabled}
            className={`p-2 bg-transparent border-none text-lg font-medium focus:outline-none${
              wrongAmount ? " border border-red-500 rounded-md" : ""
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          />
          {wrongAmount && (
            <p className="text-red-600 text-sm mt-1">Insufficient user balance</p>
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
        <div className="mt-2 flex justify-end">
          <span className="text-sm text-gray-500">
            Pool Balance: <AnimatedNumber 
              value={pool && poolBalance !== "0" ? formatBalance(poolBalance, asset._symbol || "") : "0"} 
              isLoading={poolLoading} 
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
  fromAsset?: SwappableToken;
  toAsset?: SwappableToken;
  exchangeRate: string;
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
  onConfirm,
  isLoading
}: SwapDialogProps) => (
  <Dialog open={isOpen} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Confirm Swap</DialogTitle>
        <DialogDescription>
          Please review your transaction details before confirming.
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
          <span className="text-gray-600">Exchange rate:</span>
          <span>
            1 {fromAsset?._symbol || ""} ≈ {exchangeRate} {toAsset?._symbol || ""}
          </span>
        </div>
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
const SwapWidget = () => {
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
  const { usdstBalance, fetchUsdstBalance, fetchTokens } = useUserTokens();
  const { refreshLoans, refreshCollateral } = useLendingContext();
  const { toast } = useToast();

  // ========================================================================
  // STATE
  // ========================================================================
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [fromPopoverOpen, setFromPopoverOpen] = useState(false);
  const [toPopoverOpen, setToPopoverOpen] = useState(false);
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [autoSlippage, setAutoSlippage] = useState(true);
  const [editingField, setEditingField] = useState<'from' | 'to' | null>(null);

  // ========================================================================
  // COMPUTED VALUES
  // ========================================================================
  
  // Exchange rates (both pool and oracle)
  const { exchangeRate, oracleExchangeRate } = calculateExchangeRates(pool, fromAsset);

  // Validation states
  const wrongAmount = fromAmount && fromAsset ? (() => {
    const fromAmountWei = safeParseUnits(fromAmount, DECIMALS);
    const fromBalance = BigInt(fromAsset.balance?.toString() || "0");
    return fromAmountWei > fromBalance;
  })() : false;


  // ========================================================================
  // REFS & CUSTOM HOOKS
  // ========================================================================

  const { startPolling, stopPolling } = usePoolPolling({
    fromAsset,
    toAsset,
    getPoolByTokenPair,
    interval: POLL_INTERVAL
  });

  // ========================================================================
  // FEE & WARNING LOGIC
  // ========================================================================
  const feeAmount = safeParseUnits(SWAP_FEE, DECIMALS);
  const usdstBalanceBigInt = BigInt(usdstBalance || "0");
  const fromAmountWei = safeParseUnits(fromAmount, DECIMALS);

  const hasInsufficientUsdstForFee = usdstBalanceBigInt <= feeAmount;
  const isLowBalanceWarning = fromAsset?.address === usdstAddress && fromAmountWei > 0n ? (() => {
    const lowBalanceThreshold = safeParseUnits("0.10", DECIMALS);
    const remainingBalance = usdstBalanceBigInt - fromAmountWei - feeAmount;
    return remainingBalance >= 0n && remainingBalance <= lowBalanceThreshold;
  })() : false;

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
    if (userAddress) fetchUsdstBalance(userAddress);
    if (swappableTokens.length > 0) {
      initialTokenSetup();
    }
  }, [userAddress, fetchUsdstBalance, swappableTokens.length]);

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
      ? pool.tokenABalance || "0"
      : pool.tokenB?.address === inputAsset.address
        ? pool.tokenBBalance || "0"
        : "0";

    const outputPoolBalance = pool.tokenA?.address === outputAsset.address
      ? pool.tokenABalance || "0"
      : pool.tokenB?.address === outputAsset.address
        ? pool.tokenBBalance || "0"
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
      const isAToB = pool.tokenA?.address === inputAsset.address;

      if (isFromInput) {
        // Forward calculation: input -> output
        const swapAmount = calculateSwapOutput(parsedValue.toString(), pool, isAToB);
        setToAmount(formatUnits(swapAmount));
      } else {
        // Reverse calculation: output -> input
        const requiredInput = calculateSwapInput(parsedValue.toString(), pool, isAToB);
        setFromAmount(formatUnits(requiredInput));
      }
    } catch (err) {
      // Don't clear amounts on error, just don't calculate
      return;
    }
  };

  // ========================================================================
  // EVENT HANDLERS
  // ========================================================================
  const handleAmountChange = (isFromInput: boolean, value: string) => {
    setEditingField(isFromInput ? 'from' : 'to');
    if (isFromInput) {
      setFromAmount(value);
      // Calculate swap amount immediately
      if (isValidInputAmount(value) && fromAsset && toAsset && pool) {
        calculateSwapAmount(value, true);
      }
    } else {
      setToAmount(value);
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

    let newEditingField: 'from' | 'to' | null = null;

    if (editingField === 'from') {
      newEditingField = 'to';
    } else if (editingField === 'to') {
      newEditingField = 'from';
    }

    const newFrom = prevTo;
    const newTo = prevFrom;

    setFromAmount(prevToAmount);
    setToAmount(prevFromAmount);
    setFromAsset(newFrom);
    setToAsset(newTo);
    setEditingField(editingField === 'from' ? 'to' : editingField === 'to' ? 'from' : null);

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

      // Validate amounts before parsing
      if (!fromAmount || !toAmount || isNaN(Number(fromAmount)) || isNaN(Number(toAmount))) {
        throw new Error("Invalid amount values");
      }

      const toAmountInWei = safeParseUnits(toAmount, DECIMALS);
      const slippageBps = Math.round(slippage * 100);
      const minTokens = (toAmountInWei * BigInt(10000 - slippageBps)) / 10000n;

      await swap({
        poolAddress: pool.address,
        isAToB,
        amountIn: safeParseUnits(fromAmount, DECIMALS).toString(),
        minAmountOut: minTokens.toString(),
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
      setEditingField(null);

      await refreshSwapHistory()
      // Refresh all contexts to ensure borrow page shows updated balances
      await Promise.all([
        fetchUsdstBalance(userAddress),
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
  const getAvailableBalance = (asset: SwappableToken | null) => {
    if (!asset) return 0n;
    let balance = BigInt(asset.balance || "0");
    if (asset.address === usdstAddress) {
      const fee = safeParseUnits(SWAP_FEE, DECIMALS);
      balance = balance > fee ? balance - fee : 0n;
    }
    return balance;
  };

  const isSwapDisabled = () => {
    // Basic validations
    if (!fromAmount || !toAmount || !fromAsset || !toAsset || wrongAmount) {
      return true;
    }

    // Check if user has enough USDST for fee
    if (usdstBalanceBigInt < feeAmount) {
      return true;
    }

    // Check if swapping USDST and leaving enough for fee
    if (fromAsset.address === usdstAddress) {
      // Validate fromAmount before parsing
      if (!fromAmount || isNaN(Number(fromAmount))) {
        return true;
      }
      
      const fromAmountWei = safeParseUnits(fromAmount, DECIMALS);
      const balance = BigInt(fromAsset.balance || "0");

      if (fromAmountWei > balance - feeAmount && fromAmountWei <= balance) {
        return true;
      }
    }

    return false;
  };

  const handleMaxClick = useCallback((isFrom: boolean) => {
    const asset = isFrom ? fromAsset : toAsset;
    if (!asset) return;

    let balance = BigInt(asset.balance || "0");

    if (asset.address === usdstAddress) {
      const fee = safeParseUnits(SWAP_FEE, DECIMALS);
      balance = balance > fee ? balance - fee : 0n;
    }

    const formatted = formatUnits(balance, DECIMALS);
    setEditingField(isFrom ? 'from' : 'to');
    if (isFrom) {
      setFromAmount(formatted);
      // Calculate swap amount immediately
      if (isValidInputAmount(formatted) && fromAsset && toAsset && pool) {
        calculateSwapAmount(formatted, true);
      }
    } else {
      setToAmount(formatted);
      // Calculate swap amount immediately
      if (isValidInputAmount(formatted) && fromAsset && toAsset && pool) {
        calculateSwapAmount(formatted, false);
      }
    }
  }, [fromAsset, toAsset, pool]);

  // ========================================================================
  // RENDER
  // ========================================================================
  return (
    <div className="space-y-6">
      <TokenInput
        amount={fromAmount}
        onChange={(value) => handleAmountChange(true, value)}
        asset={fromAsset}
        wrongAmount={wrongAmount}
        onSelect={(asset) => asset.address !== toAsset?.address && setFromAsset({ ...asset, balance: asset.balance || "0" })}
        tokens={fromOptions}
        isOpen={fromPopoverOpen}
        onOpenChange={setFromPopoverOpen}
        label="From"
        onFocus={() => setEditingField('from')}
        isFromInput={true}
        pool={pool}
        poolLoading={poolLoading}
        showMaxButton={getAvailableBalance(fromAsset) > 0n}
        onMaxClick={() => handleMaxClick(true)}
        disabled={getAvailableBalance(fromAsset) === 0n}
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
        onChange={(value) => handleAmountChange(false, value)}
        asset={toAsset}
        wrongAmount={false}
        onSelect={(asset) => asset.address !== fromAsset?.address && setToAsset({ ...asset, balance: asset.balance || "0" })}
        tokens={toOptions}
        isOpen={toPopoverOpen}
        onOpenChange={setToPopoverOpen}
        label="To"
        onFocus={() => setEditingField('to')}
        isFromInput={false}
        pool={pool}
        poolLoading={poolLoading}
        showMaxButton={false}
        onMaxClick={() => handleMaxClick(false)}
      />

      <div className="flex flex-col gap-2 bg-gray-50 p-4 rounded-lg">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600 decoration-2">Exchange Rate</span>
          <span className="font-medium">
            1 {fromAsset?._symbol || ""} ≈ <AnimatedNumber value={exchangeRate} isLoading={poolLoading} /> {toAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Exchange Rate (Spot)</span>
          <span className="font-medium text-gray-400">
            {oracleExchangeRate === "0" ? (
              "Price data unavailable"
            ) : (
              <>1 {fromAsset?._symbol || ""} ≈ <AnimatedNumber value={oracleExchangeRate} isLoading={poolLoading} /> {toAsset?._symbol || ""}</>
            )}
          </span>
        </div>
        <div className="my-1"></div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Transaction Fee</span>
          <span className="font-medium">{SWAP_FEE} USDST</span>
        </div>
        
        {/* Fee Warnings */}
        {hasInsufficientUsdstForFee && (
          <p className="text-yellow-600 text-sm mt-1">
            Insufficient USDST balance for transaction fee ({SWAP_FEE} USDST)
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
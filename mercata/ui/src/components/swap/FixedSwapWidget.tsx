import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ArrowDownUp, HelpCircle } from "lucide-react";
import { Pool, SwapToken } from "@/interface";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTokenContext } from "@/context/TokenContext";
import { useLendingContext } from "@/context/LendingContext";
import { useToast } from '@/hooks/use-toast';
import { useSwapContext } from "@/context/SwapContext";
import { Slider } from "@/components/ui/slider";
import { usdstAddress, SWAP_FEE } from "@/lib/constants";
import { safeParseUnits, formatBalance, formatAmount, formatUnits } from "@/utils/numberUtils";
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

const TokenInputDisplay = ({
  amount,
  asset,
  label,
  userBalanceWei,
  poolBalanceWei,
  maxAmountWei,
  onAmountChange,
  onMaxClick,
  amountError,
  loading,
  isFromInput,
}: {
  amount: string;
  asset: SwapToken | null;
  label: string;
  userBalanceWei: string;
  poolBalanceWei: string;
  maxAmountWei: string;
  onAmountChange: (value: string) => void;
  onMaxClick?: () => void;
  amountError: string;
  loading: boolean;
  isFromInput: boolean;
}) => {
  const formattedBalance = useMemo(() => {
    if (!asset) return "0.00";
    return formatBalance(userBalanceWei, asset.decimals || 18);
  }, [userBalanceWei, asset]);

  const formattedPoolBalance = useMemo(() => {
    if (!asset) return "0.00";
    return formatBalance(poolBalanceWei, asset.decimals || 18);
  }, [poolBalanceWei, asset]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-muted-foreground">{label}</label>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Balance: {formattedBalance}</span>
          {isFromInput && onMaxClick && (
            <button
              onClick={onMaxClick}
              className="text-primary hover:underline"
            >
              Max
            </button>
          )}
        </div>
      </div>
      <div className="relative">
        <div className="flex items-center gap-2 p-3 border border-border rounded-lg bg-background">
          <div className="flex-1">
            <input
              type="text"
              value={amount}
              onChange={(e) => {
                const value = e.target.value;
                onAmountChange(value);
              }}
              placeholder="0.00"
              inputMode="decimal"
              className="w-full bg-transparent text-lg font-semibold outline-none focus:outline-none"
              autoComplete="off"
            />
            {amountError && (
              <p className="text-red-500 text-xs mt-1">{amountError}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {asset && (
              <div className="flex items-center gap-2">
              <span className="font-semibold">{asset._symbol || asset.symbol}</span>
            </div>
            )}
          </div>
        </div>
      </div>
      {!isFromInput && formattedPoolBalance !== "0.00" && (
        <p className="text-xs text-muted-foreground">
          Pool liquidity: {formattedPoolBalance}
        </p>
      )}
    </div>
  );
};

const SlippageControl = ({
  slippage,
  autoSlippage,
  onSlippageChange,
  onAutoToggle,
}: {
  slippage: number;
  autoSlippage: boolean;
  onSlippageChange: (value: number) => void;
  onAutoToggle: (value: boolean) => void;
}) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Slippage Tolerance</span>
          <Tooltip>
            <TooltipTrigger>
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Maximum acceptable price difference between expected and actual swap price</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onAutoToggle(!autoSlippage)}
            className={`text-xs px-2 py-1 rounded ${
              autoSlippage ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}
          >
            Auto
          </button>
          {!autoSlippage && (
            <input
              type="number"
              value={slippage}
              onChange={(e) => onSlippageChange(parseFloat(e.target.value) || 0)}
              min="0"
              max="50"
              step="0.1"
              className="w-16 px-2 py-1 text-xs border rounded bg-background"
            />
          )}
          <span className="text-xs text-muted-foreground">%</span>
        </div>
      </div>
      {!autoSlippage && (
        <Slider
          value={[slippage]}
          onValueChange={([value]) => onSlippageChange(value)}
          min={0}
          max={50}
          step={0.1}
          className="w-full"
        />
      )}
    </div>
  );
};

interface SwapDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  fromAmount: string;
  toAmount: string;
  fromAsset: SwapToken | null;
  toAsset: SwapToken | null;
  exchangeRate: string | undefined;
  invertedExchangeRate: string | undefined;
  isFractionalRate: boolean;
  isHighPriceImpact: boolean;
  toAmountMin: string;
  onConfirm: () => Promise<void>;
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
            ⚠️ Warning: High price impact detected. Consider reducing the swap amount.
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={isLoading}>
          {isLoading ? "Processing..." : "Confirm Swap"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface FixedSwapWidgetProps {
  fromAsset: SwapToken;
  toAsset: SwapToken;
}

const FixedSwapWidget = ({ fromAsset, toAsset }: FixedSwapWidgetProps) => {
  // ========================================================================
  // CONTEXT & HOOKS
  // ========================================================================
  // Only use SwapContext for swap function and pool fetching, not for asset state
  const { swap, getPoolByTokenPair, refreshSwapHistory } = useSwapContext();
  const { userAddress } = useUser();
  const { fetchTokens } = useUserTokens();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useTokenContext();
  const { refreshLoans, refreshCollateral } = useLendingContext();
  const { toast } = useToast();

  // ========================================================================
  // STATE
  // ========================================================================
  const [pool, setPool] = useState<Pool | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [fromAmount, setFromAmount] = useState("");
  const [fromAmountError, setFromAmountError] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [toAmountError, setToAmountError] = useState("");
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [autoSlippage, setAutoSlippage] = useState(true);
  const [editingField, setEditingField] = useState<'from' | 'to' | null>(null);
  const [maxTransferableError, setMaxTransferableError] = useState("");
  const [swapLoading, setSwapLoading] = useState(false);

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

  // Memoized available balance for fromAsset
  const fromAssetAvailableBalance = useMemo(() => {
    if (!fromAsset) return "0";
    return computeMaxTransferable(
      fromAsset.balance || "0",
      fromAsset.address === usdstAddress,
      voucherBalance,
      usdstBalance,
      safeParseUnits(SWAP_FEE).toString(),
      setMaxTransferableError
    );
  }, [fromAsset, voucherBalance, usdstBalance]);

  // ========================================================================
  // REFS & CUSTOM HOOKS
  // ========================================================================

  const { startPolling, stopPolling } = usePoolPolling({
    fromAsset,
    toAsset,
    getPoolByTokenPair: async (tokenA: string, tokenB: string) => {
      const poolData = await getPoolByTokenPair(tokenA, tokenB);
      if (poolData) {
        setPool(poolData);
        // Update asset balances from pool data
        const read = (addr?: string) => {
          if (!addr || !poolData) return { balance: "0", poolBalance: "0", price: "0" };
          const token = poolData.tokenA?.address === addr ? poolData.tokenA : poolData.tokenB?.address === addr ? poolData.tokenB : null;
          return token ? { balance: token.balance || "0", poolBalance: token.poolBalance || "0", price: token.price || "0" } : { balance: "0", poolBalance: "0", price: "0" };
        };
        // Note: We don't update fromAsset/toAsset here since they're props
      }
      return poolData;
    },
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
  
  // Fetch pool when component mounts or assets change
  useEffect(() => {
    if (!fromAsset?.address || !toAsset?.address) return;
    
    const fetchPool = async () => {
      setPoolLoading(true);
      try {
        const poolData = await getPoolByTokenPair(fromAsset.address, toAsset.address);
        if (poolData) {
          setPool(poolData);
        }
      } catch (error) {
        console.error('Failed to fetch pool:', error);
      } finally {
        setPoolLoading(false);
      }
    };

    fetchPool();
    startPolling();
    
    return () => {
      stopPolling();
    };
  }, [fromAsset?.address, toAsset?.address, getPoolByTokenPair, startPolling, stopPolling]);

  // Clear amounts when pool address changes
  useEffect(() => {
    setFromAmount("");
    setToAmount("");
    setEditingField(null);
  }, [pool?.address]);

  // Initial setup
  useEffect(() => {
    fetchUsdstBalance();
  }, [fetchUsdstBalance]);

  // ========================================================================
  // SWAP CALCULATIONS
  // ========================================================================

  const calculateSwapAmount = useCallback((amount: string, isFrom: boolean) => {
    if (!pool || !fromAsset || !toAsset) return;

    // Check if pool has liquidity
    const inputPoolBalance = pool.tokenA?.address === fromAsset.address
      ? pool.tokenA.poolBalance || "0"
      : pool.tokenB?.address === fromAsset.address
        ? pool.tokenB.poolBalance || "0"
        : "0";

    const outputPoolBalance = pool.tokenA?.address === toAsset.address
      ? pool.tokenA.poolBalance || "0"
      : pool.tokenB?.address === toAsset.address
        ? pool.tokenB.poolBalance || "0"
        : "0";

    // If either pool balance is 0, no liquidity available
    if (BigInt(inputPoolBalance) === 0n || BigInt(outputPoolBalance) === 0n) {
      return;
    }

    try {
      // Validate input before parsing
      if (!isValidInputAmount(amount)) {
        return;
      }

      const parsedValue = safeParseUnits(amount);
      const isAToB = pool.tokenA?.address === fromAsset.address;

      if (isFrom) {
        // Forward calculation: input -> output
        const swapAmount = calculateSwapOutput(parsedValue.toString(), pool, isAToB);
        const formattedOutput = formatUnits(swapAmount);
        setToAmount(formattedOutput);
        setToAmountError("");
      } else {
        // Reverse calculation: output -> input
        const requiredInput = calculateSwapInput(parsedValue.toString(), pool, isAToB);
        const formattedInput = formatUnits(requiredInput);
        setFromAmount(formattedInput);
        setFromAmountError("");
      }
    } catch (err) {
      // Show the exact error message
      if (err instanceof Error) {
        if (isFrom) {
          setToAmountError(err.message);
        } else {
          setFromAmountError(err.message);
        }
      }
      console.error(err);
    }
  }, [pool, fromAsset, toAsset]);

  const handleAmountChange = useCallback((isFrom: boolean, value: string) => {
    // Clean the input
    const cleanedValue = value.replace(/,/g, "").trim();
    
    if (isFrom) {
      setEditingField('from');
      // Always update the amount immediately - don't let validation block it
      setFromAmount(cleanedValue);
      
      // Then validate separately (this may set errors but won't block the input)
      if (cleanedValue && cleanedValue !== ".") {
        // Do validation but don't let it override the amount we just set
        const basicPattern = /^\d*\.?\d*$/;
        if (!basicPattern.test(cleanedValue)) {
          setFromAmountError("Invalid input format");
        } else {
          // Try to parse and validate
          try {
            const amountWei = safeParseUnits(cleanedValue, fromAsset?.decimals || 18);
            const maxWei = BigInt(fromAssetAvailableBalance || "0");
            if (amountWei <= 0n) {
              setFromAmountError("Amount must be greater than 0");
            } else if (maxWei > 0n && amountWei > maxWei) {
              setFromAmountError("Maximum amount exceeded");
            } else {
              setFromAmountError("");
            }
          } catch {
            setFromAmountError("Invalid number format");
          }
        }
      } else {
        setFromAmountError("");
      }
      
      // Calculate swap amount after a brief delay
      setTimeout(() => {
        if (isValidInputAmount(cleanedValue) && pool) {
          calculateSwapAmount(cleanedValue, true);
        } else if (!cleanedValue || cleanedValue === "") {
          setToAmount("");
        }
      }, 100);
    } else {
      setEditingField('to');
      // Always update the amount immediately - don't let validation block it
      setToAmount(cleanedValue);
      
      // Then validate separately (this may set errors but won't block the input)
      if (cleanedValue && cleanedValue !== ".") {
        // Do validation but don't let it override the amount we just set
        const basicPattern = /^\d*\.?\d*$/;
        if (!basicPattern.test(cleanedValue)) {
          setToAmountError("Invalid input format");
        } else {
          // Try to parse and validate
          try {
            const amountWei = safeParseUnits(cleanedValue, toAsset?.decimals || 18);
            const maxWei = BigInt(toAsset.poolBalance || "0");
            if (amountWei <= 0n) {
              setToAmountError("Amount must be greater than 0");
            } else if (maxWei > 0n && amountWei > maxWei) {
              setToAmountError("Amount exceeds pool liquidity");
            } else {
              setToAmountError("");
            }
          } catch {
            setToAmountError("Invalid number format");
          }
        }
      } else {
        setToAmountError("");
      }
      
      // Calculate swap amount after a brief delay
      setTimeout(() => {
        if (isValidInputAmount(cleanedValue) && pool) {
          calculateSwapAmount(cleanedValue, false);
        } else if (!cleanedValue || cleanedValue === "") {
          setFromAmount("");
        }
      }, 100);
    }
  }, [fromAssetAvailableBalance, toAsset, pool, fromAsset, calculateSwapAmount]);

  // ========================================================================
  // SWAP HANDLERS
  // ========================================================================

  const handleSwap = async () => {
    if (!fromAsset || !toAsset || !pool) return;

    try {
      setSwapLoading(true);
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
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to execute swap",
        variant: "destructive",
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
      setSwapLoading(false);

      await refreshSwapHistory();
      // Refresh all contexts to ensure balances are updated
      await Promise.all([
        fetchUsdstBalance(),
        fetchTokens(),
        refreshLoans(),
        refreshCollateral(),
        fromAsset?.address && toAsset?.address ? getPoolByTokenPair(fromAsset.address, toAsset.address) : Promise.resolve(),
      ]);
    }
  };

  // ========================================================================
  // VALIDATION HELPERS
  // ========================================================================
  const isSwapDisabled = useCallback(() => {
    // Basic validations
    if (!fromAmount || !toAmount || !fromAsset || !toAsset || !pool) {
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
  }, [fromAmount, toAmount, fromAsset, toAsset, pool, maxTransferableError, fromAmountError, toAmountError]);

  const handleMaxClick = useCallback(() => {
    if (!fromAsset || !pool) return;
    
    setEditingField('from');
    const formatted = formatUnits(fromAssetAvailableBalance);
    setFromAmount(formatted);
    setFromAmountError('');
    // Calculate swap amount immediately
    if (isValidInputAmount(formatted)) {
      calculateSwapAmount(formatted, true);
    }
  }, [fromAsset, pool, fromAssetAvailableBalance, calculateSwapAmount]);

  // ========================================================================
  // RENDER
  // ========================================================================
  return (
    <div className="space-y-6">
      <TokenInputDisplay
        amount={fromAmount}
        userBalanceWei={fromAsset?.balance || "0"}
        poolBalanceWei={fromAsset?.poolBalance || "0"}
        maxAmountWei={fromAssetAvailableBalance}
        onAmountChange={(value) => handleAmountChange(true, value)}
        asset={fromAsset}
        onMaxClick={handleMaxClick}
        amountError={fromAmountError}
        loading={poolLoading}
        isFromInput={true}
        label="From"
      />

      <div className="flex justify-center">
        <Button
          onClick={() => {
            // Swap assets (but they're fixed, so this is just for visual feedback)
            // In a fixed widget, we could disable this or make it do nothing
          }}
          variant="outline"
          size="icon"
          className="rounded-full bg-muted hover:bg-muted/80 border-border"
          disabled
        >
          <ArrowDownUp className="h-4 w-4" />
        </Button>
      </div>

      <TokenInputDisplay
        amount={toAmount}
        userBalanceWei={toAsset?.balance || "0"}
        poolBalanceWei={toAsset?.poolBalance || "0"}
        maxAmountWei={toAsset?.poolBalance || "0"}
        onAmountChange={(value) => handleAmountChange(false, value)}
        asset={toAsset}
        amountError={toAmountError}
        loading={poolLoading}
        isFromInput={false}
        label="To"
      />

      <div className="space-y-4 p-4 border border-border rounded-lg bg-muted/50">
        {exchangeRate && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Exchange Rate</span>
            <div className="flex flex-col items-end gap-0.5">
              <span className="font-semibold">
                1 {fromAsset?._symbol || ""} ≈ {exchangeRate} {toAsset?._symbol || ""}
              </span>
              {invertedExchangeRate && (
                <span className="text-muted-foreground/70 text-xs">
                  1 {toAsset?._symbol || ""} ≈ {invertedExchangeRate} {fromAsset?._symbol || ""}
                </span>
              )}
            </div>
          </div>
        )}

        {priceImpact !== null && priceImpact !== undefined && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Price Impact</span>
            <span className={priceImpact >= 5 ? "text-yellow-600 font-semibold" : "font-semibold"}>
              {priceImpact.toFixed(2)}%
            </span>
          </div>
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

export default FixedSwapWidget;

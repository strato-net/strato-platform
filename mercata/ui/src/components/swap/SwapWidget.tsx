import { useEffect, useState, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ArrowDownUp, Check, ChevronDown } from "lucide-react";
import { SwappableToken } from "@/interface";
import { api } from "@/lib/axios";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { formatUnits, parseUnits } from "ethers";
import { useToast } from '@/hooks/use-toast';
import { useSwapContext } from "@/context/SwapContext";
import { Slider } from "@/components/ui/slider";
import { usdstAddress, SWAP_FEE } from "@/lib/contants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Constants
const DEFAULT_SLIPPAGE = 4; // 4%
const POLL_INTERVAL = 10000; // 10 seconds
const DECIMALS = 18;

// Utility functions
const formatAmount = (amount: string): string => {
  if (!amount) return "";
  const value = Number(amount);
  const roundedDown = Math.floor(value * 1000000) / 1000000;
  return roundedDown.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
};

const formatBalance = (balance: string | number | bigint, symbol: string): string => {
  let formatted = formatUnits(BigInt(balance.toString()), DECIMALS);
  if (formatted.includes('.')) {
    formatted = formatted.replace(/(\.\d*?[1-9])0+$/g, '$1').replace(/\.0+$/, '');
  }
  return `${formatted} ${symbol}`;
};

// Components
const LoadingSpinner = () => (
  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary" />
);

interface TokenSelectorProps {
  asset?: SwappableToken;
  onSelect: (asset: SwappableToken) => void;
  tokens: SwappableToken[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const TokenSelector = ({ asset, onSelect, tokens, isOpen, onOpenChange }: TokenSelectorProps) => (
  <Popover open={isOpen} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>
      <Button variant="outline" className="flex items-center gap-2">
        <span>{asset?._symbol || "Select Token"}</span>
        <ChevronDown className="h-4 w-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-56 p-0">
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
              <span>{token._symbol}</span>
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

interface TokenInputProps {
  amount: string;
  onChange: (value: string) => void;
  asset?: SwappableToken;
  balance: string | number;
  isLoading: boolean;
  wrongAmount: boolean;
  insufficientPoolBalance: boolean;
  onSelect: (asset: SwappableToken) => void;
  tokens: SwappableToken[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  onFocus: () => void;
  usdstBalance: string;
  isFromInput: boolean;
  pool: any;
  fromAsset?: any;
}

const TokenInput = ({
  amount,
  onChange,
  asset,
  balance,
  isLoading,
  wrongAmount,
  insufficientPoolBalance,
  onSelect,
  tokens,
  isOpen,
  onOpenChange,
  label,
  onFocus,
  usdstBalance,
  isFromInput,
  pool,
  fromAsset
}: TokenInputProps) => {
  const feeAmount = parseUnits(SWAP_FEE, DECIMALS);
  const usdstBalanceBigInt = BigInt(usdstBalance || "0");
  const inputAmountWei = parseUnits(amount || "0", DECIMALS);

  // Validation checks
  const isUsdstMaxIssue = isFromInput &&
    asset?.address === usdstAddress &&
    inputAmountWei > usdstBalanceBigInt - feeAmount &&
    inputAmountWei <= usdstBalanceBigInt;
    
  const isInsufficientUsdstForFee = useMemo(() => {
    if (
      !isFromInput ||
      !asset ||
      !usdstBalanceBigInt ||
      !feeAmount
    ) return false;

    return (
      asset?.address !== usdstAddress &&
      usdstBalanceBigInt < feeAmount
    );
  }, [isFromInput, asset, usdstBalanceBigInt, feeAmount]);

  // Get pool balance
  const getPoolBalance = () => {
    if (!pool || !asset) return "0";
    return pool.tokenA?.address === asset.address
      ? pool.tokenABalance || "0"
      : pool.tokenB?.address === asset.address
        ? pool.tokenBBalance || "0"
        : "0";
  };

  const poolBalance = getPoolBalance();

  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      <div className="flex justify-between mb-2">
        <label className="text-sm text-gray-600">{label}</label>
        <span className="text-sm text-gray-600">
          User Balance: {isLoading ? <LoadingSpinner /> : formatBalance(balance, asset?._symbol || "")}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <div className="w-full flex flex-col">
          <input
            type="text"
            value={amount}
            onChange={(e) => {
              const value = e.target.value;
              const isEditable =
                isFromInput || (!isFromInput && fromAsset && asset); // fromAsset && toAsset (toAsset = asset here)

              if (!isEditable) return;
              if (value === '' || /^\d*\.?\d{0,18}$/.test(value)) {
                onChange(value);
              }
            }}
            onFocus={onFocus}
            placeholder="0.00"
            inputMode="decimal"
            className={`p-2 bg-transparent border-none text-lg font-medium focus:outline-none${
              wrongAmount ? " border border-red-500 rounded-md" : ""
              }`}
          />
          {wrongAmount && (
            <p className="text-red-600 text-sm mt-1">Insufficient user balance</p>
          )}
          {insufficientPoolBalance && (
            <p className="text-orange-600 text-sm mt-1">Amount exceeds pool balance</p>
          )}
          {isUsdstMaxIssue && (
            <p className="text-yellow-600 text-sm mt-1">
              Insufficient balance for transaction fee ({SWAP_FEE} USDST)
            </p>
          )}
          {isInsufficientUsdstForFee && (
            <p className="text-yellow-600 text-sm mt-1">
              Insufficient USDST balance for transaction fee ({SWAP_FEE} USDST)
            </p>
          )}
        </div>
        <TokenSelector
          asset={asset}
          onSelect={onSelect}
          tokens={tokens}
          isOpen={isOpen}
          onOpenChange={onOpenChange}
        />
      </div>
      {pool && asset && (
        <div className="mt-2 flex justify-end">
          <span className="text-sm text-gray-500">
            Pool Balance: {formatBalance(poolBalance, asset._symbol || "")}
          </span>
        </div>
      )}
    </div>
  );
};

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
        <Button disabled={isLoading} onClick={onConfirm}>
          {isLoading && <LoadingSpinner />} Confirm Swap
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

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

const SwapWidget = () => {
  const { swappableTokens, pairableTokens, fetchPairableTokens, calculateSwap, swap, getPoolByTokenPair } = useSwapContext();
  const { userAddress } = useUser();
  const { usdstBalance, fetchUsdstBalance } = useUserTokens();
  const { toast } = useToast();

  // State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [fromAsset, setFromAsset] = useState<SwappableToken | undefined>();
  const [toAsset, setToAsset] = useState<SwappableToken | undefined>();
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [wrongAmount, setWrongAmount] = useState(false);
  const [insufficientPoolBalance, setInsufficientPoolBalance] = useState(false);
  const [fromPopoverOpen, setFromPopoverOpen] = useState(false);
  const [toPopoverOpen, setToPopoverOpen] = useState(false);
  const [pool, setPool] = useState<any>(null);
  const [exchangeRate, setExchangeRate] = useState("0");
  const [fromBalanceLoading, setFromBalanceLoading] = useState(false);
  const [toBalanceLoading, setToBalanceLoading] = useState(false);
  const [swapLoading, setSwapLoading] = useState(false);
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [autoSlippage, setAutoSlippage] = useState(true);
  const [editingField, setEditingField] = useState<'from' | 'to' | null>(null);

  // Refs
  const swapInputAbortRef = useRef<AbortController | null>(null);
  const lastCalculatedFromRef = useRef<string>("");

  // Fetch USDST balance when user changes
  useEffect(() => {
    if (userAddress) fetchUsdstBalance(userAddress);
  }, [userAddress, fetchUsdstBalance]);

  useEffect(()=>{
    if(swappableTokens){
      initialTokenSetup()
    }
  },[])
  
  const initialTokenSetup = async () => {
    try {
      setFromBalanceLoading(true)
      const res = await api.get(
         `/tokens/balance?address=eq.${swappableTokens[0].address}`
       );
 
       const balance = res?.data?.[0]?.balance || "0";
       setFromAsset({...swappableTokens[0], balance})
       setFromBalanceLoading(false)
    } catch (error) {
      setFromBalanceLoading(false)
      console.log(error);
      
    }
  }
  

  // Fetch pairable tokens when from asset changes
  useEffect(() => {
    if (fromAsset?.address) {
      fetchPairableTokens(fromAsset.address);
    }
  }, [fromAsset?.address, fetchPairableTokens]);

  // Combined effect: fetch pool, update rate, and poll for updates
  useEffect(() => {
    if (!fromAsset?.address || !toAsset?.address) return;

    let isMounted = true;
    let pollInterval: NodeJS.Timeout | null = null;
    let currentRequestId = 0;
    let abortController: AbortController | null = null;

    const fetchAndUpdatePool = async () => {
      const requestId = ++currentRequestId;

      // Abort previous request if still pending
      if (abortController) {
        abortController.abort();
      }
      abortController = new AbortController();

      try {
        const poolData = await getPoolByTokenPair(fromAsset.address, toAsset.address, abortController.signal);

        // Check if this is still the current request
        if (!isMounted || requestId !== currentRequestId) return;

        if (poolData) {
          setPool(poolData);

          // Update exchange rate immediately
          const rate = poolData.tokenA?.address === fromAsset.address
            ? poolData.aToBRatio
            : poolData.bToARatio;
          setExchangeRate(rate || "0");

          // Recalculate if not actively editing and we have a preserved amount
          if (fromAmount && fromAmount === lastCalculatedFromRef.current && editingField === null) {
            const parsedValue = parseUnits(fromAmount, DECIMALS);
            const isAToB = poolData.tokenA?.address === fromAsset.address ? true : false;

            const swapAmount = await calculateSwap({
              poolAddress: poolData.address,
              isAToB,
              amountIn: parsedValue.toString(),
              signal: abortController.signal,
            });

            setToAmount(formatUnits(BigInt(swapAmount || "0"), DECIMALS));
          }
        } else {
          setPool(null);
          setToAsset(undefined);
          setToAmount("");
          setExchangeRate("0");
        }
      } catch (error: any) {
        // Don't handle aborted requests as errors
        if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') return;

        // Only handle errors for the current request
        if (isMounted && requestId === currentRequestId) {
          console.error("Error fetching pool:", error);
          setPool(null);
          setToAsset(undefined);
          setToAmount("");
          setExchangeRate("0");
        }
      }
    };

    // Initial fetch
    fetchAndUpdatePool();

    // Set up polling
    pollInterval = setInterval(fetchAndUpdatePool, POLL_INTERVAL);

    // Cleanup
    return () => {
      isMounted = false;
      currentRequestId++; // Invalidate any pending requests
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      if (abortController) {
        abortController.abort();
      }
    };
  }, [fromAsset?.address, toAsset?.address, fromAmount, editingField, getPoolByTokenPair, calculateSwap]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (swapInputAbortRef.current) {
        swapInputAbortRef.current.abort();
      }
    };
  }, []);

  // Helper functions
  const getTokenBalance = async (asset: SwappableToken, isFrom: boolean) => {
    try {
      if (isFrom) {
        setFromBalanceLoading(true);
      } else {
        setToBalanceLoading(true);
      }

      const res = await api.get(
        `/tokens/balance?address=eq.${asset.address}`
      );

      const balance = res?.data?.[0]?.balance || "0";

      if (isFrom) {
        setFromAsset({ ...asset, balance });
        setFromBalanceLoading(false);
      } else {
        setToAsset({ ...asset, balance });
        setToBalanceLoading(false);
      }

      await fetchUsdstBalance(userAddress);
    } catch (err) {
      console.error(err);
      if (isFrom) {
        setFromBalanceLoading(false);
      } else {
        setToBalanceLoading(false);
      }
    }
  };

  const calculateSwapAmount = async (inputAmount: string, isFromInput: boolean) => {
    if (swapInputAbortRef.current) swapInputAbortRef.current.abort();
    swapInputAbortRef.current = new AbortController();

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

    // If either pool balance is 0, no liquidity available
    if (BigInt(inputPoolBalance) === 0n || BigInt(outputPoolBalance) === 0n) {
      if (isFromInput) {
        setToAmount("");
      } else {
        setFromAmount("");
      }
      setInsufficientPoolBalance(true);
      return;
    }

    try {
      const parsedValue = parseUnits(inputAmount || "0", DECIMALS);

      if (isFromInput) {
        // Forward calculation: input -> output
        const inputBalance = BigInt(inputAsset.balance?.toString() || "0");
        setWrongAmount(parsedValue > inputBalance);

        // Check pool balance
        const poolBalanceBigInt = BigInt(inputPoolBalance);
        setInsufficientPoolBalance(parsedValue > poolBalanceBigInt && parsedValue <= inputBalance);

        const isAToB = pool.tokenA?.address === inputAsset.address ? true : false;
        lastCalculatedFromRef.current = inputAmount;

        const swapAmount = await calculateSwap({
          poolAddress: pool.address,
          isAToB,
          amountIn: parsedValue.toString(),
          signal: swapInputAbortRef.current.signal,
        });

        const result = formatUnits(BigInt(swapAmount || "0"), DECIMALS);
        if (editingField === 'from') {
          setToAmount(result);
        }
      } else {
        // Reverse calculation: output -> input
        const isAToB = pool.tokenA?.address === outputAsset.address ? true : false;

        const requiredInput = await calculateSwap({
          poolAddress: pool.address,
          isAToB,
          amountIn: parsedValue.toString(),
          reverse: true,
          signal: swapInputAbortRef.current.signal,
        });

        const result = formatUnits(BigInt(requiredInput || "0"), DECIMALS);
        if (editingField === 'to') {
          setFromAmount(result);
          lastCalculatedFromRef.current = result;

          // Check if the calculated input amount exceeds balance
          const fromBalance = BigInt(fromAsset?.balance?.toString() || "0");
          const calculatedInput = BigInt(requiredInput || "0");
          setWrongAmount(calculatedInput > fromBalance);

          // Check pool balance
          const poolBalanceBigInt = BigInt(inputPoolBalance);
          setInsufficientPoolBalance(calculatedInput > poolBalanceBigInt && calculatedInput <= fromBalance);
        }
      }
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
      console.error("Conversion error:", err);
    }
  };

  const handleAmountChange = async (isFromInput: boolean, value: string) => {
    setEditingField(isFromInput ? 'from' : 'to');
    isFromInput ? setFromAmount(value) : setToAmount(value);

    // Reset validation states
    setWrongAmount(false);
    setInsufficientPoolBalance(false);

    if (pool && value && Number(value) !== 0) {
      await calculateSwapAmount(value, isFromInput);
    } else {
      isFromInput ? setToAmount('') : setFromAmount('');
    }
  };

  const handleSwapAssets = () => {
    const prevFromAsset = fromAsset;
    const prevToAsset = toAsset;
    const prevFromAmount = fromAmount;
    const prevToAmount = toAmount;

    let newEditingField: 'from' | 'to' | null = null;
    let preservedAmount = "";

    if (editingField === 'from') {
      newEditingField = 'to';
      preservedAmount = prevFromAmount;
      setFromAmount(prevToAmount);
      setToAmount(prevFromAmount);
    } else if (editingField === 'to') {
      newEditingField = 'from';
      preservedAmount = prevToAmount;
      setFromAmount(prevToAmount);
      setToAmount(prevFromAmount);
    } else {
      setFromAmount(prevToAmount);
      setToAmount(prevFromAmount);
    }

    setFromAsset(prevToAsset);
    setToAsset(prevFromAsset);
    setEditingField(newEditingField);
    lastCalculatedFromRef.current = preservedAmount;

    setTimeout(async () => {
      if (!pool || !newEditingField || !preservedAmount || Number(preservedAmount) === 0) return;

      const parsed = parseUnits(preservedAmount, DECIMALS);
      const isAToB = pool.tokenA?.address === (newEditingField === 'from' ? fromAsset?.address : toAsset?.address) ? true : false;

      try {
        if (newEditingField === 'from') {
          const swapAmount = await calculateSwap({
            poolAddress: pool.address,
            isAToB: !isAToB,
            amountIn: parsed.toString(),
          });
          setToAmount(formatUnits(BigInt(swapAmount || "0"), DECIMALS));
        } else {
          const requiredInput = await calculateSwap({
            poolAddress: pool.address,
            isAToB,
            amountIn: parsed.toString(),
            reverse: true,
          });
          setFromAmount(formatUnits(BigInt(requiredInput || "0"), DECIMALS));
        }
      } catch (err) {
        console.error("Swap recalculation error after swapping assets:", err);
      }
    }, 0);
  };

  const handleSwap = async () => {
    if (!fromAsset || !toAsset || !pool) return;

    try {
      setSwapLoading(true);

      const isAToB = pool.tokenA?.address === fromAsset.address
        ? true
        : false;

      const toAmountInWei = parseUnits(toAmount || "0", DECIMALS);
      const slippageBps = Math.round(slippage * 100);
      const minTokens = (toAmountInWei * BigInt(10000 - slippageBps)) / 10000n;

      await swap({
        poolAddress: pool.address,
        isAToB,
        amountIn: parseUnits(fromAmount || "0", DECIMALS).toString(),
        minAmountOut: minTokens.toString(),
      });

      toast({
        title: "Success",
        description: `Swapped ${fromAmount} ${fromAsset._symbol} for ${toAmount} ${toAsset._symbol}`,
        variant: "success",
      });

      setIsDialogOpen(false);
      setFromAmount('');
      setToAmount('');
      setEditingField(null);
      lastCalculatedFromRef.current = "";

      await Promise.all([
        getTokenBalance(fromAsset, true),
        getTokenBalance(toAsset, false)
      ]);
    } catch (error) {
      console.error("Swap error:", error);
      toast({
        title: "Error",
        description: "Swap failed. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSwapLoading(false);
    }
  };

  // Validation helpers
  const isSwapDisabled = () => {
    const feeAmount = parseUnits(SWAP_FEE, DECIMALS);
    const usdstBalanceBigInt = BigInt(usdstBalance || "0");

    // Basic validations
    if (!fromAmount || !toAmount || !fromAsset || !toAsset || wrongAmount || insufficientPoolBalance) {
      return true;
    }

    // Check if user has enough USDST for fee
    if (usdstBalanceBigInt < feeAmount) {
      return true;
    }

    // Check if swapping USDST and leaving enough for fee
    if (fromAsset.address === usdstAddress) {
      const fromAmountWei = parseUnits(fromAmount || "0", DECIMALS);
      const balance = BigInt(fromAsset.balance || "0");

      if (fromAmountWei > balance - feeAmount && fromAmountWei <= balance) {
        return true;
      }
    }

    return false;
  };

useEffect(() => {
  if (fromAmount && fromAsset && toAsset && pool) {
    calculateSwapAmount(fromAmount, true);
  }
}, [fromAsset, toAsset, fromAmount, pool]);

  return (
    <div className="space-y-6">
      <TokenInput
        amount={fromAmount}
        onChange={(value) => handleAmountChange(true, value)}
        asset={fromAsset}
        balance={fromAsset?.balance || 0}
        isLoading={fromBalanceLoading}
        wrongAmount={wrongAmount}
        insufficientPoolBalance={insufficientPoolBalance}
        onSelect={(asset) => getTokenBalance(asset, true)}
        tokens={swappableTokens}
        isOpen={fromPopoverOpen}
        onOpenChange={setFromPopoverOpen}
        label="From"
        onFocus={() => setEditingField('from')}
        usdstBalance={usdstBalance}
        isFromInput={true}
        pool={pool}
        fromAsset={fromAsset}
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
        balance={toAsset?.balance || 0}
        isLoading={toBalanceLoading}
        wrongAmount={false}
        insufficientPoolBalance={false}
        onSelect={(asset) => getTokenBalance(asset, false)}
        tokens={pairableTokens}
        isOpen={toPopoverOpen}
        onOpenChange={setToPopoverOpen}
        label="To"
        onFocus={() => setEditingField('to')}
        usdstBalance={usdstBalance}
        isFromInput={false}
        pool={pool}
        fromAsset={fromAsset}
      />

      <div className="flex flex-col gap-2 bg-gray-50 p-4 rounded-lg">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Exchange Rate</span>
          <span className="font-medium">
            1 {fromAsset?._symbol || ""} ≈ {formatAmount(exchangeRate)} {toAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Transaction Fee</span>
          <span className="font-medium">{SWAP_FEE} USDST</span>
        </div>
        <SlippageControl
          slippage={slippage}
          autoSlippage={autoSlippage}
          onSlippageChange={setSlippage}
          onAutoToggle={setAutoSlippage}
        />
      </div>

      <Button
        className="w-full bg-blue-600 hover:bg-blue-700"
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
        exchangeRate={formatAmount(exchangeRate)}
        onConfirm={handleSwap}
        isLoading={swapLoading}
      />
    </div>
  );
};

export default SwapWidget; 
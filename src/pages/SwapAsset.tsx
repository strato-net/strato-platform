import { useEffect, useState, useRef } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatUnits, parseUnits } from "ethers";
import { useToast } from '@/hooks/use-toast';
import { useSwapContext } from "@/context/SwapContext";
import { Slider } from "@/components/ui/slider";

// Types
interface TokenSelectorProps {
  asset: SwappableToken | undefined;
  onSelect: (asset: SwappableToken) => void;
  tokens: SwappableToken[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

interface TokenInputProps {
  amount: string;
  onChange: (value: string) => void;
  asset: SwappableToken | undefined;
  balance: string | number;
  isLoading: boolean;
  wrongAmount: boolean;
  onSelect: (asset: SwappableToken) => void;
  tokens: SwappableToken[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  onFocus: () => void;
}

interface SwapState {
  isDialogOpen: boolean;
  fromAsset: SwappableToken | undefined;
  toAsset: SwappableToken | undefined;
  fromAmount: string;
  toAmount: string;
  wrongAmount: boolean;
  fromPopoverOpen: boolean;
  toPopoverOpen: boolean;
  pool: any;
  exchangeRate: string;
  fromBalanceLoading: boolean;
  toBalanceLoading: boolean;
  swapLoading: boolean;
  slippage: number;
  editingField: 'from' | 'to' | null;
}

// Format amount for display
const formatAmount = (amount: string) => {
  if (!amount) return "";
  const value = Number(amount);
  const roundedDown = Math.floor(value * 1000000) / 1000000;
  return roundedDown.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
};

// Utility functions
const formatBalance = (balance: string | number | bigint, symbol: string) => {
  // Always use BigInt or string for balance
  let formatted = formatUnits(BigInt(balance.toString()), 18);
  // Remove trailing zeros after decimal, but keep at least one digit after decimal if present
  if (formatted.includes('.')) {
    formatted = formatted.replace(/(\.\d*?[1-9])0+$/g, '$1').replace(/\.0+$/, '');
  }
  return `${formatted} ${symbol}`;
};

const LoadingSpinner = () => (
  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
);

// Components
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
              key={token?._symbol || ""}
              variant="ghost"
              className="justify-start gap-2"
              onClick={() => {
                onOpenChange(false);
                onSelect(token);
              }}
            >
              <span>{token?._symbol || ""}</span>
              {token?._symbol === asset?._symbol && (
                <Check className="h-4 w-4 ml-auto" />
              )}
            </Button>
          ))
        ) : (
          <span className="p-2">No data to show</span>
        )}
      </div>
    </PopoverContent>
  </Popover>
);

const TokenInput = ({
  amount,
  onChange,
  asset,
  balance,
  isLoading,
  wrongAmount,
  onSelect,
  tokens,
  isOpen,
  onOpenChange,
  label,
  onFocus
}: TokenInputProps) => (
  <div className="bg-gray-50 p-4 rounded-lg">
    <div className="flex justify-between mb-2">
      <label className="text-sm text-gray-600">{label}</label>
      <span className="text-sm text-gray-600">
        Balance: {isLoading ? <LoadingSpinner /> : formatBalance(balance, asset?._symbol || "")}
      </span>
    </div>
    <div className="flex items-center justify-between">
      <div className="w-full flex flex-col">
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
          className={`p-2 bg-transparent border-none text-lg font-medium focus:outline-none${
            wrongAmount ? " border border-red-500 rounded-md" : ""
          }`}
        />
        {wrongAmount && (
          <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
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
  </div>
);

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
}: { 
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  fromAmount: string;
  toAmount: string;
  fromAsset: SwappableToken | undefined;
  toAsset: SwappableToken | undefined;
  exchangeRate: string;
  onConfirm: () => void;
  isLoading: boolean;
}) => (
  <Dialog open={isOpen} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Confirm Swap</DialogTitle>
        <DialogDescription>
          Please review your transaction details before confirming.
        </DialogDescription>
      </DialogHeader>

      <div className="py-4 space-y-4">
        {[
          { label: "You pay", value: `${fromAmount} ${fromAsset?._symbol || ""}` },
          { label: "You receive", value: `${toAmount} ${toAsset?._symbol || ""}` },
          { label: "Exchange rate", value: `1 ${fromAsset?._symbol || ""} ≈ ${exchangeRate} ${toAsset?._symbol || ""}` }
        ].map(({ label, value }) => (
          <div className="flex justify-between" key={label}>
            <span className="text-gray-600">{label}:</span>
            <span className={label === "You pay" || label === "You receive" ? "font-semibold" : ""}>{value}</span>
          </div>
        ))}
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

const SwapAsset = () => {
  const { swappableTokens, pairableTokens, fetchPairableTokens, calculateSwap, swap, getPoolByTokenPair } = useSwapContext();
  const { userAddress } = useUser();
  const { toast } = useToast();

  const [state, setState] = useState<SwapState>({
    isDialogOpen: false,
    fromAsset: undefined,
    toAsset: undefined,
    fromAmount: "",
    toAmount: "",
    wrongAmount: false,
    fromPopoverOpen: false,
    toPopoverOpen: false,
    pool: null,
    exchangeRate: "0",
    fromBalanceLoading: false,
    toBalanceLoading: false,
    swapLoading: false,
    slippage: 4,
    editingField: null
  });

  const [autoSlippage, setAutoSlippage] = useState(true);

  const swapInputAbortRef = useRef<AbortController | null>(null);
  const swapPollAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    document.title = "Swap Assets | STRATO Mercata";
  }, []);

  useEffect(() => {
    if (state.fromAsset?.address) {
      fetchPairableTokens(state.fromAsset.address);
    }
  }, [state.fromAsset?.address, fetchPairableTokens]);

  useEffect(() => {
    const fetchPool = async () => {
      if (state.fromAsset?.address && state.toAsset?.address) {
        try {
          const pool = await getPoolByTokenPair(state.fromAsset.address, state.toAsset.address);
          if (pool) {
            setState(prev => ({ ...prev, pool }));
          } else {
            setState(prev => ({
              ...prev,
              pool: null,
              toAsset: undefined,
              toAmount: ""
            }));
          }
        } catch (error) {
          console.error("Error fetching pool:", error);
          setState(prev => ({
            ...prev,
            pool: null,
            toAsset: undefined,
            toAmount: ""
          }));
        }
      }
    };
    fetchPool();
  }, [state.fromAsset?.address, state.toAsset?.address, getPoolByTokenPair]);

  useEffect(() => {
    if (!state.pool || !state.fromAsset || !state.toAsset) return;

    const rate = state.pool?.tokenA?.address === state.fromAsset?.address
      ? state.pool?.aToBRatio
      : state.pool?.bToARatio;
    
    setState(prev => ({ ...prev, exchangeRate: rate || "0" }));
  }, [state.pool, state.fromAsset, state.toAsset]);

  useEffect(() => {
    if (!state.pool || !state.fromAsset || !state.toAsset || !state.fromAmount || isNaN(Number(state.fromAmount)) || Number(state.fromAmount) === 0) return;
    let isMounted = true;
    let requestId = 0;
    if (swapPollAbortRef.current) swapPollAbortRef.current.abort();
    const pollSwap = async () => {
      requestId++;
      const currentRequest = requestId;
      if (swapPollAbortRef.current) swapPollAbortRef.current.abort();
      swapPollAbortRef.current = new AbortController();
      try {
        const decimals = 18;
        const parsedValue = parseUnits(state.fromAmount, decimals);
        const direction = state.pool.tokenA?.address === state.fromAsset.address ? false : true;
        const swapAmount = await calculateSwap({
          poolAddress: state.pool.address,
          direction,
          amount: parsedValue.toString(),
          signal: swapPollAbortRef.current.signal,
        });
        const result = BigInt(swapAmount || "0");
        if (isMounted && currentRequest === requestId && (state.editingField === 'from' || state.editingField === null)) {
          setState(prev => ({
            ...prev,
            toAmount: formatUnits(result, decimals)
          }));
        }
      } catch (err: any) {
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
        // Optionally handle error
      }
    };
    pollSwap();
    const interval = setInterval(pollSwap, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
      requestId++;
      if (swapPollAbortRef.current) swapPollAbortRef.current.abort();
    };
  }, [state.pool, state.fromAsset, state.toAsset, state.fromAmount, calculateSwap, state.editingField]);

  const handleSwapAssets = () => {
    setState(prev => ({
      ...prev,
      fromAsset: prev.toAsset,
      toAsset: prev.fromAsset,
      fromAmount: prev.toAmount,
      toAmount: prev.fromAmount
    }));
  };

  const getTokenBalance = async (asset: SwappableToken, isFrom: boolean) => {
    try {
      setState(prev => ({
        ...prev,
        [`${isFrom ? 'from' : 'to'}BalanceLoading`]: true
      }));

      const res = await api.get(
        `/tokens/balance?key=eq.${userAddress}&address=eq.${asset?.address}`
      );

      const balance = res?.data?.[0]?.balance || "0";
      
      setState(prev => ({
        ...prev,
        [`${isFrom ? 'from' : 'to'}Asset`]: { ...asset, balance },
        [`${isFrom ? 'from' : 'to'}BalanceLoading`]: false
      }));
    } catch (err) {
      console.error(err);
      setState(prev => ({
        ...prev,
        [`${isFrom ? 'from' : 'to'}BalanceLoading`]: false
      }));
    }
  };

  const calculateSwapAmount = async (inputAmount: string, isFromInput: boolean) => {
    if (swapInputAbortRef.current) swapInputAbortRef.current.abort();
    swapInputAbortRef.current = new AbortController();

    const inputAsset = isFromInput ? state.fromAsset : state.toAsset;
    const outputAsset = isFromInput ? state.toAsset : state.fromAsset;

    if (!inputAsset?.address || !outputAsset?.address || !state.pool) return;

    try {
      const decimals = 18;
      const parsedValue = parseUnits(inputAmount || "0", decimals);
      const inputBalance = BigInt(inputAsset.balance?.toString() || "0");

      if (isFromInput) {
        setState(prev => ({
          ...prev,
          wrongAmount: parsedValue > inputBalance
        }));
      }

      const direction = state.pool.tokenA?.address === inputAsset.address ? false : true;
      const swapAmount = await calculateSwap({
        poolAddress: state.pool.address,
        direction,
        amount: parsedValue.toString(),
        signal: swapInputAbortRef.current.signal,
      });

      const result = BigInt(swapAmount || "0");
      
      setState(prev => {
        if ((isFromInput && prev.editingField === 'from') || (!isFromInput && prev.editingField === 'to')) {
          return {
            ...prev,
            [`${isFromInput ? 'to' : 'from'}Amount`]: formatUnits(result, decimals)
          };
        }
        return prev;
      });
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
      console.error("Conversion error:", err);
    }
  };

  const handleAmountChange = async (isFromInput: boolean, value: string) => {
    const isZero = Number(value) === 0;

    setState(prev => ({
      ...prev,
      [`${isFromInput ? 'from' : 'to'}Amount`]: value,
      editingField: isFromInput ? 'from' : 'to'
    }));

    if (!state.pool || isZero || value === "") {
      setState(prev => ({
        ...prev,
        [`${isFromInput ? 'to' : 'from'}Amount`]: "",
        wrongAmount: false
      }));
      return;
    }

    await calculateSwapAmount(value, isFromInput);
  };

  const handleSwap = async () => {
    if (!state.fromAsset || !state.toAsset) return;
    try {
      setState(prev => ({ ...prev, swapLoading: true }));
      
      const method = state.pool?.tokenA?.address === state.fromAsset.address
        ? "tokenAToTokenB"
        : "tokenBToTokenA";

      const toAmountInWei = parseUnits(state.toAmount || "0", 18);
      const slippageBps = Math.round(state.slippage * 100);
      const minTokens = (toAmountInWei * BigInt(10000 - slippageBps)) / 10000n;

      await swap({
        address: state.pool.address,
        method,
        amount: parseUnits(state.fromAmount || "0", 18).toString(),
        min_tokens: minTokens.toString(),
      });

      toast({
        title: "Success",
        description: `Swap successful: ${state.fromAmount} ${state.fromAsset?._symbol || ""} to ${state.toAmount} ${state.toAsset?._symbol || ""}`,
        variant: "success",
      });

      setState(prev => ({
        ...prev,
        isDialogOpen: false,
        swapLoading: false,
        fromAmount: '',
        toAmount: ''
      }));

      await Promise.all([
        getTokenBalance(state.fromAsset, true),
        getTokenBalance(state.toAsset, false)
      ]);
    } catch (error) {
      console.error("Swap error:", error);
      toast({
        title: "Error",
        description: "Swap failed. Please try again.",
        variant: "destructive",
      });
      setState(prev => ({
        ...prev,
        isDialogOpen: false,
        swapLoading: false
      }));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />
      <div className="flex-1 ml-64">
        <DashboardHeader title="Swap Assets" />
        <main className="p-6">
          <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-6">Exchange your digital assets</h2>
            <div className="space-y-6">
              <TokenInput
                amount={state.fromAmount}
                onChange={(value) => handleAmountChange(true, value)}
                asset={state.fromAsset}
                balance={state.fromAsset?.balance || 0}
                isLoading={state.fromBalanceLoading}
                wrongAmount={state.wrongAmount}
                onSelect={(asset) => getTokenBalance(asset, true)}
                tokens={swappableTokens}
                isOpen={state.fromPopoverOpen}
                onOpenChange={(open) => setState(prev => ({ ...prev, fromPopoverOpen: open }))}
                label="From"
                onFocus={() => setState(prev => ({ ...prev, editingField: 'from' }))}
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
                amount={state.toAmount}
                onChange={(value) => handleAmountChange(false, value)}
                asset={state.toAsset}
                balance={state.toAsset?.balance || 0}
                isLoading={state.toBalanceLoading}
                wrongAmount={false}
                onSelect={(asset) => getTokenBalance(asset, false)}
                tokens={pairableTokens}
                isOpen={state.toPopoverOpen}
                onOpenChange={(open) => setState(prev => ({ ...prev, toPopoverOpen: open }))}
                label="To"
                onFocus={() => setState(prev => ({ ...prev, editingField: 'to' }))}
              />

              <div className="flex flex-col gap-2 bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Exchange Rate</span>
                  <span className="font-medium">
                    1 {state.fromAsset?._symbol || ""} ≈{" "}
                    {formatAmount(state.exchangeRate)}{" "}
                    {state.toAsset?._symbol || ""}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Transaction Fee</span>
                  <span className="font-medium">0.2 USDST</span>
                </div>
                <div className="flex flex-col gap-1 mt-2">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-600 flex items-center gap-1">
                      Max slippage
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        className={`px-3 py-1 rounded-full text-xs font-medium border ${autoSlippage ? 'bg-gray-200 text-gray-700 border-gray-300' : 'bg-transparent text-gray-500 border-gray-300'}`}
                        onClick={() => {
                          setAutoSlippage(true);
                          setState(prev => ({ ...prev, slippage: 4 }));
                        }}
                      >
                        Auto
                      </button>
                      <button
                        className={`px-3 py-1 rounded-full text-xs font-medium border ${!autoSlippage ? 'bg-gray-200 text-gray-700 border-gray-300' : 'bg-transparent text-gray-500 border-gray-300'}`}
                        onClick={() => setAutoSlippage(false)}
                      >
                        Manual
                      </button>
                      <span className={`ml-2 px-3 py-1 rounded-full border text-xs font-semibold ${state.slippage > 5 ? 'border-yellow-400 text-yellow-600' : state.slippage < 1 ? 'border-yellow-400 text-yellow-600' : 'border-gray-300 text-gray-700'}`}>{state.slippage}%</span>
                    </div>
                  </div>
                  {!autoSlippage && (
                    <div className="flex items-center gap-2 mt-2">
                      <Slider
                        value={[state.slippage]}
                        min={0.1}
                        max={10}
                        step={0.1}
                        onValueChange={(value) => setState(prev => ({ ...prev, slippage: value[0] }))}
                        className="w-full"
                      />
                    </div>
                  )}
                  {state.slippage > 5 && (
                    <div className="flex items-center gap-1 text-xs text-yellow-600 mt-1">
                      <span className="font-bold">⚠️ High slippage</span>
                    </div>
                  )}
                  {state.slippage < 1 && (
                    <div className="flex items-center gap-1 text-xs text-yellow-600 mt-1">
                      <span className="font-bold">⚠️ Low slippage</span>
                    </div>
                  )}
                </div>
              </div>

              <Button
                className="w-full bg-blue-600 hover:bg-blue-700"
                onClick={() => setState(prev => ({ ...prev, isDialogOpen: true }))}
                disabled={
                  !state.fromAmount ||
                  !state.toAmount ||
                  !state.fromAsset ||
                  !state.toAsset ||
                  state.wrongAmount
                }
              >
                Swap Assets
              </Button>
            </div>
          </div>
        </main>
      </div>

      <SwapDialog
        isOpen={state.isDialogOpen}
        onOpenChange={(open) => setState(prev => ({ ...prev, isDialogOpen: open }))}
        fromAmount={formatAmount(state.fromAmount)}
        toAmount={formatAmount(state.toAmount)}
        fromAsset={state.fromAsset}
        toAsset={state.toAsset}
        exchangeRate={formatAmount(state.exchangeRate)}
        onConfirm={handleSwap}
        isLoading={state.swapLoading}
      />
    </div>
  );
};

export default SwapAsset;

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Market, PoolV3Token, SwapToken } from "@/interface";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useToast } from "@/hooks/use-toast";
import { useDerivedTradeInfo } from "@/hooks/trade/useDerivedTradeInfo";
import { useTradeSwap } from "@/hooks/trade/useTradeSwap";
import { useMarketBalances, useOwnLatestTradeId } from "@/hooks/terminal/useMarketData";
import { axios } from "@/lib/axios";
import { DECIMAL_PATTERN, SWAP_CALLS } from "@/lib/constants";
import { formatAmount, formatUnits } from "@/utils/numberUtils";
import { computeMaxTransferable } from "@/utils/transferValidation";
import { SlippageSetting, TradeFormState, initialTradeFormState } from "@/components/swap/swapFormReducer";
import { SlippageControl } from "@/components/swap/SlippageControl";
import { SwapConfirmDialog } from "@/components/swap/SwapConfirmDialog";
import NetworkFee, { FeeNotices } from "@/components/NetworkFee";
import { formatPrice } from "@/components/terminal/format";

const HIGH_IMPACT_PERCENT = 5;
const MAX_IMPACT_PERCENT = 15;
const SIZE_PRESETS = [25, 50, 75, 100];

type Side = "buy" | "sell";
type Unit = "base" | "quote";

const toSwapToken = (token: PoolV3Token, balance: string): SwapToken => ({
  address: token.address,
  _name: token.name,
  _symbol: token.symbol,
  customDecimals: token.decimals,
  _totalSupply: "0",
  balance,
  price: "0",
  poolBalance: "0",
  images: token.image ? [{ value: token.image }] : [],
});

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium tabular-nums">{children}</span>
  </div>
);

/**
 * Market orders against the terminal's pool. Buying spends the quote token, selling
 * spends the base token; the amount can be typed in either. Quotes and execution go
 * through the unified /trade endpoints with the pool pinned.
 */
export const OrderForm = ({ market }: { market: Market }) => {
  const { isLoggedIn } = useUser();
  const { feeQuote, fetchUsdstBalance } = useTokenContext();
  const { fetchTokens } = useUserTokens();
  const { toast } = useToast();
  const balances = useMarketBalances(market);
  const tradeSwap = useTradeSwap();

  // the balance read right after a trade can land before the indexer has the swap, and
  // nothing else reads balances again: read them once more when the trade shows on the tape
  const ownLatestTradeId = useOwnLatestTradeId(market.poolAddress);
  useEffect(() => {
    if (ownLatestTradeId) void Promise.all([fetchUsdstBalance(), fetchTokens()]);
  }, [ownLatestTradeId, fetchUsdstBalance, fetchTokens]);

  const [side, setSide] = useState<Side>("buy");
  const [unit, setUnit] = useState<Unit>("quote");
  const [typedValue, setTypedValue] = useState("");
  const [slippage, setSlippage] = useState<SlippageSetting>(initialTradeFormState.slippage);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isBuy = side === "buy";
  const spendUnit: Unit = isBuy ? "quote" : "base";
  const formState: TradeFormState = useMemo(
    () => ({
      tokenIn: toSwapToken(isBuy ? market.quote : market.base, isBuy ? balances.quote : balances.base),
      tokenOut: toSwapToken(isBuy ? market.base : market.quote, isBuy ? balances.base : balances.quote),
      typedValue,
      // typed in the token being spent = exact input; in the token received = exact output
      independentField: unit === spendUnit ? "input" : "output",
      selectedPoolAddress: market.poolAddress,
      slippage,
    }),
    [market, isBuy, balances.base, balances.quote, typedValue, unit, spendUnit, slippage]
  );
  const tokenIn = formState.tokenIn!;
  const tokenOut = formState.tokenOut!;

  const { maxSpendableWei, feeError } = useMemo(() => {
    let error = "";
    const max = computeMaxTransferable(tokenIn.balance, tokenIn.address, SWAP_CALLS, feeQuote, (e) => {
      error = typeof e === "function" ? e(error) : e;
    });
    return { maxSpendableWei: BigInt(max), feeError: error };
  }, [tokenIn.balance, tokenIn.address, feeQuote]);

  const {
    activeQuote, quoteResponse, quoteLoading, hasQuoteResponse, typedValueWei, exactOut,
    inputAmount, outputAmount, inputAmountWei, outputAmountWei,
    exchangeRate, invertedExchangeRate, priceImpact, slippagePercent, minAmountOutWei,
    insufficientBalance,
  } = useDerivedTradeInfo(formState, maxSpendableWei);

  const hasAmount = typedValueWei > 0n;
  // the quote hook keeps the previous amount's quote on screen while a new amount is
  // debounced; only a quote for the amount now typed may be traded on
  const quoteIsCurrent = quoteResponse?.amount === typedValueWei.toString();
  const [baseWei, quoteWei] = isBuy ? [outputAmountWei, inputAmountWei] : [inputAmountWei, outputAmountWei];
  const averagePrice = activeQuote && quoteIsCurrent && baseWei > 0n ? Number(quoteWei) / Number(baseWei) : null;
  const impactTooHigh = (priceImpact ?? 0) >= MAX_IMPACT_PERCENT;
  const cannotFill = hasAmount && hasQuoteResponse && !quoteLoading && (!activeQuote || (exactOut && !!activeQuote.partialFill));

  const blocker = !isLoggedIn
    ? "Sign in to trade"
    : !market.tradable
      ? "Trading opens soon"
      : !hasAmount
        ? "Enter an amount"
        : insufficientBalance
          ? `Insufficient ${tokenIn._symbol} balance`
          : cannotFill
            ? "Not enough liquidity"
            : impactTooHigh
              ? "Price impact too high"
              : feeError || null;

  const selectSide = (next: Side) => {
    setSide(next);
    setUnit(next === "buy" ? "quote" : "base");
    setTypedValue("");
  };

  const applyPreset = (percent: number) => {
    setUnit(spendUnit);
    setTypedValue(formatUnits(((maxSpendableWei * BigInt(percent)) / 100n).toString()));
  };

  const handleSwap = async () => {
    if (!activeQuote || !quoteIsCurrent) return;
    try {
      await tradeSwap.mutateAsync({
        poolAddress: market.poolAddress,
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn: inputAmountWei.toString(),
        minAmountOut: minAmountOutWei.toString(),
      });
      toast({
        title: "Success",
        description: `Traded ${formatAmount(inputAmount)} ${tokenIn._symbol} for ${formatAmount(outputAmount)} ${tokenOut._symbol}`,
        variant: "success",
      });
      setTypedValue("");
    } catch (error) {
      // HTTP failures are toasted by the api client; a wallet rejection or the on-chain
      // revert of a wallet-signed trade only surfaces here
      if (!axios.isAxiosError(error)) {
        toast({
          title: "Trade failed",
          description: error instanceof Error ? error.message.split("\n")[0] : "Transaction failed",
          variant: "destructive",
        });
      }
    } finally {
      setConfirmOpen(false);
      await Promise.all([fetchUsdstBalance(), fetchTokens()]);
    }
  };

  const unitSymbol = unit === "base" ? market.base.symbol : market.quote.symbol;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm font-semibold">
        {(["buy", "sell"] as const).map((option) => (
          <button
            key={option}
            onClick={() => selectSide(option)}
            className={`rounded py-1.5 capitalize ${
              option !== side
                ? "text-muted-foreground hover:text-foreground"
                : option === "buy"
                  ? "bg-up text-background"
                  : "bg-down text-background"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <Row label="Available">
        {isLoggedIn ? `${formatAmount(formatUnits(tokenIn.balance))} ${tokenIn._symbol}` : "—"}
      </Row>

      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
        <input
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`Amount in ${unitSymbol}`}
          value={typedValue}
          onChange={(e) => {
            if (DECIMAL_PATTERN.test(e.target.value)) setTypedValue(e.target.value);
          }}
          className="min-w-0 flex-1 bg-transparent text-base tabular-nums outline-none"
        />
        <div className="flex rounded bg-muted p-0.5">
          {(["base", "quote"] as const).map((option) => (
            <button
              key={option}
              onClick={() => setUnit(option)}
              className={`rounded px-2 py-0.5 ${
                option === unit ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {option === "base" ? market.base.symbol : market.quote.symbol}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {SIZE_PRESETS.map((percent) => (
          <button
            key={percent}
            disabled={maxSpendableWei <= 0n}
            onClick={() => applyPreset(percent)}
            className="rounded border border-border py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {percent}%
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 rounded-md bg-muted/50 p-3">
        <Row label={exactOut ? "You pay ≈" : "You receive ≈"}>
          {activeQuote
            ? `${formatAmount(exactOut ? inputAmount : outputAmount)} ${exactOut ? tokenIn._symbol : tokenOut._symbol}`
            : "—"}
        </Row>
        <Row label="Average price">{averagePrice ? `${formatPrice(averagePrice)} ${market.quote.symbol}` : "—"}</Row>
        <Row label="Price impact">
          <span className={(priceImpact ?? 0) >= HIGH_IMPACT_PERCENT ? "text-down" : undefined}>
            {priceImpact === null ? "—" : `${priceImpact.toFixed(2)}%`}
          </span>
        </Row>
        <Row label="Minimum received">
          {activeQuote ? `${formatAmount(formatUnits(minAmountOutWei.toString()))} ${tokenOut._symbol}` : "—"}
        </Row>
        <Row label="Pool fee">{market.feeBps / 100}%</Row>
        <Row label="Network fee">
          <NetworkFee calls={SWAP_CALLS} />
        </Row>
      </div>

      <SlippageControl slippage={slippage} effectivePercent={slippagePercent} onChange={setSlippage} />

      {isLoggedIn && <FeeNotices calls={SWAP_CALLS} spendingWei={inputAmountWei} tokenAddress={tokenIn.address} />}

      <Button
        disabled={!!blocker || quoteLoading || !activeQuote || !quoteIsCurrent}
        onClick={() => setConfirmOpen(true)}
        className={`w-full text-background ${isBuy ? "bg-up hover:bg-up/90" : "bg-down hover:bg-down/90"}`}
      >
        {blocker ?? `${isBuy ? "Buy" : "Sell"} ${market.base.symbol}`}
      </Button>

      <SwapConfirmDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        fromAmount={formatAmount(inputAmount)}
        toAmount={formatAmount(outputAmount)}
        fromAsset={tokenIn}
        toAsset={tokenOut}
        exchangeRate={exchangeRate}
        invertedExchangeRate={invertedExchangeRate}
        isHighPriceImpact={(priceImpact ?? 0) >= HIGH_IMPACT_PERCENT}
        toAmountMin={formatAmount(formatUnits(minAmountOutWei.toString()))}
        onConfirm={handleSwap}
        isLoading={tradeSwap.isPending}
      />
    </div>
  );
};

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Market, PoolV3Token, SwapToken } from "@/interface";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useToast } from "@/hooks/use-toast";
import { useDerivedTradeInfo } from "@/hooks/trade/useDerivedTradeInfo";
import { useTradeSwap } from "@/hooks/trade/useTradeSwap";
import { useMarketBalances, useTradeSettling } from "@/hooks/terminal/useMarketData";
import { axios } from "@/lib/axios";
import { DECIMAL_PATTERN, SWAP_CALLS } from "@/lib/constants";
import { safeParseUnits } from "@/utils/numberUtils";
import { computeMaxTransferable } from "@/utils/transferValidation";
import { SlippageSetting, TradeFormState, initialTradeFormState } from "@/components/swap/swapFormReducer";
import { SlippageControl } from "@/components/swap/SlippageControl";
import { SwapConfirmDialog } from "@/components/swap/SwapConfirmDialog";
import { FeeNotices } from "@/components/NetworkFee";
import { amountText, formatPrice, formatTokens } from "@/components/terminal/format";

const HIGH_IMPACT_PERCENT = 5;
const MAX_IMPACT_PERCENT = 15;
const SIZE_PRESETS = [25, 50, 75, 100];
const WAD = 10n ** 18n;

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

interface OrderFormProps {
  market: Market;
  settlement: ReturnType<typeof useTradeSettling>;
}

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
 *
 * Nothing here is shown or traded on unless it belongs to what is on screen now: a quote
 * counts only if it was made for the amount typed, and after a trade the balances are
 * held back (`settlement`) until a read that includes it.
 */
export const OrderForm = ({ market, settlement }: OrderFormProps) => {
  const { isLoggedIn } = useUser();
  const { feeQuote } = useTokenContext();
  const { loading: tokensLoading, activeTokens, inactiveTokens } = useUserTokens();
  const { settling } = settlement;
  const { toast } = useToast();
  const balances = useMarketBalances(market);
  const tradeSwap = useTradeSwap();

  const [side, setSide] = useState<Side>("buy");
  const [unit, setUnit] = useState<Unit>("quote");
  const [typedValue, setTypedValue] = useState("");
  /** what the amount read in the other unit before the last unit switch: switching back restores it */
  const [otherUnitValue, setOtherUnitValue] = useState<string>();
  const [slippage, setSlippage] = useState<SlippageSetting>(initialTradeFormState.slippage);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const balancesLoading = tokensLoading && activeTokens.length + inactiveTokens.length === 0;

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
    activeQuote, quoteResponse, typedValueWei, exactOut,
    inputAmountWei, outputAmountWei,
    exchangeRate, invertedExchangeRate, priceImpact, slippagePercent, minAmountOutWei,
    insufficientBalance,
  } = useDerivedTradeInfo(formState, maxSpendableWei);

  const hasAmount = typedValueWei > 0n;
  // the quote hook keeps the last response on screen while the amount now typed is being
  // quoted (and, right after a unit switch, briefly asks for the old amount in the new
  // unit): only a response made for exactly this amount is used
  const quoteIsCurrent = quoteResponse?.amount === typedValueWei.toString();
  const quoting = hasAmount && !quoteIsCurrent;
  // a pool that cannot take the whole order answers with a partial fill (an exact-input
  // quote then reports a smaller input): that is no quote for this order
  const fillable =
    quoteIsCurrent && !!activeQuote && !activeQuote.partialFill && (exactOut || BigInt(activeQuote.amountIn) >= typedValueWei);
  const quote = fillable ? activeQuote : undefined;
  const cannotFill = hasAmount && quoteIsCurrent && !quote;
  const [baseWei, quoteWei] = isBuy ? [outputAmountWei, inputAmountWei] : [inputAmountWei, outputAmountWei];
  const averagePrice = quote && baseWei > 0n ? Number(quoteWei) / Number(baseWei) : null;
  const impact = quote ? priceImpact : null;
  // spending an exact amount is checked against the balance at once; an exact amount to
  // receive only once its quote says what it costs
  const insufficient = insufficientBalance && (!exactOut || !!quote);

  const blocker = !isLoggedIn
    ? "Sign in to trade"
    : !market.tradable
      ? "Trading opens soon"
      : !hasAmount
        ? "Enter an amount"
        : balancesLoading
          ? "Loading balances…"
          : settling
            ? "Updating balances…"
            : insufficient
              ? `Insufficient ${tokenIn._symbol} balance`
              : cannotFill
                ? "Not enough liquidity"
                : (impact ?? 0) >= MAX_IMPACT_PERCENT
                  ? "Price impact too high"
                  : feeError || null;

  const typeAmount = (value: string) => {
    setTypedValue(value);
    setOtherUnitValue(undefined);
  };

  const selectSide = (next: Side) => {
    setSide(next);
    setUnit(next === "buy" ? "quote" : "base");
    typeAmount("");
  };

  /** The typed amount in the other token: what its quote says, else at the pool price */
  const inOtherUnit = (): bigint => {
    if (quote) return exactOut ? inputAmountWei : outputAmountWei;
    const priceWad = safeParseUnits(market.price.toFixed(18));
    if (priceWad === 0n) return 0n;
    return unit === "base" ? (typedValueWei * priceWad) / WAD : (typedValueWei * WAD) / priceWad;
  };

  const switchUnit = (next: Unit) => {
    if (next === unit) return;
    setUnit(next);
    setTypedValue(otherUnitValue ?? (hasAmount ? amountText(inOtherUnit()) : typedValue));
    setOtherUnitValue(typedValue);
  };

  const applyPreset = (percent: number) => {
    setUnit(spendUnit);
    // all of it is exact; a share is rounded down to a readable amount
    typeAmount(
      percent === 100 ? amountText(maxSpendableWei, Infinity) : amountText((maxSpendableWei * BigInt(percent)) / 100n)
    );
  };

  const handleSwap = async () => {
    if (!quote) return;
    const succeeded = settlement.begin(side, Number(inputAmountWei) / 1e18);
    try {
      const result = await tradeSwap.mutateAsync({
        poolAddress: market.poolAddress,
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn: inputAmountWei.toString(),
        minAmountOut: minAmountOutWei.toString(),
      });
      if (result?.status === "Pending") {
        toast({ title: "Order submitted", description: "It is still confirming; balances update once it lands." });
      } else {
        toast({
          title: "Success",
          description: `Traded ${formatTokens(inputAmountWei)} ${tokenIn._symbol} for ${formatTokens(outputAmountWei)} ${tokenOut._symbol}`,
          variant: "success",
        });
      }
      typeAmount("");
      succeeded();
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
      // a failed order can still have cost network fees
      void settlement.refreshBalances();
    } finally {
      setConfirmOpen(false);
    }
  };

  const unitSymbol = unit === "base" ? market.base.symbol : market.quote.symbol;
  /** a figure from the quote, a placeholder while the amount now typed is being quoted */
  const quoted = (value: () => string) => (quote ? value() : quoting ? "…" : "—");

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
        {!isLoggedIn
          ? "—"
          : balancesLoading
            ? "Loading…"
            : settling
              ? "Updating…"
              : `${formatTokens(BigInt(tokenIn.balance))} ${tokenIn._symbol}`}
      </Row>

      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
        <input
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`Amount in ${unitSymbol}`}
          value={typedValue}
          onChange={(e) => {
            if (DECIMAL_PATTERN.test(e.target.value)) typeAmount(e.target.value);
          }}
          className="min-w-0 flex-1 bg-transparent text-base tabular-nums outline-none"
        />
        <div className="flex rounded bg-muted p-0.5">
          {(["base", "quote"] as const).map((option) => (
            <button
              key={option}
              onClick={() => switchUnit(option)}
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
            disabled={balancesLoading || settling || maxSpendableWei <= 0n}
            onClick={() => applyPreset(percent)}
            className="rounded border border-border py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {percent}%
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 rounded-md bg-muted/50 p-3">
        <Row label={exactOut ? "You pay ≈" : "You receive ≈"}>
          {quoted(() =>
            exactOut ? `${formatTokens(inputAmountWei)} ${tokenIn._symbol}` : `${formatTokens(outputAmountWei)} ${tokenOut._symbol}`
          )}
        </Row>
        <Row label="Average price">
          {quoted(() => (averagePrice ? `${formatPrice(averagePrice)} ${market.quote.symbol}` : "—"))}
        </Row>
        <Row label="Price impact">
          <span className={(impact ?? 0) >= HIGH_IMPACT_PERCENT ? "text-down" : undefined}>
            {quoted(() => `${(impact ?? 0).toFixed(2)}%`)}
          </span>
        </Row>
        <Row label="Minimum received">
          {quoted(() => `${formatTokens(minAmountOutWei)} ${tokenOut._symbol}`)}
        </Row>
      </div>

      <SlippageControl
        slippage={slippage}
        effectivePercent={slippagePercent}
        onChange={setSlippage}
        showAutoPercent={false}
      />

      {isLoggedIn && (
        <FeeNotices
          calls={SWAP_CALLS}
          spendingWei={exactOut && !quote ? 0n : inputAmountWei}
          tokenAddress={tokenIn.address}
        />
      )}

      <Button
        disabled={!!blocker || !quote}
        onClick={() => setConfirmOpen(true)}
        className={`w-full text-background ${isBuy ? "bg-up hover:bg-up/90" : "bg-down hover:bg-down/90"}`}
      >
        {blocker ?? `${isBuy ? "Buy" : "Sell"} ${market.base.symbol}`}
      </Button>

      <SwapConfirmDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        fromAmount={formatTokens(inputAmountWei)}
        toAmount={formatTokens(outputAmountWei)}
        fromAsset={tokenIn}
        toAsset={tokenOut}
        exchangeRate={exchangeRate}
        invertedExchangeRate={invertedExchangeRate}
        isHighPriceImpact={(impact ?? 0) >= HIGH_IMPACT_PERCENT}
        toAmountMin={formatTokens(minAmountOutWei)}
        networkFeeCalls={SWAP_CALLS}
        onConfirm={handleSwap}
        isLoading={tradeSwap.isPending || !quote}
      />
    </div>
  );
};

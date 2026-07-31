import { useMemo } from "react";
import { TradePool, TradeQuote, TradeQuoteResponse } from "@/interface";
import { TradeFormState } from "@/components/swap/swapFormReducer";
import { useTradeQuote } from "@/hooks/trade/useTradeQuote";
import { useTradePairPools } from "@/hooks/trade/useTradePairPools";
import { safeParseUnits, formatUnits, formatAmount } from "@/utils/numberUtils";

const WAD = 10n ** 18n;
const AUTO_SLIPPAGE_MIN_PERCENT = 0.5;
const AUTO_SLIPPAGE_MAX_PERCENT = 5;

const isValidInputAmount = (amount: string): boolean =>
  !!amount && amount !== "." && amount !== "0." && !isNaN(Number(amount));

const rateWadToDisplay = (wad: bigint): string | undefined =>
  wad > 0n ? formatAmount(formatUnits(wad.toString())) : undefined;

export interface DerivedTradeInfo {
  /** all candidate pools for the pair (metadata; refreshed on an interval).
   *  While a new pair loads these may still be the previous pair's pools —
   *  rendered dimmed for visual continuity, never used for amounts/rates */
  pools: TradePool[];
  poolsLoading: boolean;
  /** true while `pools` still shows the previous pair (new pair loading) */
  poolsTransitioning: boolean;
  /** the full quote response (per-pool quotes + best pool) */
  quoteResponse?: TradeQuoteResponse;
  quoteLoading: boolean;
  /** a quote response for the CURRENT pair/direction has arrived; until then
   *  per-pool quote states are unknown (debounce window, in-flight, or a
   *  transient fetch failure awaiting the interval retry) */
  hasQuoteResponse: boolean;
  /** pool the trade will execute on: manual selection, else best rate */
  activePoolAddress: string | null;
  activePool?: TradePool;
  /** the active pool's quote for the typed amount */
  activeQuote?: TradeQuote;
  bestPoolAddress: string | null;
  /** typed side parsed to wei */
  typedValueWei: bigint;
  exactOut: boolean;
  /** display strings for both fields (typed side echoes the user text) */
  inputAmount: string;
  outputAmount: string;
  inputAmountWei: bigint;
  outputAmountWei: bigint;
  /** execution rate from the active quote (tokenOut per tokenIn) */
  exchangeRate?: string;
  invertedExchangeRate?: string;
  /** oracle rate for the pair, where available */
  oracleExchangeRate?: string;
  invertedOracleExchangeRate?: string;
  priceImpact: number | null;
  /** effective slippage tolerance in percent (auto-derived or manual) */
  slippagePercent: number;
  minAmountOutWei: bigint;
  /** blocking problems, in display priority order */
  insufficientBalance: boolean;
  exceedsPoolLiquidity: boolean;
  quoteError?: string;
}

/**
 * Everything the swap widget renders, derived from the form state and the
 * server-side quote (Uniswap's useDerivedSwapInfo pattern): the dependent
 * field is always computed from the active pool's exact quote — never from
 * client-side pool math.
 */
export function useDerivedTradeInfo(
  state: TradeFormState,
  maxSpendableWei: bigint
): DerivedTradeInfo {
  const { tokenIn, tokenOut, typedValue, independentField, selectedPoolAddress, slippage } = state;
  const exactOut = independentField === "output";

  const typedValueWei = useMemo(
    () => (isValidInputAmount(typedValue) ? safeParseUnits(typedValue) : 0n),
    [typedValue]
  );

  const poolsQuery = useTradePairPools(tokenIn?.address, tokenOut?.address);
  const quoteQuery = useTradeQuote({
    tokenIn: tokenIn?.address,
    tokenOut: tokenOut?.address,
    amountWei: typedValueWei > 0n ? typedValueWei.toString() : undefined,
    exactOut,
  });

  return useMemo(() => {
    const pools = poolsQuery.data ?? [];
    const quoteResponse = quoteQuery.data;

    // pools kept from the previous pair (placeholder during a token switch) are
    // for visual continuity only — pool sides are oriented to the requested
    // pair, so a side mismatch identifies them
    const poolsMatch =
      pools.length > 0 &&
      pools[0].tokenIn.address.toLowerCase() === tokenIn?.address.toLowerCase() &&
      pools[0].tokenOut.address.toLowerCase() === tokenOut?.address.toLowerCase();
    const matchedPools = poolsMatch ? pools : [];

    // ignore a quote fetched for a different pair or direction (stale cache during switches)
    const quoteMatches =
      !!quoteResponse &&
      quoteResponse.tokenIn === tokenIn?.address.toLowerCase() &&
      quoteResponse.tokenOut === tokenOut?.address.toLowerCase() &&
      quoteResponse.type === (exactOut ? "EXACT_OUTPUT" : "EXACT_INPUT");
    const quotes = quoteMatches ? quoteResponse!.quotes : [];
    const bestPoolAddress = quoteMatches ? quoteResponse!.bestPoolAddress : null;

    const activePoolAddress = selectedPoolAddress ?? bestPoolAddress;
    const activePool = matchedPools.find((p) => p.address === activePoolAddress);
    const activeQuoteRaw = quotes.find((q) => q.poolAddress === activePoolAddress);
    // no typed amount -> no active quote, even if a cached quote for this pair
    // lingers (the query disables on empty input but keeps its previous data);
    // this is what empties the dependent field when the user clears the input
    const activeQuote =
      typedValueWei > 0n && activeQuoteRaw && !activeQuoteRaw.error ? activeQuoteRaw : undefined;

    const inputAmountWei = exactOut ? BigInt(activeQuote?.amountIn ?? "0") : typedValueWei;
    const outputAmountWei = exactOut ? typedValueWei : BigInt(activeQuote?.amountOut ?? "0");

    const dependentDisplay = (wei: bigint): string =>
      wei > 0n ? formatUnits(wei.toString()) : "";
    const inputAmount = exactOut ? dependentDisplay(inputAmountWei) : typedValue;
    const outputAmount = exactOut ? typedValue : dependentDisplay(outputAmountWei);

    // execution rate from the quote (one code path for all pool types); before a
    // quote exists, fall back to the active pool's fee-less spot rate
    const execRateWad =
      activeQuote && inputAmountWei > 0n
        ? (BigInt(activeQuote.amountOut) * WAD) / BigInt(activeQuote.amountIn)
        : BigInt(activePool?.spotRateWad ?? matchedPools[0]?.spotRateWad ?? "0");
    const oracleRateWad = BigInt(activePool?.oracleRateWad ?? matchedPools[0]?.oracleRateWad ?? "0");

    const priceImpact = activeQuote ? activeQuote.priceImpact : null;

    // auto slippage: scale with impact, floored and capped (Uniswap-style)
    const slippagePercent =
      slippage.mode === "manual"
        ? slippage.value
        : Math.min(
            AUTO_SLIPPAGE_MAX_PERCENT,
            Math.max(AUTO_SLIPPAGE_MIN_PERCENT, (priceImpact ?? 0) * 1.5)
          );
    const slippageBps = BigInt(Math.round(slippagePercent * 100));
    const minAmountOutWei = (outputAmountWei * (10000n - slippageBps)) / 10000n;

    const insufficientBalance = inputAmountWei > 0n && inputAmountWei > maxSpendableWei;
    const exceedsPoolLiquidity =
      outputAmountWei > 0n &&
      !!activePool &&
      outputAmountWei > BigInt(activePool.tokenOut.poolBalance || "0");

    return {
      pools,
      poolsLoading: poolsQuery.isLoading,
      poolsTransitioning: pools.length > 0 && !poolsMatch,
      quoteResponse: quoteMatches ? quoteResponse : undefined,
      quoteLoading: quoteQuery.isFetching,
      hasQuoteResponse: quoteMatches,
      activePoolAddress,
      activePool,
      activeQuote,
      bestPoolAddress,
      typedValueWei,
      exactOut,
      inputAmount,
      outputAmount,
      inputAmountWei,
      outputAmountWei,
      exchangeRate: rateWadToDisplay(execRateWad),
      invertedExchangeRate: rateWadToDisplay(execRateWad > 0n ? (WAD * WAD) / execRateWad : 0n),
      oracleExchangeRate: rateWadToDisplay(oracleRateWad),
      invertedOracleExchangeRate: rateWadToDisplay(oracleRateWad > 0n ? (WAD * WAD) / oracleRateWad : 0n),
      priceImpact,
      slippagePercent,
      minAmountOutWei,
      insufficientBalance,
      exceedsPoolLiquidity,
      quoteError: activeQuoteRaw?.error,
    };
  }, [
    poolsQuery.data,
    poolsQuery.isLoading,
    quoteQuery.data,
    quoteQuery.isFetching,
    tokenIn?.address,
    tokenOut?.address,
    exactOut,
    typedValue,
    typedValueWei,
    selectedPoolAddress,
    slippage,
    maxSpendableWei,
  ]);
}
